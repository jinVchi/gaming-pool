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
  shared/         # Shared types (room, player, protocol), Redis client/keys, gameConfigs
  games/          # Server-side game logic modules (one folder per game) + gameModules registry
  db/             # Drizzle schema + migrations (incl. Better Auth generated schema)
scripts/          # Dev-only helpers (serve-cdn.mjs: local stand-in for the R2 CDN, port 8787)
unity/            # Unity projects (one per game); WebGL builds output here (gitignored)
```

## Core architecture rules

1. **Client connects directly to game servers via WebSocket.** The Global API only assigns `{server, roomId}`; game traffic never proxies through it or through Vercel.
2. **Unity builds never touch Vercel.** They live in R2 with `Content-Encoding: br` headers. Game pages reference CDN URLs in `createUnityInstance` config.
3. **Postgres is off the hot path.** Game ticks and room state stay in memory/Redis. Postgres writes (scores, ratings) are async and batched.
4. **Redis = ephemeral room registry only.** Keys: `rooms:{game}` (sorted set by player count, auto-policy games), `room:{roomId}` (hash: server, game, maxPlayers, and for created-policy rooms joinCode or hostId/hostName+playerCount), `roomcode:{joinCode}` (code → roomId), `roomlist:{game}` (set of publicly-joinable created-policy rooms with an open seat), `playerroom:{playerId}` (player → their active roomId; reserved with a pending TTL on room create *and* join, atomically claimed persistent when the WebSocket joins, released on leave — enforces **one active room/game per player** in the API and the game server; always use the Lua helpers `claimPlayerRoom`/`releasePlayerRoom` in `packages/shared/src/redis.ts`, never plain SET/DEL, so racing claims and delayed cleanups stay safe). Game servers update on join/leave; matchmaking reads. Key builders live in `packages/shared/src/redis.ts` — never hand-format keys. `room:`/`roomcode:` keys start with a pending TTL (set by matchmaking) and are persisted by the game server once the room spins up, so rooms whose host never connects expire on their own.
5. **The web shell owns player identity; Unity never invents it.** `PlayShell` resolves `{ playerId, displayName }` — Better Auth `user.id`+nickname when signed in, otherwise a `Guest-XXXX` identity persisted in localStorage — and `UnityLoader` exposes it as `window.__gamingPoolPlayer`, which Unity reads via the `GPGetPlayerIdentity` jslib bridge (random identity is an Editor-only fallback). `PlayShell` also holds a Web Locks API lock (`gaming-pool:unity-game`) while a game runs, so one browser can only run one Unity game at a time; the server-side `playerroom:` check covers cross-device/cross-browser duplicates.

## Multi-game conventions

- Every game is identified by a **slug** (e.g. `snake`, `beatemup`, etc) used consistently in: URL routes (`/games/[slug]`), R2 paths (`games/{slug}/Build/`), Redis keys, DB rows, and `packages/games/{slug}`.
- **Room policy is per-game config**, not per-game code paths in matchmaking (real entries):
  ```ts
  { snake:    { policy: "auto",    maxPlayers: 20, fillStrategy: "fullest" },
    chess:    { policy: "created", maxPlayers: 2 },                  // no joinCode → publicly listed
    beatemup: { policy: "created", maxPlayers: 4,  joinCode: true } } // (future) private, join via code
  ```
  - `auto`: allocate player to fullest non-full room in their region; create room if none. Rooms are rolling.
  - `created` + `joinCode: true`: player creates a private room, shares the code out-of-band (`POST /rooms/:slug/join` with `joinCode`).
  - `created` without `joinCode`: room is publicly listed (`GET /rooms/:slug` → open rooms with hostName/playerCount) and joined by `roomId`. The room server owns list membership generically: listed when the creator's socket joins (never at API create time, so a stranger can't take over the room before its creator connects), delisted when full, relisted when a seat opens.
- Adding a new game must NOT require changes to matchmaking internals, the game server host loop, or the web shell — only: a game logic module + registration in `packages/games/src/registry.ts`, a config entry in `packages/shared/src/game-config.ts`, SEO content in `apps/web/lib/game-content.ts`, and a Unity build. All three registries are keyed by the same slug.
- Each room runs its own tick loop; game logic modules expose a common interface: `createState(roomId, ctx)`, `onJoin`, `onLeave`, `onMessage`, `tick`. The `ctx` (RoomContext) provides `broadcast`/`send` — modules never touch sockets directly.
- Server logic is authoritative; Unity clients are renderers + input devices. For rules-heavy games prefer an established library over hand-rolling (chess uses `chess.js`).

## Game server rules
- `perMessageDeflate: false` (tiny packets; compression adds latency).
- Implement heartbeat: ping/pong, terminate dead sockets.
- On join/leave: update regional Redis room counts (auto policy) or playerCount/hostName/roomlist membership (created policy). This bookkeeping lives in the room server (`apps/game-server/src/rooms.ts`), never in game modules.
- Rooms with `policy: auto` are rolling (players join mid-game); destroyed after 5 min empty. `created`-policy rooms are destroyed immediately when the last player leaves.
- Clients connect with `?roomId=&playerId=&displayName=` query params; room metadata is resolved from Redis on first connection.
- Force full page load when leaving a game page (Unity WebGL memory is not reliably released on SPA navigation).

## Web app rules
- Game pages are SSG: title, description, how-to-play, screenshots, `VideoGame` JSON-LD. Unity loads client-side only, after user interaction, via `dynamic import` with `ssr: false`.
- Do not import game logic or Unity assets into `apps/web`.
- Every game page needs real SEO content — not a two-line stub.

## Conventions
- TypeScript strict mode everywhere. Shared message protocol types live in `packages/shared` — never duplicate them.
- TypeScript versions are intentionally split: all workspaces use TS 7 (native compiler) **except `apps/web`, which stays on TS 6 (the JS-based bridge compiler)** — Next.js loads `next.config.ts` via TypeScript's programmatic API, which TS 7.0 doesn't ship (`Cannot read properties of undefined (reading 'fileExists')`). Move web to 7 once TS 7.1 (stable programmatic API, ~Oct 2026) is out and Next supports it.
- **Internal relative imports are extensionless** (`from "./schema"`, never `"./schema.js"`). `.js`-suffixed imports break drizzle-kit's config loader and Next.js's webpack resolver. All tsconfigs use `moduleResolution: "Bundler"`.
- Drizzle for all DB access; migrations in `packages/db`. Better Auth owns the identity tables (`user`, `session`, `account`, `verification` — regenerate via its CLI, don't hand-edit `auth-schema.ts`); game tables (`scores`, `ratings`) reference `user.id`.
- Add comments on functions and main steps in functions.Use concise words in comments. 
- Keep answers to "should this hit Postgres?" biased toward **no** — check if Redis or in-memory state suffices first.
- Unity C# in `unity/*/Assets` mirrors the server wire protocol via Newtonsoft.Json DTOs (`Models.cs`) — when a module's protocol changes, update the matching DTOs. Each Unity project is self-contained (the WebSocket `.jslib` bridge + `NetworkClient.cs` are intentionally duplicated per project).
- Modifiy this agents.md when necessary.


## Local development

- Postgres and Redis reuse pre-existing Docker containers on the dev machine (no docker-compose in this repo): `postgres-db` (postgres:17, root/000000, db `gaming_pool` — the `ecommerce` db in the same container belongs to another project) and `redis-server` (redis:8, **logical DB 1**: `redis://localhost:6379/1`).
- Ports: web 3000, api 4000, game-server 5000, CDN dev server 8787.
- Each app has a gitignored `.env` (see committed `.env.example` for expected vars). CORS/auth origins come from `WEB_ORIGIN` on the api.
- Unity WebGL builds go to `unity/{slug}/Build`; Unity names the output after the folder, so files land at `unity/{slug}/Build/Build/Build.*` — the web loader (`apps/web/components/UnityLoader.tsx`) expects exactly that layout. Keep the same layout when uploading to R2.

## Commands

```bash
npm install              # root install (Turborepo workspaces)
npm run dev              # all apps in dev mode + CDN dev server (concurrently)
npm run dev -w apps/web  # single workspace
npm run build            # turbo build
npm run check-types      # type-check all workspaces — run after any TS change
npm run db:generate      # drizzle-kit generate (packages/db)
npm run db:migrate       # drizzle migrations
```

## Deployment (later for production)

- `apps/web` → Vercel (DNS record grey-cloud if domain is on Cloudflare)
- `apps/api` → Fly.io (single region to start)
- `apps/game-server` → Fly.io, multi-region (e.g. nrt, iad, fra); regional Redis per deployment
- Unity builds → uploaded to R2 via wrangler/S3 API in CI; set `Content-Encoding: br` + correct `Content-Type` per file
- **Open decision before multi-region**: per-region Redis registries break publicly-listed rooms (a chess room created in nrt is invisible to a player browsing from fra). Latency-insensitive games likely need a `scope: "global"` per-game config (single home region or global registry) while latency-sensitive games stay regional. Decide before the multi-region deployment bakes in the per-region assumption.
