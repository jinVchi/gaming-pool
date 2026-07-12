export const GRID_SIZE = 60;
export const STEP_MS = 150;
export const FOOD_COUNT = 30;
export const START_LENGTH = 3;

// Assigned to joining snakes in order, cycling if a room ever exceeds this
// many concurrent joins. Index advances monotonically per room — a snake that
// leaves and rejoins gets the next color in line, not its old one back.
export const SNAKE_COLORS: readonly string[] = [
  "#22c55e", // green
  "#3b82f6", // blue
  "#ef4444", // red
  "#eab308", // yellow
  "#a855f7", // purple
  "#f97316", // orange
  "#06b6d4", // cyan
  "#ec4899", // pink
  "#84cc16", // lime
  "#6366f1", // indigo
];

export type Direction = "up" | "down" | "left" | "right";

const DIRECTION_OFFSETS: Record<Direction, { x: number; y: number }> = {
  up: { x: 0, y: -1 },
  down: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
  right: { x: 1, y: 0 },
};

const OPPOSITE: Record<Direction, Direction> = {
  up: "down",
  down: "up",
  left: "right",
  right: "left",
};

export interface Cell {
  x: number;
  y: number;
}

export interface Snake {
  playerId: string;
  displayName: string;
  color: string;
  segments: Cell[];
  direction: Direction;
  pendingDirection: Direction;
  alive: boolean;
  score: number;
}

export interface SnakeSimState {
  snakes: Map<string, Snake>;
  food: Cell[];
  accumulatedMs: number;
  nextColorIndex: number;
}

function cellKey(cell: Cell): string {
  return `${cell.x},${cell.y}`;
}

function isOccupied(state: SnakeSimState, cell: Cell): boolean {
  for (const snake of state.snakes.values()) {
    for (const segment of snake.segments) {
      if (segment.x === cell.x && segment.y === cell.y) return true;
    }
  }
  for (const f of state.food) {
    if (f.x === cell.x && f.y === cell.y) return true;
  }
  return false;
}

function randomEmptyCell(state: SnakeSimState): Cell {
  for (let attempt = 0; attempt < 200; attempt++) {
    const cell = {
      x: Math.floor(Math.random() * GRID_SIZE),
      y: Math.floor(Math.random() * GRID_SIZE),
    };
    if (!isOccupied(state, cell)) return cell;
  }
  return { x: Math.floor(Math.random() * GRID_SIZE), y: Math.floor(Math.random() * GRID_SIZE) };
}

export function createSimState(): SnakeSimState {
  const state: SnakeSimState = { snakes: new Map(), food: [], accumulatedMs: 0, nextColorIndex: 0 };
  for (let i = 0; i < FOOD_COUNT; i++) {
    state.food.push(randomEmptyCell(state));
  }
  return state;
}

export function spawnSnake(state: SnakeSimState, playerId: string, displayName: string): Snake {
  const head = randomEmptyCellAwayFromEdge(state);
  const direction: Direction = (["up", "down", "left", "right"] as const)[
    Math.floor(Math.random() * 4)
  ]!;
  const offset = DIRECTION_OFFSETS[direction];
  const segments: Cell[] = [];
  for (let i = 0; i < START_LENGTH; i++) {
    segments.push({ x: head.x - offset.x * i, y: head.y - offset.y * i });
  }

  const color = SNAKE_COLORS[state.nextColorIndex % SNAKE_COLORS.length]!;
  state.nextColorIndex += 1;

  const snake: Snake = {
    playerId,
    displayName,
    color,
    segments,
    direction,
    pendingDirection: direction,
    alive: true,
    score: 0,
  };
  state.snakes.set(playerId, snake);
  return snake;
}

function randomEmptyCellAwayFromEdge(state: SnakeSimState): Cell {
  const margin = 5;
  for (let attempt = 0; attempt < 200; attempt++) {
    const cell = {
      x: margin + Math.floor(Math.random() * (GRID_SIZE - margin * 2)),
      y: margin + Math.floor(Math.random() * (GRID_SIZE - margin * 2)),
    };
    if (!isOccupied(state, cell)) return cell;
  }
  return randomEmptyCell(state);
}

export function setDirection(snake: Snake, direction: Direction): void {
  if (!snake.alive) return;
  if (direction === OPPOSITE[snake.direction] && snake.segments.length > 1) return;
  snake.pendingDirection = direction;
}

export function removeSnake(state: SnakeSimState, playerId: string): void {
  state.snakes.delete(playerId);
}

export interface DiedEntry {
  playerId: string;
  score: number;
}

export interface StepResult {
  died: DiedEntry[];
}

interface PendingMove {
  snake: Snake;
  newHead: Cell;
  dead: boolean;
}

// Two-pass: compute every snake's intended move against a single pre-tick
// snapshot, then apply survivors. Keeps collision resolution independent of
// Map iteration order and lets two snakes die from a head-on collision.
export function stepSimulation(state: SnakeSimState): StepResult {
  const died: DiedEntry[] = [];
  const alive = [...state.snakes.values()].filter((s) => s.alive);

  const occupiedBefore = new Set<string>();
  for (const snake of alive) {
    for (const segment of snake.segments) occupiedBefore.add(cellKey(segment));
  }

  const moves: PendingMove[] = alive.map((snake) => {
    snake.direction = snake.pendingDirection;
    const offset = DIRECTION_OFFSETS[snake.direction];
    const head = snake.segments[0]!;
    const newHead: Cell = { x: head.x + offset.x, y: head.y + offset.y };

    const outOfBounds = newHead.x < 0 || newHead.x >= GRID_SIZE || newHead.y < 0 || newHead.y >= GRID_SIZE;
    const dead = outOfBounds || occupiedBefore.has(cellKey(newHead));
    return { snake, newHead, dead };
  });

  const newHeadCounts = new Map<string, number>();
  for (const move of moves) {
    if (move.dead) continue;
    const key = cellKey(move.newHead);
    newHeadCounts.set(key, (newHeadCounts.get(key) ?? 0) + 1);
  }

  for (const move of moves) {
    if (!move.dead && (newHeadCounts.get(cellKey(move.newHead)) ?? 0) > 1) {
      move.dead = true;
    }
  }

  for (const move of moves) {
    if (move.dead) {
      move.snake.alive = false;
      died.push({ playerId: move.snake.playerId, score: move.snake.score });
      continue;
    }

    const foodIndex = state.food.findIndex((f) => f.x === move.newHead.x && f.y === move.newHead.y);
    move.snake.segments.unshift(move.newHead);
    if (foodIndex !== -1) {
      move.snake.score += 1;
      state.food.splice(foodIndex, 1);
      state.food.push(randomEmptyCell(state));
    } else {
      move.snake.segments.pop();
    }
  }

  for (const entry of died) {
    state.snakes.delete(entry.playerId);
  }

  return { died };
}
