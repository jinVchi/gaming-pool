# AGENTS.md

## Project overview

A web platform hosting a **collection of small games** (not a single game). Desktop browsers only — no mobile support required.

- **Web app**: Next.js (App Router, SSG-first) — SEO pages, game shells, lobby UI. 
- **Game builds**: Unity WebGL, one build per game, Brotli-compressed, will be served from Cloudflare R2 (`cdn.` subdomain) in production. Never bundled into the Next.js app.
- **Global API**: auth + matchmaking service (Hono, Node). 
- **Game servers**: Node.js + `ws` , multiple regional deployments. One process hosts many rooms across multiple games.
- **Data**: single global PostgreSQL (Drizzle ORM) for users/scores/ratings; one Redis per region as the live room registry.
- **Auth**: Better Auth (User can login in either with email or username).

## Repository structure (Turborepo, npm)

```
apps/
  web/            # Next.js site (SEO pages, game pages, lobby)
  api/            # Global API: auth, matchmaking (Hono)
  game-server/    # Regional WebSocket server (Node + ws)
packages/
  shared/         # Shared types: room, player, message protocol
  games/          # Server-side game logic modules (one folder per game)
  db/             # Drizzle schema + migrations
unity/            # Unity projects (one per game); WebGL builds output here
```

## Core architecture rules

1. **Client connects directly to game servers via WebSocket.** The Global API only assigns `{server, roomId}`; game traffic never proxies through it or through Vercel.
2. **Unity builds never touch Vercel.** They live in R2 with `Content-Encoding: br` headers. Game pages reference CDN URLs in `createUnityInstance` config.
3. **Postgres is off the hot path.** Game ticks and room state stay in memory/Redis. Postgres writes (scores, ratings) are async and batched.
4. **Redis = ephemeral room registry only.** Keys: `rooms:{game}` (sorted set by player count), `room:{roomId}` (hash: server, game, maxPlayers, joinCode). Game servers update on join/leave; matchmaking reads.

## Multi-game conventions

- Every game is identified by a **slug** (e.g. `snake`, `beatemup`, etc) used consistently in: URL routes (`/games/[slug]`), R2 paths (`games/{slug}/Build/`), Redis keys, DB rows, and `packages/games/{slug}`.
- **Room policy is per-game config**, not per-game code paths in matchmaking:
  ```ts
  { snake:    { policy: "auto",    maxPlayers: 20, fillStrategy: "fullest" },
    beatemup: { policy: "created", maxPlayers: 4,  joinCode: true } }
  ```
  - `auto`: allocate player to fullest non-full room in their region; create room if none.
  - `created`: player creates room, others join via code/lobby.
- Adding a new game must NOT require changes to matchmaking internals, the game server host loop, or the web shell — only: a game logic module in `packages/games/`, a config entry, a Unity build in R2, and a game page with SEO content.
- Each room runs its own tick loop; game logic modules expose a common interface (`onJoin`, `onLeave`, `onMessage`, `tick`).

## Game server rules
- `perMessageDeflate: false` (tiny packets; compression adds latency).
- Implement heartbeat: ping/pong, terminate dead sockets.
- On join/leave: update regional Redis room counts.
- Rooms with `policy: auto` are rolling (players join mid-game); destroy after N minutes empty.
- Force full page load when leaving a game page (Unity WebGL memory is not reliably released on SPA navigation).

## Web app rules

- Game pages are SSG: title, description, how-to-play, screenshots, `VideoGame` JSON-LD. Unity loads client-side only, after user interaction, via `dynamic import` with `ssr: false`.
- Do not import game logic or Unity assets into `apps/web`.
- Every game page needs real SEO content — not a two-line stub.

## Conventions

- TypeScript strict mode everywhere. Shared message protocol types live in `packages/shared` — never duplicate them.
- Drizzle for all DB access; migrations in `packages/db`.
- Prefer English identifiers/comments.
- Keep answers to "should this hit Postgres?" biased toward **no** — check if Redis or in-memory state suffices first.

## Commands

```bash
npm install              # root install (Turborepo workspaces)
npm run dev              # all apps in dev mode
npm run dev -w apps/web  # single workspace
npm run build            # turbo build
npm run db:migrate       # drizzle migrations
```

## Deployment (later for production)

- `apps/web` → Vercel (DNS record grey-cloud if domain is on Cloudflare)
- `apps/api` → Fly.io (single region to start)
- `apps/game-server` → Fly.io, multi-region (e.g. nrt, iad, fra); regional Redis per deployment
- Unity builds → uploaded to R2 via wrangler/S3 API in CI; set `Content-Encoding: br` + correct `Content-Type` per file
