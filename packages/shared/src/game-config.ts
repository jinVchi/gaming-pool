import type { GameConfig, GameSlug } from "./room.js";

// One entry per game slug. Adding a game means adding a config entry here —
// never a new code path in matchmaking, the game-server host loop, or the web shell.
export const gameConfigs: Record<GameSlug, GameConfig> = {};
