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
