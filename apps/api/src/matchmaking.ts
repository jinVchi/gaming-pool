import { randomUUID, randomBytes } from "node:crypto";
import { createRedisClient, roomKey, roomsKey, roomCodeKey, gameConfigs } from "@gaming-pool/shared";
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

export async function createRoom(slug: GameSlug): Promise<RoomAssignment & { joinCode: string }> {
  const config = gameConfigs[slug];
  if (!config || config.policy !== "created") {
    throw new Error(`no 'created' policy config for game "${slug}"`);
  }

  const roomId = randomUUID();
  const joinCode = generateJoinCode();
  await redis.hset(roomKey(roomId), {
    server: GAME_SERVER_ADDR,
    game: slug,
    maxPlayers: config.maxPlayers,
    joinCode,
  });
  await redis.set(roomCodeKey(joinCode), roomId);
  return { server: GAME_SERVER_ADDR, roomId, joinCode };
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
