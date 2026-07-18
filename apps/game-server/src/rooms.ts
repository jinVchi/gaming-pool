import type { WebSocket } from "ws";
import {
  createRedisClient,
  roomKey,
  roomsKey,
  roomCodeKey,
  roomListKey,
  roomReservationsKey,
  releaseRoomCode,
  playerRoomKey,
  claimReservedPlayerSeat,
  rollbackClaimedPlayerSeat,
  releasePlayerRoom,
  gameConfigs,
  isGameSlug,
} from "@gaming-pool/shared";
import type { GameSlug, Player } from "@gaming-pool/shared";
import { gameModules } from "@gaming-pool/games";
import type { GameModule, RoomContext } from "@gaming-pool/games";
import { enqueueScore } from "./scores";

const TICK_INTERVAL_MS = 50;
const EMPTY_ROOM_TTL_MS = 5 * 60 * 1000;
const EMPTY_ROOM_SWEEP_MS = 30 * 1000;
// Grace for a created room that spun up but nobody ever joined (creator's
// socket died before seating) — matches the API's pending-reservation TTL.
const CREATED_ROOM_PENDING_MS = 2 * 60 * 1000;

const redis = createRedisClient();

interface RoomInstance {
  roomId: string;
  slug: GameSlug;
  module: GameModule<unknown>;
  state: unknown;
  maxPlayers: number;
  isAuto: boolean;
  joinCode: string | null;
  hostId: string | null;
  players: Map<string, WebSocket>;
  scoreEligiblePlayers: Set<string>;
  tickHandle: ReturnType<typeof setInterval>;
  emptySince: number | null;
}

const rooms = new Map<string, RoomInstance>();
const pendingCreations = new Map<string, Promise<RoomInstance | null>>();

// Fail at boot if the independently maintained config and module registries drift.
export function assertGameRegistryConsistency(): void {
  const modules = gameModules as Record<string, unknown>;
  const configs = gameConfigs as Record<string, unknown>;
  const missingModules = Object.keys(configs).filter((slug) => !modules[slug]);
  const missingConfigs = Object.keys(modules).filter((slug) => !configs[slug]);
  if (missingModules.length || missingConfigs.length) {
    throw new Error(
      `game registry mismatch (missing modules: ${missingModules.join(", ") || "none"}; missing configs: ${missingConfigs.join(", ") || "none"})`,
    );
  }
}

// Boot sweep: delete rooms this server owned in a previous (crashed) run.
// Persistent room keys (TTL -1) were live on the dead process and are now
// orphans; pending-TTL keys are in-flight matchmaking assignments — left
// alone to connect (getOrCreateRoom rebuilds from meta) or expire. Stale
// playerroom pointers self-heal via the existing room-gone cleanup.
export async function sweepOrphanedRooms(serverAddr: string): Promise<void> {
  let cursor = "0";
  let removed = 0;
  do {
    const [next, keys] = await redis.scan(cursor, "MATCH", roomKey("*"), "COUNT", 100);
    cursor = next;
    for (const key of keys) {
      const [meta, ttl] = await Promise.all([redis.hgetall(key), redis.ttl(key)]);
      if (meta.server !== serverAddr || ttl !== -1) continue;
      const roomId = key.slice(roomKey("").length);
      const pipeline = redis.pipeline();
      pipeline.del(key);
      if (meta.game && isGameSlug(meta.game)) {
        pipeline.zrem(roomsKey(meta.game), roomId);
        pipeline.srem(roomListKey(meta.game), roomId);
      }
      pipeline.del(roomReservationsKey(roomId));
      await pipeline.exec();
      if (meta.joinCode) await releaseRoomCode(redis, meta.joinCode, roomId);
      removed++;
    }
  } while (cursor !== "0");
  if (removed > 0) console.log(`[sweep] removed ${removed} orphaned room(s) from a previous run`);
}

// Return existing room, share in-flight create, or start one.
export async function getOrCreateRoom(roomId: string, serverAddr: string): Promise<RoomInstance | null> {
  const existing = rooms.get(roomId);
  if (existing) return existing;

  const pending = pendingCreations.get(roomId);
  if (pending) return pending;

  const creation = createRoom(roomId, serverAddr).finally(() => pendingCreations.delete(roomId));
  pendingCreations.set(roomId, creation);
  return creation;
}

async function createRoom(roomId: string, serverAddr: string): Promise<RoomInstance | null> {
  // Load Redis meta + game module.
  const meta = await redis.hgetall(roomKey(roomId));
  if (!meta.game || !isGameSlug(meta.game) || meta.server !== serverAddr) return null;

  const slug = meta.game;
  const module = gameModules[slug];
  if (!module) return null;

  const config = gameConfigs[slug];
  const players = new Map<string, WebSocket>();
  const scoreEligiblePlayers = new Set<string>();

  // Wire send/broadcast for the game module.
  const ctx: RoomContext = {
    broadcast(message) {
      const payload = JSON.stringify(message);
      for (const socket of players.values()) socket.send(payload);
    },
    send(playerId, message) {
      players.get(playerId)?.send(JSON.stringify(message));
    },
    disconnect(playerId, code, reason) {
      players.get(playerId)?.close(code, reason);
    },
    recordScore(playerId, score) {
      if (!scoreEligiblePlayers.has(playerId)) return;
      enqueueScore({ userId: playerId, gameSlug: slug, score });
    },
  };

  const state = module.createState(roomId, ctx);

  // Build room + start tick loop.
  const room: RoomInstance = {
    roomId,
    slug,
    module,
    state,
    maxPlayers: Number(meta.maxPlayers) || 0,
    isAuto: config?.policy === "auto",
    joinCode: meta.joinCode ?? null,
    hostId: meta.hostId ?? null,
    players,
    scoreEligiblePlayers,
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
  // Compare-and-delete: don't wipe a pointer claimed for a newer room meanwhile.
  await releasePlayerRoom(redis, playerId, roomId);
  return null;
}

// Persistent one-room-per-player claim, awaited by the connection handler
// before seating — atomic, so two sockets racing to different rooms can't
// both win. False = player already holds a different room.
export function claimPlayerSeat(playerId: string, roomId: string, allowUnreserved: boolean): Promise<boolean> {
  return claimReservedPlayerSeat(redis, playerId, roomId, allowUnreserved);
}

// Undo a claim when the connection is rejected after claiming (room full,
// socket died) — compare-and-delete, never touches a pointer to another room.
export function releasePlayerSeat(playerId: string, roomId: string): Promise<void> {
  return rollbackClaimedPlayerSeat(redis, playerId, roomId);
}

export function addPlayer(room: RoomInstance, player: Player, socket: WebSocket): void {
  // Attach socket + clear empty timer. playerroom was already claimed
  // (awaited) by the connection handler.
  room.players.set(player.id, socket);
  if (!player.isGuest) room.scoreEligiblePlayers.add(player.id);
  room.emptySince = null;

  try {
    room.module.onJoin(room.state, player);
  } catch (err) {
    console.error(`[room ${room.roomId}] onJoin error:`, err);
  }

  // Update Redis room registry / public list.
  if (room.isAuto) {
    const pipeline = redis.pipeline();
    pipeline.zadd(roomsKey(room.slug), room.players.size, room.roomId);
    pipeline.hset(roomKey(room.roomId), { playerCount: room.players.size });
    void pipeline.exec();
  } else {
    const update: Record<string, string | number> = { playerCount: room.players.size };
    if (room.players.size === 1) update.hostName = player.displayName;
    void redis.hset(roomKey(room.roomId), update);
    // The room server owns roomlist membership: listed from the host's join
    // (matchmaking never lists pending rooms) while a seat is open.
    if (!room.joinCode) {
      if (room.players.size >= room.maxPlayers) {
        void redis.srem(roomListKey(room.slug), room.roomId);
      } else {
        void redis.sadd(roomListKey(room.slug), room.roomId);
      }
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
  room.scoreEligiblePlayers.delete(playerId);

  // Free playerroom if still this room (atomic compare-and-delete — the old
  // GET-then-DEL could wipe a pointer to a room the player just moved to).
  releasePlayerRoom(redis, playerId, room.roomId).catch((err) => {
    console.error(`[room ${room.roomId}] failed to release playerroom for ${playerId}:`, err);
  });

  try {
    room.module.onLeave(room.state, playerId);
  } catch (err) {
    console.error(`[room ${room.roomId}] onLeave error:`, err);
  }

  // Update Redis counts / relist if a seat opened.
  if (room.isAuto) {
    const pipeline = redis.pipeline();
    pipeline.zadd(roomsKey(room.slug), room.players.size, room.roomId);
    pipeline.hset(roomKey(room.roomId), { playerCount: room.players.size });
    void pipeline.exec();
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
  pipeline.del(roomReservationsKey(room.roomId));
  pipeline.srem(roomListKey(room.slug), room.roomId);
  await pipeline.exec();
  if (room.joinCode) await releaseRoomCode(redis, room.joinCode, room.roomId);

  console.log(`[room ${room.roomId}] closed (${reason})`);
}

// Sweep empty rooms: auto rooms past their idle TTL, and created rooms that
// spun up but were never joined (created rooms with players die immediately
// on last leave, so only the never-joined ones reach this sweep).
setInterval(() => {
  const now = Date.now();
  for (const room of rooms.values()) {
    if (!room.emptySince) continue;
    const limit = room.isAuto ? EMPTY_ROOM_TTL_MS : CREATED_ROOM_PENDING_MS;
    if (now - room.emptySince > limit) {
      void destroyRoom(room, room.isAuto ? "empty auto-policy room past TTL" : "created room never joined");
    }
  }
}, EMPTY_ROOM_SWEEP_MS);
