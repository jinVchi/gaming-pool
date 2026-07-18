import Redis from "ioredis";
import type { GameSlug } from "./game-config";

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

const RELEASE_ROOM_CODE = `
if redis.call("GET", KEYS[1]) == ARGV[1] then return redis.call("DEL", KEYS[1]) end
return 0
`;

export async function releaseRoomCode(redis: Redis, joinCode: string, roomId: string): Promise<void> {
  await redis.eval(RELEASE_ROOM_CODE, 1, roomCodeKey(joinCode), roomId);
}

export function roomReservationsKey(roomId: string): string {
  return `roomreservations:${roomId}`;
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

export type PendingSeatClaimResult = "claimed" | "full" | "room-not-found" | "player-busy" | "already-active";

// Atomically reserve both the player's one-room pointer and one pending room
// seat. Expired seat reservations are removed before capacity is checked.
const CLAIM_PENDING_ROOM_SEAT = `
if redis.call("EXISTS", KEYS[2]) == 0 then return -1 end
local current = redis.call("GET", KEYS[1])
if current ~= false and current ~= ARGV[1] then return -2 end
if current == ARGV[1] and redis.call("TTL", KEYS[1]) == -1 then return -3 end

local now = tonumber(redis.call("TIME")[1])
redis.call("ZREMRANGEBYSCORE", KEYS[3], "-inf", now)
local expiresAt = now + tonumber(ARGV[3])
if redis.call("ZSCORE", KEYS[3], ARGV[2]) ~= false then
  redis.call("SET", KEYS[1], ARGV[1], "EX", ARGV[3])
  redis.call("ZADD", KEYS[3], expiresAt, ARGV[2])
  redis.call("EXPIRE", KEYS[3], tonumber(ARGV[3]) + 1)
  return 1
end

local playerCount = tonumber(redis.call("HGET", KEYS[2], "playerCount") or "0")
local maxPlayers = tonumber(redis.call("HGET", KEYS[2], "maxPlayers") or "0")
if maxPlayers <= 0 or playerCount + redis.call("ZCARD", KEYS[3]) >= maxPlayers then return 0 end

redis.call("SET", KEYS[1], ARGV[1], "EX", ARGV[3])
redis.call("ZADD", KEYS[3], expiresAt, ARGV[2])
redis.call("EXPIRE", KEYS[3], tonumber(ARGV[3]) + 1)
return 1
`;

export async function claimPendingRoomSeat(
  redis: Redis,
  playerId: string,
  roomId: string,
  ttlSeconds: number,
): Promise<PendingSeatClaimResult> {
  const result = await redis.eval(
    CLAIM_PENDING_ROOM_SEAT,
    3,
    playerRoomKey(playerId),
    roomKey(roomId),
    roomReservationsKey(roomId),
    roomId,
    playerId,
    String(ttlSeconds),
  );
  if (result === 1) return "claimed";
  if (result === 0) return "full";
  if (result === -1) return "room-not-found";
  if (result === -3) return "already-active";
  return "player-busy";
}

// Convert an API reservation into a persistent playerroom claim. Created-room
// hosts may claim their pre-reserved pointer without a seat reservation.
const CLAIM_RESERVED_PLAYER_SEAT = `
if redis.call("GET", KEYS[1]) ~= ARGV[1] then return 0 end
if redis.call("TTL", KEYS[1]) == -1 then return 2 end
local now = tonumber(redis.call("TIME")[1])
local expiresAt = redis.call("ZSCORE", KEYS[2], ARGV[2])
if ARGV[3] ~= "1" then
  if expiresAt == false or tonumber(expiresAt) <= now then
    redis.call("ZREM", KEYS[2], ARGV[2])
    return 0
  end
end
redis.call("ZREM", KEYS[2], ARGV[2])
redis.call("SET", KEYS[1], ARGV[1])
redis.call("HINCRBY", KEYS[3], "playerCount", 1)
return 1
`;

export async function claimReservedPlayerSeat(
  redis: Redis,
  playerId: string,
  roomId: string,
  allowUnreserved: boolean,
): Promise<boolean> {
  const result = await redis.eval(
    CLAIM_RESERVED_PLAYER_SEAT,
    3,
    playerRoomKey(playerId),
    roomReservationsKey(roomId),
    roomKey(roomId),
    roomId,
    playerId,
    allowUnreserved ? "1" : "0",
  );
  return result === 1 || result === 2;
}

// Undo a just-consumed seat when the socket disappears or loses the final
// in-memory capacity race before addPlayer runs.
const ROLLBACK_CLAIMED_PLAYER_SEAT = `
if redis.call("GET", KEYS[1]) ~= ARGV[1] then return 0 end
redis.call("DEL", KEYS[1])
local count = tonumber(redis.call("HGET", KEYS[2], "playerCount") or "0")
if count > 0 then redis.call("HINCRBY", KEYS[2], "playerCount", -1) end
return 1
`;

export async function rollbackClaimedPlayerSeat(redis: Redis, playerId: string, roomId: string): Promise<void> {
  await redis.eval(ROLLBACK_CLAIMED_PLAYER_SEAT, 2, playerRoomKey(playerId), roomKey(roomId), roomId);
}

// Public listing of joinable `created`-policy rooms that don't use a joinCode
// (e.g. chess) — a room is a member from the moment its creator's socket joins
// (not from API creation, so a stranger can't beat the creator into the room)
// while it has an open seat; removed once full or destroyed. `beatemup`-style
// code-based rooms never appear here.
export function roomListKey(game: GameSlug): string {
  return `roomlist:${game}`;
}
