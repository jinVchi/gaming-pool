import type { Player } from "@gaming-pool/shared";
import type { GameModule, RoomContext } from "../types";
import {
  GRID_SIZE,
  STEP_MS,
  createSimState,
  spawnSnake,
  removeSnake,
  setDirection,
  stepSimulation,
  type Direction,
  type SnakeSimState,
} from "./logic";

interface SnakeModuleState {
  sim: SnakeSimState;
  ctx: RoomContext;
}

const VALID_DIRECTIONS: readonly Direction[] = ["up", "down", "left", "right"];

function isDirection(value: unknown): value is Direction {
  return typeof value === "string" && (VALID_DIRECTIONS as readonly string[]).includes(value);
}

function serializeState(sim: SnakeSimState) {
  return {
    type: "state",
    payload: {
      gridSize: GRID_SIZE,
      food: sim.food,
      snakes: [...sim.snakes.values()].map((snake) => ({
        id: snake.playerId,
        displayName: snake.displayName,
        color: snake.color,
        segments: snake.segments,
        alive: snake.alive,
        score: snake.score,
      })),
    },
  };
}

export const snakeModule: GameModule<SnakeModuleState> = {
  createState(_roomId, ctx) {
    return { sim: createSimState(), ctx };
  },

  onJoin(state, player: Player) {
    spawnSnake(state.sim, player.id, player.displayName);
    state.ctx.send(player.id, { type: "welcome", payload: { playerId: player.id, gridSize: GRID_SIZE } });
    state.ctx.broadcast(serializeState(state.sim));
  },

  onLeave(state, playerId) {
    removeSnake(state.sim, playerId);
  },

  onMessage(state, playerId, message) {
    if (typeof message !== "object" || message === null) return;
    const { type, payload } = message as { type?: unknown; payload?: unknown };
    if (type !== "input" || typeof payload !== "object" || payload === null) return;

    const { direction } = payload as { direction?: unknown };
    if (!isDirection(direction)) return;

    const snake = state.sim.snakes.get(playerId);
    if (snake) setDirection(snake, direction);
  },

  tick(state, dtMs) {
    state.sim.accumulatedMs += dtMs;
    let stepped = false;
    while (state.sim.accumulatedMs >= STEP_MS) {
      state.sim.accumulatedMs -= STEP_MS;
      const result = stepSimulation(state.sim);
      stepped = true;
      for (const entry of result.died) {
        state.ctx.send(entry.playerId, { type: "died", payload: { score: entry.score } });
      }
    }
    if (stepped) {
      state.ctx.broadcast(serializeState(state.sim));
    }
  },
};
