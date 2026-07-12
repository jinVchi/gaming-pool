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

// Public listing of joinable `created`-policy rooms that don't use a joinCode
// (e.g. chess) — a room is a member while it has an open seat, removed once
// full or destroyed. `beatemup`-style code-based rooms never appear here.
export function roomListKey(game: GameSlug): string {
  return `roomlist:${game}`;
}
