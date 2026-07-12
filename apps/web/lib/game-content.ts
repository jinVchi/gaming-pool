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
  chess: {
    title: "Chess",
    description:
      "Classic two-player chess. Create a room and wait for a challenger, or join someone else's open game from the lobby.",
    howToPlay: [
      "Create a room, or join an open one from the room list.",
      "The room owner starts the match once the other player is ready.",
      "Tap a piece, then tap a square to move it — standard chess rules apply.",
    ],
    genre: "Board",
  },
};
