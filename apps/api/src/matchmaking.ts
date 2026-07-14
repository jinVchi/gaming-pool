import { randomUUID, randomBytes } from "node:crypto";
import { createRedisClient, roomKey, roomsKey, roomCodeKey, roomListKey, playerRoomKey, gameConfigs } from "@gaming-pool/shared";
import type { GameSlug, RoomAssignment } from "@gaming-pool/shared";

const redis = createRedisClient();

// Single game-server in dev; a region->address map replaces this in production.
const GAME_SERVER_ADDR = process.env.GAME_SERVER_ADDR ?? "ws://localhost:5000";

function generateJoinCode(): string {
  return randomBytes(3).toString("hex").toUpperCase();
}

// A freshly created room only becomes "real" once the host's WebSocket reaches
// the game-server (which persists these keys). Until then both the room hash
// and the host's playerroom reservation carry this TTL so a host who never
// connects doesn't leak a room or stay locked out of creating another.
const PENDING_ROOM_TTL_S = 120;

// roomId of a live room the player is already hosting/playing in, or null.
// Prunes the pointer when the room it references no longer exists.
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

// created policy branches on config.joinCode: code-based rooms (e.g. beatemup)
// are private and shared out-of-band; rooms without a code are publicly listed
// (e.g. chess) via roomListKey so other players can browse and join directly.
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
  // NX makes the one-room-per-player check atomic against a double-click /
  // second tab racing this request.
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

// Rejects joining any room while the player is already hosting or playing one
// — including their own freshly created room from a second tab.
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
