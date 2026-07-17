import "dotenv/config";
import { randomUUID } from "node:crypto";
import { WebSocketServer, type WebSocket } from "ws";
import {
  getOrCreateRoom,
  addPlayer,
  removePlayer,
  handleMessage,
  playerActiveRoom,
  claimPlayerSeat,
  releasePlayerSeat,
  sweepOrphanedRooms,
} from "./rooms";

const port = Number(process.env.PORT ?? 5000);
const HEARTBEAT_INTERVAL_MS = 30_000;
// Advertised address, must match what matchmaking hands out for this server.
const serverAddr = process.env.GAME_SERVER_ADDR ?? `ws://localhost:${port}`;

// Crash recovery: reclaim Redis from a previous run before accepting connections.
await sweepOrphanedRooms(serverAddr);

// One process hosts many rooms across multiple games; game logic loaded from packages/games.
const wss = new WebSocketServer({ port, perMessageDeflate: false });
const alive = new WeakMap<WebSocket, boolean>();

wss.on("connection", async (socket, req) => {
  // Parse query params.
  const url = new URL(req.url ?? "", "http://localhost");
  const roomId = url.searchParams.get("roomId");
  const playerId = url.searchParams.get("playerId") ?? randomUUID();
  const displayName = url.searchParams.get("displayName") ?? "Player";

  if (!roomId) {
    socket.close(4000, "roomId is required");
    return;
  }

  // Load or create the in-memory room.
  const room = await getOrCreateRoom(roomId);
  if (!room) {
    socket.close(4004, "room not found");
    return;
  }
  // Drops a stale pointer (room gone) so it can't block reconnects forever.
  const activeRoom = await playerActiveRoom(playerId);
  if (activeRoom && activeRoom !== roomId) {
    socket.close(4005, "already in another game");
    return;
  }
  // Atomic persistent claim of playerroom — two sockets racing to different
  // rooms can't both win, and a lost Redis write can't leave a seated player
  // without a pointer (the claim is awaited, not fire-and-forget).
  if (!(await claimPlayerSeat(playerId, roomId))) {
    socket.close(4005, "already in another game");
    return;
  }

  // Seat checks must stay after the last await: two connections racing for
  // the last seat interleave at the awaits above, so checking earlier lets
  // both through and overfills the room. Reject paths below undo the claim,
  // except "already connected" — the live socket still needs the pointer.
  if (room.players.has(playerId)) {
    socket.close(4005, "already connected to this room");
    return;
  }
  if (room.players.size >= room.maxPlayers) {
    void releasePlayerSeat(playerId, roomId);
    socket.close(4003, "room is full");
    return;
  }
  // Client vanished during the awaits — its close event already fired, so
  // joining now would leave a ghost player that removePlayer never reaps.
  if (socket.readyState !== socket.OPEN) {
    void releasePlayerSeat(playerId, roomId);
    return;
  }

  // Join + heartbeat tracking.
  addPlayer(room, { id: playerId, displayName }, socket);
  alive.set(socket, true);

  socket.on("pong", () => alive.set(socket, true));
  socket.on("message", (raw) => handleMessage(room, playerId, raw.toString()));
  socket.on("close", () => removePlayer(room, playerId));
});

// Terminate dead sockets.
const heartbeat = setInterval(() => {
  for (const socket of wss.clients) {
    if (alive.get(socket) === false) {
      socket.terminate();
      continue;
    }
    alive.set(socket, false);
    socket.ping();
  }
}, HEARTBEAT_INTERVAL_MS);

wss.on("close", () => clearInterval(heartbeat));

console.log(`game-server listening on ws://localhost:${port}`);
