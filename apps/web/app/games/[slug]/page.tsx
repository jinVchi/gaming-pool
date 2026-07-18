import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { gameConfigs, isGameSlug } from "@gaming-pool/shared";
import { gameContent } from "@/lib/game-content";
import { PlayShell } from "@/components/PlayShell";

interface GamePageParams {
  params: Promise<{ slug: string }>;
}

export function generateStaticParams() {
  return Object.keys(gameContent).map((slug) => ({ slug }));
}

export async function generateMetadata({ params }: GamePageParams): Promise<Metadata> {
  const { slug } = await params;
  if (!isGameSlug(slug)) return {};
  const content = gameContent[slug];

  return {
    title: `${content.title} — Gaming Pool`,
    description: content.description,
  };
}

export default async function GamePage({ params }: GamePageParams) {
  const { slug } = await params;
  if (!isGameSlug(slug)) notFound();
  const content = gameContent[slug];
  const config = gameConfigs[slug];

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "VideoGame",
    name: content.title,
    description: content.description,
    genre: content.genre,
    playMode: config.maxPlayers > 1 ? "MultiPlayer" : "SinglePlayer",
    applicationCategory: "Game",
    operatingSystem: "Web",
  };

  return (
    <main>
      <a href="/" className="back-link">
        ← Back to lobby
      </a>
      <PlayShell slug={slug} />
      <h1>{content.title}</h1>
      <p>{content.description}</p>
      <section>
        <h2>How to play</h2>
        <ol className="how-to-play">
          {content.howToPlay.map((step) => (
            <li key={step}>{step}</li>
          ))}
        </ol>
      </section>
      <script
        type="application/ld+json"
        // eslint-disable-next-line react/no-danger
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
    </main>
  );
}
