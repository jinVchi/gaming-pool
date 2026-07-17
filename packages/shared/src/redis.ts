import Redis from "ioredis";
import type { GameSlug } from "./room";

export function createRedisClient(url = process.env.REDIS_URL ?? "redis://localhost:6379/1"): Redis {
  return new Redis(url);
}

export function roomsKey(game: GameSlug): string {
  return `rooms:${game}`;
}

export function roomKey(roomId: string): string {
  return `room:${roomId}`;
}

export function roomCodeKey(joinCode: string): string {
  return `roomcode:${joinCode}`;
}

// Player → roomId of the room they are currently hosting or playing in.
// Reserved (short TTL) when a room is created or joined via the API, made
// persistent when the player's WebSocket actually joins (claimPlayerRoom),
// cleared on leave (releasePlayerRoom) — enforces one active room/game per
// player across tabs and devices.
export function playerRoomKey(playerId: string): string {
  return `playerroom:${playerId}`;
}

// Atomically point playerroom at roomId — succeeds only if the key is absent
// or already points at this room (idempotent re-claim). ttlSeconds > 0 sets a
// pending TTL (API reservation); 0 stores it persistently (socket joined).
// Single Lua script so two racing claims for different rooms can't both win.
const CLAIM_PLAYER_ROOM = `
local cur = redis.call("GET", KEYS[1])
if cur ~= false and cur ~= ARGV[1] then return 0 end
if ARGV[2] == "0" then
  redis.call("SET", KEYS[1], ARGV[1])
else
  redis.call("SET", KEYS[1], ARGV[1], "EX", ARGV[2])
end
return 1
`;

export async function claimPlayerRoom(redis: Redis, playerId: string, roomId: string, ttlSeconds = 0): Promise<boolean> {
  const result = await redis.eval(CLAIM_PLAYER_ROOM, 1, playerRoomKey(playerId), roomId, String(ttlSeconds));
  return result === 1;
}

// Compare-and-delete: clear playerroom only while it still points at roomId,
// so a delayed cleanup can't wipe a pointer to a room the player joined since.
const RELEASE_PLAYER_ROOM = `
if redis.call("GET", KEYS[1]) == ARGV[1] then return redis.call("DEL", KEYS[1]) end
return 0
`;

export async function releasePlayerRoom(redis: Redis, playerId: string, roomId: string): Promise<void> {
  await redis.eval(RELEASE_PLAYER_ROOM, 1, playerRoomKey(playerId), roomId);
}

// Public listing of joinable `created`-policy rooms that don't use a joinCode
// (e.g. chess) — a room is a member from the moment its creator's socket joins
// (not from API creation, so a stranger can't beat the creator into the room)
// while it has an open seat; removed once full or destroyed. `beatemup`-style
// code-based rooms never appear here.
export function roomListKey(game: GameSlug): string {
  return `roomlist:${game}`;
}
