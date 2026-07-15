import { randomUUID, randomBytes } from "node:crypto";
import { createRedisClient, roomKey, roomsKey, roomCodeKey, roomListKey, playerRoomKey, gameConfigs } from "@gaming-pool/shared";
import type { GameSlug, RoomAssignment } from "@gaming-pool/shared";

const redis = createRedisClient();

// Dev default; production maps region → address.
const GAME_SERVER_ADDR = process.env.GAME_SERVER_ADDR ?? "ws://localhost:5000";

function generateJoinCode(): string {
  return randomBytes(3).toString("hex").toUpperCase();
}

// TTL until host WebSocket joins and persists keys.
const PENDING_ROOM_TTL_S = 120;

// Player's current room, or null (drops stale pointers).
async function activeRoomFor(playerId: string): Promise<string | null> {
  const roomId = await redis.get(playerRoomKey(playerId));
  if (!roomId) return null;
  if (await redis.exists(roomKey(roomId))) return roomId;
  await redis.del(playerRoomKey(playerId));
  return null;
}

export async function assignAutoRoom(slug: GameSlug): Promise<RoomAssignment> {
  const config = gameConfigs[slug];
  if (!config || config.policy !== "auto") {
    throw new Error(`no 'auto' policy config for game "${slug}"`);
  }

  const candidates = await redis.zrevrange(roomsKey(slug), 0, -1, "WITHSCORES");
  for (let i = 0; i < candidates.length; i += 2) {
    const roomId = candidates[i]!;
    const playerCount = Number(candidates[i + 1]);
    if (playerCount < config.maxPlayers) {
      return { server: GAME_SERVER_ADDR, roomId };
    }
  }

  const roomId = randomUUID();
  await redis.hset(roomKey(roomId), {
    server: GAME_SERVER_ADDR,
    game: slug,
    maxPlayers: config.maxPlayers,
  });
  await redis.zadd(roomsKey(slug), 0, roomId);
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
  const reserved = await redis.set(playerRoomKey(playerId), roomId, "EX", PENDING_ROOM_TTL_S, "NX");
  if (!reserved) {
    throw new Error("you already have an active room or game — finish or leave it first");
  }

  const hash: Record<string, string | number> = {
    server: GAME_SERVER_ADDR,
    game: slug,
    maxPlayers: config.maxPlayers,
    hostId: playerId,
    hostName: displayName,
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
  } else {
    await redis.sadd(roomListKey(slug), roomId);
  }

  return { server: GAME_SERVER_ADDR, roomId, ...(joinCode ? { joinCode } : {}) };
}

// Reject join if player already has an active room.
async function assertNotInGame(playerId: string, targetRoomId: string): Promise<void> {
  const active = await activeRoomFor(playerId);
  if (!active) return;
  throw new Error(
    active === targetRoomId
      ? "you are already in this room"
      : "you already have an active room or game — finish or leave it first",
  );
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
  await assertNotInGame(playerId, roomId);
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
  const playerCount = Number(room.playerCount ?? 0);
  const maxPlayers = Number(room.maxPlayers ?? 0);
  if (maxPlayers > 0 && playerCount >= maxPlayers) {
    throw new Error(`room "${roomId}" is full`);
  }
  await assertNotInGame(playerId, roomId);
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
