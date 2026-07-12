import type { WebSocket } from "ws";
import {
  createRedisClient,
  roomKey,
  roomsKey,
  roomCodeKey,
  gameConfigs,
} from "@gaming-pool/shared";
import type { Player } from "@gaming-pool/shared";
import { gameModules } from "@gaming-pool/games";
import type { GameModule, RoomContext } from "@gaming-pool/games";

const TICK_INTERVAL_MS = 50;
const EMPTY_ROOM_TTL_MS = 5 * 60 * 1000;
const EMPTY_ROOM_SWEEP_MS = 30 * 1000;

const redis = createRedisClient();

interface RoomInstance {
  roomId: string;
  slug: string;
  module: GameModule<unknown>;
  state: unknown;
  maxPlayers: number;
  isAuto: boolean;
  joinCode: string | null;
  players: Map<string, WebSocket>;
  tickHandle: ReturnType<typeof setInterval>;
  emptySince: number | null;
}

const rooms = new Map<string, RoomInstance>();
const pendingCreations = new Map<string, Promise<RoomInstance | null>>();

export async function getOrCreateRoom(roomId: string): Promise<RoomInstance | null> {
  const existing = rooms.get(roomId);
  if (existing) return existing;

  const pending = pendingCreations.get(roomId);
  if (pending) return pending;

  const creation = createRoom(roomId).finally(() => pendingCreations.delete(roomId));
  pendingCreations.set(roomId, creation);
  return creation;
}

async function createRoom(roomId: string): Promise<RoomInstance | null> {
  const meta = await redis.hgetall(roomKey(roomId));
  if (!meta.game) return null;

  const module = gameModules[meta.game];
  if (!module) return null;

  const config = gameConfigs[meta.game];
  const players = new Map<string, WebSocket>();

  const ctx: RoomContext = {
    broadcast(message) {
      const payload = JSON.stringify(message);
      for (const socket of players.values()) socket.send(payload);
    },
    send(playerId, message) {
      players.get(playerId)?.send(JSON.stringify(message));
    },
  };

  const state = module.createState(roomId, ctx);

  const room: RoomInstance = {
    roomId,
    slug: meta.game,
    module,
    state,
    maxPlayers: Number(meta.maxPlayers) || 0,
    isAuto: config?.policy === "auto",
    joinCode: meta.joinCode ?? null,
    players,
    emptySince: Date.now(),
    tickHandle: setInterval(() => {
      try {
        module.tick(state, TICK_INTERVAL_MS);
      } catch (err) {
        console.error(`[room ${roomId}] tick error:`, err);
      }
    }, TICK_INTERVAL_MS),
  };

  rooms.set(roomId, room);
  return room;
}

export function addPlayer(room: RoomInstance, player: Player, socket: WebSocket): void {
  room.players.set(player.id, socket);
  room.emptySince = null;

  try {
    room.module.onJoin(room.state, player);
  } catch (err) {
    console.error(`[room ${room.roomId}] onJoin error:`, err);
  }

  if (room.isAuto) {
    void redis.zincrby(roomsKey(room.slug), 1, room.roomId);
  }
}

export function handleMessage(room: RoomInstance, playerId: string, raw: string): void {
  let message: unknown;
  try {
    message = JSON.parse(raw);
  } catch {
    return;
  }
  try {
    room.module.onMessage(room.state, playerId, message);
  } catch (err) {
    console.error(`[room ${room.roomId}] onMessage error:`, err);
  }
}

export function removePlayer(room: RoomInstance, playerId: string): void {
  room.players.delete(playerId);

  try {
    room.module.onLeave(room.state, playerId);
  } catch (err) {
    console.error(`[room ${room.roomId}] onLeave error:`, err);
  }

  if (room.isAuto) {
    void redis.zincrby(roomsKey(room.slug), -1, room.roomId);
  }

  if (room.players.size === 0) {
    room.emptySince = Date.now();
    if (!room.isAuto) {
      void destroyRoom(room);
    }
  }
}

async function destroyRoom(room: RoomInstance): Promise<void> {
  clearInterval(room.tickHandle);
  rooms.delete(room.roomId);

  const pipeline = redis.pipeline();
  pipeline.del(roomKey(room.roomId));
  if (room.isAuto) pipeline.zrem(roomsKey(room.slug), room.roomId);
  if (room.joinCode) pipeline.del(roomCodeKey(room.joinCode));
  await pipeline.exec();
}

// Rolling `auto` rooms are destroyed after sitting empty past the TTL; `created`
// rooms are destroyed immediately on empty (see removePlayer).
setInterval(() => {
  const now = Date.now();
  for (const room of rooms.values()) {
    if (room.isAuto && room.emptySince && now - room.emptySince > EMPTY_ROOM_TTL_MS) {
      void destroyRoom(room);
    }
  }
}, EMPTY_ROOM_SWEEP_MS);
