import "dotenv/config";
import { WebSocketServer, type WebSocket } from "ws";
import { getGameAuthSecret, verifyPlayerToken } from "@gaming-pool/shared";
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
const MAX_MESSAGE_BYTES = 16 * 1024;
const MESSAGE_RATE_WINDOW_MS = 10_000;
const MAX_MESSAGES_PER_WINDOW = 120;
const gameAuthSecret = getGameAuthSecret();
// Advertised address, must match what matchmaking hands out for this server.
const serverAddr = process.env.GAME_SERVER_ADDR ?? `ws://localhost:${port}`;

// Crash recovery: reclaim Redis from a previous run before accepting connections.
await sweepOrphanedRooms(serverAddr);

// One process hosts many rooms across multiple games; game logic loaded from packages/games.
const wss = new WebSocketServer({ port, perMessageDeflate: false, maxPayload: MAX_MESSAGE_BYTES });
const alive = new WeakMap<WebSocket, boolean>();
const messageRates = new WeakMap<WebSocket, { windowStartedAt: number; count: number }>();

function acceptsMessage(socket: WebSocket): boolean {
  const now = Date.now();
  const rate = messageRates.get(socket);
  if (!rate || now - rate.windowStartedAt >= MESSAGE_RATE_WINDOW_MS) {
    messageRates.set(socket, { windowStartedAt: now, count: 1 });
    return true;
  }
  rate.count += 1;
  return rate.count <= MAX_MESSAGES_PER_WINDOW;
}

wss.on("connection", async (socket, req) => {
  // Parse query params.
  const url = new URL(req.url ?? "", "http://localhost");
  const roomId = url.searchParams.get("roomId");
  const playerToken = url.searchParams.get("token");
  const player = playerToken ? verifyPlayerToken(playerToken, gameAuthSecret) : null;

  if (!roomId) {
    socket.close(4000, "roomId is required");
    return;
  }
  if (!player) {
    socket.close(4001, "valid player token required");
    return;
  }
  const { playerId, displayName } = player;

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
  const isCreatedRoomHost = room.hostId === playerId && room.players.size === 0;
  if (!(await claimPlayerSeat(playerId, roomId, isCreatedRoomHost))) {
    socket.close(4006, "room seat reservation required");
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
  messageRates.set(socket, { windowStartedAt: Date.now(), count: 0 });

  socket.on("pong", () => alive.set(socket, true));
  socket.on("message", (raw) => {
    if (!acceptsMessage(socket)) {
      socket.close(4008, "message rate limit exceeded");
      return;
    }
    handleMessage(room, playerId, raw.toString());
  });
  socket.on("error", (err) => console.warn(`[socket ${playerId}]`, err.message));
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
