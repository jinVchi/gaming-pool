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
// Reserved (NX, short TTL) when a room is created, made persistent when the
// player's WebSocket actually joins, cleared on leave — enforces one active
// room/game per player across tabs and devices.
export function playerRoomKey(playerId: string): string {
  return `playerroom:${playerId}`;
}

// Public listing of joinable `created`-policy rooms that don't use a joinCode
// (e.g. chess) — a room is a member from the moment its creator's socket joins
// (not from API creation, so a stranger can't beat the creator into the room)
// while it has an open seat; removed once full or destroyed. `beatemup`-style
// code-based rooms never appear here.
export function roomListKey(game: GameSlug): string {
  return `roomlist:${game}`;
}
