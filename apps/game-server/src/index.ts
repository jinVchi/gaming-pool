import "dotenv/config";
import { randomUUID } from "node:crypto";
import { WebSocketServer, type WebSocket } from "ws";
import { getOrCreateRoom, addPlayer, removePlayer, handleMessage } from "./rooms";

const port = Number(process.env.PORT ?? 5000);
const HEARTBEAT_INTERVAL_MS = 30_000;

// One process hosts many rooms across multiple games; game logic loaded from packages/games.
const wss = new WebSocketServer({ port, perMessageDeflate: false });
const alive = new WeakMap<WebSocket, boolean>();

wss.on("connection", async (socket, req) => {
  const url = new URL(req.url ?? "", "http://localhost");
  const roomId = url.searchParams.get("roomId");
  const playerId = url.searchParams.get("playerId") ?? randomUUID();
  const displayName = url.searchParams.get("displayName") ?? "Player";

  if (!roomId) {
    socket.close(4000, "roomId is required");
    return;
  }

  const room = await getOrCreateRoom(roomId);
  if (!room) {
    socket.close(4004, "room not found");
    return;
  }
  if (room.players.size >= room.maxPlayers) {
    socket.close(4003, "room is full");
    return;
  }

  addPlayer(room, { id: playerId, displayName }, socket);
  alive.set(socket, true);

  socket.on("pong", () => alive.set(socket, true));
  socket.on("message", (raw) => handleMessage(room, playerId, raw.toString()));
  socket.on("close", () => removePlayer(room, playerId));
});

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
