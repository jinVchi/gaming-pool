import "dotenv/config";
import type { IncomingMessage } from "node:http";
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
  assertGameRegistryConsistency,
  sweepOrphanedRooms,
} from "./rooms";

const port = Number(process.env.PORT ?? 5000);
const HEARTBEAT_INTERVAL_MS = 30_000;
const MAX_MESSAGE_BYTES = 16 * 1024;
const BURST_RATE_WINDOW_MS = 10_000;
const MAX_BURST_MESSAGES = 120;
const SUSTAINED_RATE_WINDOW_MS = 60_000;
const MAX_SUSTAINED_MESSAGES = 1_200;
const SOCKET_PROTOCOL = "gaming-pool";
const gameAuthSecret = getGameAuthSecret();
// Advertised address, must match what matchmaking hands out for this server.
const serverAddr = process.env.GAME_SERVER_ADDR ?? `ws://localhost:${port}`;

// Crash recovery: reclaim Redis from a previous run before accepting connections.
assertGameRegistryConsistency();
await sweepOrphanedRooms(serverAddr);

// One process hosts many rooms across multiple games; game logic loaded from packages/games.
const wss = new WebSocketServer({
  port,
  perMessageDeflate: false,
  maxPayload: MAX_MESSAGE_BYTES,
  handleProtocols(protocols) {
    return protocols.has(SOCKET_PROTOCOL) ? SOCKET_PROTOCOL : false;
  },
});
const alive = new WeakMap<WebSocket, boolean>();
const messageRates = new WeakMap<
  WebSocket,
  { burstStartedAt: number; burstCount: number; sustainedStartedAt: number; sustainedCount: number }
>();

function messageRateVerdict(socket: WebSocket): "accept" | "drop" | "close" {
  const now = Date.now();
  const rate = messageRates.get(socket);
  if (!rate) {
    messageRates.set(socket, {
      burstStartedAt: now,
      burstCount: 1,
      sustainedStartedAt: now,
      sustainedCount: 1,
    });
    return "accept";
  }
  if (now - rate.burstStartedAt >= BURST_RATE_WINDOW_MS) {
    rate.burstStartedAt = now;
    rate.burstCount = 0;
  }
  if (now - rate.sustainedStartedAt >= SUSTAINED_RATE_WINDOW_MS) {
    rate.sustainedStartedAt = now;
    rate.sustainedCount = 0;
  }
  rate.burstCount += 1;
  // Count all attempts so sustained flooding eventually closes the socket;
  // this limit is intentionally looser than the short-window drop limit.
  rate.sustainedCount += 1;
  if (rate.sustainedCount > MAX_SUSTAINED_MESSAGES) return "close";
  if (rate.burstCount > MAX_BURST_MESSAGES) return "drop";
  return "accept";
}

function tokenFromProtocols(header: string | string[] | undefined): string | null {
  const value = Array.isArray(header) ? header.join(",") : header;
  return value
    ?.split(",")
    .map((part) => part.trim())
    .find((part) => part !== SOCKET_PROTOCOL) ?? null;
}

async function handleConnection(socket: WebSocket, req: IncomingMessage): Promise<void> {
  socket.on("error", (err) => console.warn("[socket]", err.message));
  // Parse query params.
  const url = new URL(req.url ?? "", "http://localhost");
  const roomId = url.searchParams.get("roomId");
  const playerToken = tokenFromProtocols(req.headers["sec-websocket-protocol"]);
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
  const room = await getOrCreateRoom(roomId, serverAddr);
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
  addPlayer(room, { id: playerId, displayName, isGuest: player.isGuest }, socket);
  alive.set(socket, true);

  socket.on("pong", () => alive.set(socket, true));
  socket.on("message", (raw) => {
    const verdict = messageRateVerdict(socket);
    if (verdict === "close") {
      socket.close(4008, "message rate limit exceeded");
      return;
    }
    if (verdict === "drop") return;
    handleMessage(room, playerId, raw.toString());
  });
  socket.on("close", () => removePlayer(room, playerId));
}

wss.on("connection", (socket, req) => {
  void handleConnection(socket, req).catch((err: unknown) => {
    console.error("[connection] failed:", err);
    if (socket.readyState === socket.OPEN || socket.readyState === socket.CONNECTING) {
      socket.close(1011, "temporary server error");
    }
  });
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
