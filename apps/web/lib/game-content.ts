import type { GameSlug } from "@gaming-pool/shared";

export interface GameContent {
  title: string;
  description: string;
  howToPlay: string[];
  genre: string;
}

// One entry per game slug, alongside packages/shared's gameConfigs and
// packages/games' gameModules. This is SEO/presentation content only —
// apps/web never imports game logic or Unity assets.
export const gameContent: Record<GameSlug, GameContent> = {
  snake: {
    title: "Snake",
    description:
      "A real-time multiplayer take on the classic snake game — up to 20 players share the same arena, competing to grow the longest.",
    howToPlay: [
      "Use the arrow keys to steer your snake.",
      "Eat food to grow longer and increase your score.",
      "Avoid hitting the walls, yourself, or other snakes — one collision ends your run.",
    ],
    genre: "Arcade",
  },
};
