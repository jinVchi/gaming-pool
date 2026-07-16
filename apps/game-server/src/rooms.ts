import type { WebSocket } from "ws";
import {
  createRedisClient,
  roomKey,
  roomsKey,
  roomCodeKey,
  roomListKey,
  playerRoomKey,
  gameConfigs,
} from "@gaming-pool/shared";
import type { Player } from "@gaming-pool/shared";
import { gameModules } from "@gaming-pool/games";
import type { GameModule, RoomContext } from "@gaming-pool/games";

const TICK_INTERVAL_MS = 50;
const EMPTY_ROOM_TTL_MS = 5 * 60 * 1000;
const EMPTY_ROOM_SWEEP_MS = 30 * 1000;

const redis = createRedisClient();

interface RoomInstance {
  roomId: string;
  slug: string;
  module: GameModule<unknown>;
  state: unknown;
  maxPlayers: number;
  isAuto: boolean;
  joinCode: string | null;
  players: Map<string, WebSocket>;
  tickHandle: ReturnType<typeof setInterval>;
  emptySince: number | null;
}

const rooms = new Map<string, RoomInstance>();
const pendingCreations = new Map<string, Promise<RoomInstance | null>>();

// Return existing room, share in-flight create, or start one.
export async function getOrCreateRoom(roomId: string): Promise<RoomInstance | null> {
  const existing = rooms.get(roomId);
  if (existing) return existing;

  const pending = pendingCreations.get(roomId);
  if (pending) return pending;

  const creation = createRoom(roomId).finally(() => pendingCreations.delete(roomId));
  pendingCreations.set(roomId, creation);
  return creation;
}

async function createRoom(roomId: string): Promise<RoomInstance | null> {
  // Load Redis meta + game module.
  const meta = await redis.hgetall(roomKey(roomId));
  if (!meta.game) return null;

  const module = gameModules[meta.game];
  if (!module) return null;

  const config = gameConfigs[meta.game];
  const players = new Map<string, WebSocket>();

  // Wire send/broadcast for the game module.
  const ctx: RoomContext = {
    broadcast(message) {
      const payload = JSON.stringify(message);
      for (const socket of players.values()) socket.send(payload);
    },
    send(playerId, message) {
      players.get(playerId)?.send(JSON.stringify(message));
    },
  };

  const state = module.createState(roomId, ctx);

  // Build room + start tick loop.
  const room: RoomInstance = {
    roomId,
    slug: meta.game,
    module,
    state,
    maxPlayers: Number(meta.maxPlayers) || 0,
    isAuto: config?.policy === "auto",
    joinCode: meta.joinCode ?? null,
    players,
    emptySince: Date.now(),
    tickHandle: setInterval(() => {
      try {
        module.tick(state, TICK_INTERVAL_MS);
      } catch (err) {
        console.error(`[room ${roomId}] tick error:`, err);
      }
    }, TICK_INTERVAL_MS),
  };

  // Drop pending TTLs — room is live.
  void redis.persist(roomKey(roomId));
  if (room.joinCode) void redis.persist(roomCodeKey(room.joinCode));

  rooms.set(roomId, room);
  console.log(`[room ${roomId}] created (game=${room.slug}, policy=${room.isAuto ? "auto" : "created"}, maxPlayers=${room.maxPlayers})`);
  return room;
}

// Player's current room, or null (drops stale pointers).
export async function playerActiveRoom(playerId: string): Promise<string | null> {
  const roomId = await redis.get(playerRoomKey(playerId));
  if (!roomId) return null;
  if (await redis.exists(roomKey(roomId))) return roomId;
  await redis.del(playerRoomKey(playerId));
  return null;
}

export function addPlayer(room: RoomInstance, player: Player, socket: WebSocket): void {
  // Attach socket + clear empty timer.
  room.players.set(player.id, socket);
  room.emptySince = null;

  // Persist one-room-per-player pointer.
  void redis.set(playerRoomKey(player.id), room.roomId);

  try {
    room.module.onJoin(room.state, player);
  } catch (err) {
    console.error(`[room ${room.roomId}] onJoin error:`, err);
  }

  // Update Redis room registry / public list.
  if (room.isAuto) {
    void redis.zincrby(roomsKey(room.slug), 1, room.roomId);
  } else {
    const update: Record<string, string | number> = { playerCount: room.players.size };
    if (room.players.size === 1) update.hostName = player.displayName;
    void redis.hset(roomKey(room.roomId), update);
    if (room.players.size >= room.maxPlayers) {
      void redis.srem(roomListKey(room.slug), room.roomId);
    }
  }

  console.log(`[room ${room.roomId}] ${player.displayName} (${player.id}) joined (${room.players.size}/${room.maxPlayers})`);
}

export function handleMessage(room: RoomInstance, playerId: string, raw: string): void {
  let message: unknown;
  try {
    message = JSON.parse(raw);
  } catch {
    return;
  }
  try {
    room.module.onMessage(room.state, playerId, message);
  } catch (err) {
    console.error(`[room ${room.roomId}] onMessage error:`, err);
  }
}

export function removePlayer(room: RoomInstance, playerId: string): void {
  room.players.delete(playerId);

  // Free playerroom if still this room.
  void redis.get(playerRoomKey(playerId)).then((value) => {
    if (value === room.roomId) return redis.del(playerRoomKey(playerId));
  });

  try {
    room.module.onLeave(room.state, playerId);
  } catch (err) {
    console.error(`[room ${room.roomId}] onLeave error:`, err);
  }

  // Update Redis counts / relist if a seat opened.
  if (room.isAuto) {
    void redis.zincrby(roomsKey(room.slug), -1, room.roomId);
  } else if (room.players.size > 0) {
    void redis.hset(roomKey(room.roomId), { playerCount: room.players.size });
    if (!room.joinCode && room.players.size < room.maxPlayers) {
      void redis.sadd(roomListKey(room.slug), room.roomId);
    }
  }

  console.log(`[room ${room.roomId}] ${playerId} left (${room.players.size}/${room.maxPlayers})`);

  // Empty created rooms die now; auto rooms wait for TTL sweep.
  if (room.players.size === 0) {
    room.emptySince = Date.now();
    if (!room.isAuto) {
      void destroyRoom(room, "empty, created-policy");
    }
  }
}

async function destroyRoom(room: RoomInstance, reason: string): Promise<void> {
  // Stop tick, drop memory + Redis keys.
  clearInterval(room.tickHandle);
  rooms.delete(room.roomId);

  const pipeline = redis.pipeline();
  pipeline.del(roomKey(room.roomId));
  if (room.isAuto) pipeline.zrem(roomsKey(room.slug), room.roomId);
  if (room.joinCode) pipeline.del(roomCodeKey(room.joinCode));
  pipeline.srem(roomListKey(room.slug), room.roomId);
  await pipeline.exec();

  console.log(`[room ${room.roomId}] closed (${reason})`);
}

// Sweep empty auto rooms past TTL.
setInterval(() => {
  const now = Date.now();
  for (const room of rooms.values()) {
    if (room.isAuto && room.emptySince && now - room.emptySince > EMPTY_ROOM_TTL_MS) {
      void destroyRoom(room, "empty auto-policy room past TTL");
    }
  }
}, EMPTY_ROOM_SWEEP_MS);
