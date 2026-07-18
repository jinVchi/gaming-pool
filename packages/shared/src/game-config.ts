import type { GameConfig } from "./room";

// One entry per game slug. Adding a game means adding a config entry here —
// never a new code path in matchmaking, the game-server host loop, or the web shell.
const configuredGames = {
  snake: { policy: "auto", maxPlayers: 20, fillStrategy: "fullest" },
  // No joinCode: publicly listed via GET /rooms/chess for players to browse and join.
  chess: { policy: "created", maxPlayers: 2 },
} satisfies Record<string, GameConfig>;

export type GameSlug = keyof typeof configuredGames;

// Preserve exact slug keys while widening each value to the common config shape.
export const gameConfigs: Record<GameSlug, GameConfig> = configuredGames;

export function isGameSlug(value: string): value is GameSlug {
  return Object.prototype.hasOwnProperty.call(gameConfigs, value);
}
