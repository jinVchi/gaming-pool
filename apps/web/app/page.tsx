import Link from "next/link";
import { gameContent } from "@/lib/game-content";

export default function LobbyPage() {
  const games = Object.entries(gameContent);

  return (
    <main>
      <h1>Gaming Pool</h1>
      {games.length === 0 ? (
        <p>No games yet — the first one lands here once packages/games has an entry.</p>
      ) : (
        <ul className="game-grid">
          {games.map(([slug, content]) => (
            <li key={slug}>
              <Link href={`/games/${slug}`} className="game-card">
                <p className="game-card-title">{content.title}</p>
                <p className="game-card-description">{content.description}</p>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
