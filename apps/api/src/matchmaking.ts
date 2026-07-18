import { randomUUID, randomBytes } from "node:crypto";
import {
  claimPendingRoomSeat,
  claimPlayerRoom,
  createRedisClient,
  gameConfigs,
  playerRoomKey,
  releasePlayerRoom,
  roomCodeKey,
  roomKey,
  roomListKey,
  roomsKey,
} from "@gaming-pool/shared";
import type { GameSlug, RoomAssignment } from "@gaming-pool/shared";

const redis = createRedisClient();

// Dev default; production maps region → address.
const GAME_SERVER_ADDR = process.env.GAME_SERVER_ADDR ?? "ws://localhost:5000";

function generateJoinCode(): string {
  return randomBytes(3).toString("hex").toUpperCase();
}

// TTL until host WebSocket joins and persists keys.
const PENDING_ROOM_TTL_S = 120;

// Check if the player has an active room.
async function activeRoomFor(playerId: string): Promise<string | null> {
  // playerRoomKey exists?
  const roomId = await redis.get(playerRoomKey(playerId));
  if (!roomId) return null;
  // roomKey exists?
  if (await redis.exists(roomKey(roomId))) return roomId;
  // Stale pointer (room gone) — compare-and-delete so a concurrent claim of a
  // newer room can't be wiped by this cleanup.
  await releasePlayerRoom(redis, playerId, roomId);
  // No active room
  return null;
}
// Assign an auto room to the player.
export async function assignAutoRoom(slug: GameSlug, playerId: string): Promise<RoomAssignment> {
  const config = gameConfigs[slug];
  if (!config || config.policy !== "auto") {
    throw new Error(`no 'auto' policy config for game "${slug}"`);
  }

  const activeRoom = await activeRoomFor(playerId);
  if (activeRoom) {
    throw new Error("you already have an active room or game — finish or leave it first");
  }

  const candidates = await redis.zrevrange(roomsKey(slug), 0, -1, "WITHSCORES");
  for (let i = 0; i < candidates.length; i += 2) {
    const roomId = candidates[i]!;
    const playerCount = Number(candidates[i + 1]);
    if (playerCount >= config.maxPlayers) continue;
    // Pending room whose hash TTL expired (assigned player never connected) —
    // drop the stale registry entry instead of assigning a dead room.
    if (!(await redis.exists(roomKey(roomId)))) {
      await redis.zrem(roomsKey(slug), roomId);
      continue;
    }
    const claim = await claimPendingRoomSeat(redis, playerId, roomId, PENDING_ROOM_TTL_S);
    if (claim === "full") continue;
    if (claim === "room-not-found") {
      await redis.zrem(roomsKey(slug), roomId);
      continue;
    }
    if (claim === "player-busy" || claim === "already-active") {
      throw new Error("you already have an active room or game — finish or leave it first");
    }
    const server = await redis.hget(roomKey(roomId), "server");
    if (!server) throw new Error(`room "${roomId}" has no game server`);
    return { server, roomId };
  }

  const roomId = randomUUID();
  await redis.hset(roomKey(roomId), {
    server: GAME_SERVER_ADDR,
    game: slug,
    maxPlayers: config.maxPlayers,
    playerCount: 0,
  });
  // Pending TTL like created rooms; the game server persists on spin-up.
  await redis.expire(roomKey(roomId), PENDING_ROOM_TTL_S);
  await redis.zadd(roomsKey(slug), 0, roomId);
  const claim = await claimPendingRoomSeat(redis, playerId, roomId, PENDING_ROOM_TTL_S);
  if (claim !== "claimed") {
    await redis.del(roomKey(roomId));
    await redis.zrem(roomsKey(slug), roomId);
    throw new Error("failed to reserve a room seat");
  }
  return { server: GAME_SERVER_ADDR, roomId };
}

// Create a created-policy room; reserves one-room-per-player (NX + TTL).
export async function createRoom(
  slug: GameSlug,
  playerId: string,
  displayName: string,
): Promise<RoomAssignment & { joinCode?: string }> {
  const config = gameConfigs[slug];
  if (!config || config.policy !== "created") {
    throw new Error(`no 'created' policy config for game "${slug}"`);
  }

  if (await activeRoomFor(playerId)) {
    throw new Error("you already have an active room or game — finish or leave it first");
  }

  const roomId = randomUUID();
  // Atomic one-room-per-player claim.
  const reserved = await claimPlayerRoom(redis, playerId, roomId, PENDING_ROOM_TTL_S);
  if (!reserved) {
    throw new Error("you already have an active room or game — finish or leave it first");
  }

  const hash: Record<string, string | number> = {
    server: GAME_SERVER_ADDR,
    game: slug,
    maxPlayers: config.maxPlayers,
    hostId: playerId,
    hostName: displayName,
    playerCount: 0,
  };

  // For private rooms, generate a join code.
  let joinCode: string | undefined;
  if (config.joinCode) {
    joinCode = generateJoinCode();
    hash.joinCode = joinCode;
  }

  await redis.hset(roomKey(roomId), hash);
  await redis.expire(roomKey(roomId), PENDING_ROOM_TTL_S);

  if (joinCode) {
    await redis.set(roomCodeKey(joinCode), roomId, "EX", PENDING_ROOM_TTL_S);
  }
  // Public (no-joinCode) rooms are NOT listed here: the game server adds them
  // to roomlist:{slug} when the creator's socket joins. Listing earlier lets a
  // stranger connect first and become the room owner in the creator's place.

  return { server: GAME_SERVER_ADDR, roomId, ...(joinCode ? { joinCode } : {}) };
}

// Reserve the one-room pointer and capacity seat in one Redis script.
async function reservePlayerSeat(playerId: string, roomId: string): Promise<void> {
  const result = await claimPendingRoomSeat(redis, playerId, roomId, PENDING_ROOM_TTL_S);
  if (result === "claimed") return;
  if (result === "room-not-found") throw new Error(`room "${roomId}" not found`);
  if (result === "full") throw new Error(`room "${roomId}" is full`);
  if (result === "already-active") throw new Error("you are already in this room");
  throw new Error("you already have an active room or game — finish or leave it first");
}

export async function joinRoomByCode(slug: GameSlug, joinCode: string, playerId: string): Promise<RoomAssignment> {
  const roomId = await redis.get(roomCodeKey(joinCode.toUpperCase()));
  if (!roomId) {
    throw new Error(`no room found for join code "${joinCode}"`);
  }
  const room = await redis.hgetall(roomKey(roomId));
  if (room.game !== slug) {
    throw new Error(`join code "${joinCode}" does not belong to game "${slug}"`);
  }
  await reservePlayerSeat(playerId, roomId);
  return { server: room.server!, roomId };
}

export async function joinRoomById(slug: GameSlug, roomId: string, playerId: string): Promise<RoomAssignment> {
  const room = await redis.hgetall(roomKey(roomId));
  if (!room.game) {
    throw new Error(`room "${roomId}" not found`);
  }
  if (room.game !== slug) {
    throw new Error(`room "${roomId}" does not belong to game "${slug}"`);
  }
  await reservePlayerSeat(playerId, roomId);
  return { server: room.server!, roomId };
}

export interface OpenRoom {
  roomId: string;
  hostName: string;
  playerCount: number;
  maxPlayers: number;
}

export async function listOpenRooms(slug: GameSlug): Promise<OpenRoom[]> {
  const roomIds = await redis.smembers(roomListKey(slug));
  const rooms: OpenRoom[] = [];
  for (const roomId of roomIds) {
    const room = await redis.hgetall(roomKey(roomId));
    if (!room.game) {
      void redis.srem(roomListKey(slug), roomId); // stale list entry
      continue;
    }
    rooms.push({
      roomId,
      hostName: room.hostName ?? "Host",
      playerCount: Number(room.playerCount ?? 1),
      maxPlayers: Number(room.maxPlayers ?? 0),
    });
  }
  return rooms;
}
