import type { GameSlug } from "@gaming-pool/shared";
import type { GameModule } from "./types";
import { snakeModule } from "./snake";
import { chessModule } from "./chess";

// One entry per game slug, mirroring packages/shared's gameConfigs. Adding a game
// means registering its module here — never a new code path in the host loop.
export const gameModules: Record<GameSlug, GameModule<any>> = {
  snake: snakeModule,
  chess: chessModule,
};
