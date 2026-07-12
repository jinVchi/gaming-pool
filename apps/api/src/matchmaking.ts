import { randomUUID, randomBytes } from "node:crypto";
import { createRedisClient, roomKey, roomsKey, roomCodeKey, roomListKey, gameConfigs } from "@gaming-pool/shared";
import type { GameSlug, RoomAssignment } from "@gaming-pool/shared";

const redis = createRedisClient();

// Single game-server in dev; a region->address map replaces this in production.
const GAME_SERVER_ADDR = process.env.GAME_SERVER_ADDR ?? "ws://localhost:5000";

function generateJoinCode(): string {
  return randomBytes(3).toString("hex").toUpperCase();
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

// created policy branches on config.joinCode: code-based rooms (e.g. beatemup)
// are private and shared out-of-band; rooms without a code are publicly listed
// (e.g. chess) via roomListKey so other players can browse and join directly.
export async function createRoom(slug: GameSlug): Promise<RoomAssignment & { joinCode?: string }> {
  const config = gameConfigs[slug];
  if (!config || config.policy !== "created") {
    throw new Error(`no 'created' policy config for game "${slug}"`);
  }

  const roomId = randomUUID();
  const hash: Record<string, string | number> = {
    server: GAME_SERVER_ADDR,
    game: slug,
    maxPlayers: config.maxPlayers,
  };

  let joinCode: string | undefined;
  if (config.joinCode) {
    joinCode = generateJoinCode();
    hash.joinCode = joinCode;
    await redis.set(roomCodeKey(joinCode), roomId);
  } else {
    await redis.sadd(roomListKey(slug), roomId);
  }

  await redis.hset(roomKey(roomId), hash);
  return { server: GAME_SERVER_ADDR, roomId, ...(joinCode ? { joinCode } : {}) };
}

export async function joinRoomByCode(slug: GameSlug, joinCode: string): Promise<RoomAssignment> {
  const roomId = await redis.get(roomCodeKey(joinCode.toUpperCase()));
  if (!roomId) {
    throw new Error(`no room found for join code "${joinCode}"`);
  }
  const room = await redis.hgetall(roomKey(roomId));
  if (room.game !== slug) {
    throw new Error(`join code "${joinCode}" does not belong to game "${slug}"`);
  }
  return { server: room.server!, roomId };
}

export async function joinRoomById(slug: GameSlug, roomId: string): Promise<RoomAssignment> {
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
      void redis.srem(roomListKey(slug), roomId); // stale pointer — room already gone
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
