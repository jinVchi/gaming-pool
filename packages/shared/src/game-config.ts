import type { GameConfig, GameSlug } from "./room";

// One entry per game slug. Adding a game means adding a config entry here —
// never a new code path in matchmaking, the game-server host loop, or the web shell.
export const gameConfigs: Record<GameSlug, GameConfig> = {
  snake: { policy: "auto", maxPlayers: 20, fillStrategy: "fullest" },
  // No joinCode: publicly listed via GET /rooms/chess for players to browse and join.
  chess: { policy: "created", maxPlayers: 2 },
};
