import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { gameConfigs } from "@gaming-pool/shared";
import { auth } from "./auth";
import { assignAutoRoom, createRoom, joinRoomByCode, joinRoomById, listOpenRooms } from "./matchmaking";

const app = new Hono();

// The Unity WebGL client (served from apps/web) calls matchmaking cross-origin.
// WEB_ORIGIN is a comma-separated allowlist; defaults to the local web dev server.
const allowedOrigins = (process.env.WEB_ORIGIN ?? "http://localhost:3000")
  .split(",")
  .map((o) => o.trim());

app.use(
  "*",
  cors({
    origin: allowedOrigins,
    allowMethods: ["GET", "POST", "OPTIONS"],
    allowHeaders: ["Content-Type"],
    credentials: true,
  }),
);

app.get("/health", (c) => c.json({ ok: true }));

app.on(["GET", "POST"], "/api/auth/*", (c) => auth.handler(c.req.raw));

// Matchmaking: assigns { server, roomId } for a game slug. Never proxies game traffic.
app.post("/matchmake/:slug", async (c) => {
  const slug = c.req.param("slug");
  const config = gameConfigs[slug];
  if (!config) return c.json({ error: `unknown game "${slug}"` }, 404);

  if (config.policy === "auto") {
    return c.json(await assignAutoRoom(slug));
  }
  return c.json({ error: `game "${slug}" uses 'created' policy — use POST /rooms/:slug` }, 400);
});

// created policy: host creates a room. Games configured with joinCode:true
// share a private code out-of-band; others are publicly listed for browsing.
app.post("/rooms/:slug", async (c) => {
  const slug = c.req.param("slug");
  const config = gameConfigs[slug];
  if (!config || config.policy !== "created") {
    return c.json({ error: `game "${slug}" does not use 'created' policy` }, 400);
  }

  const body = await c.req.json<{ playerId?: string; displayName?: string }>().catch(() => ({}) as Record<string, never>);
  if (!body.playerId || !body.displayName) {
    return c.json({ error: "playerId and displayName are required" }, 400);
  }

  try {
    return c.json(await createRoom(slug, body.playerId, body.displayName));
  } catch (err) {
    return c.json({ error: (err as Error).message }, 409);
  }
});

// Public room browser — only for created-policy games that don't use a joinCode.
app.get("/rooms/:slug", async (c) => {
  const slug = c.req.param("slug");
  const config = gameConfigs[slug];
  if (!config || config.policy !== "created" || config.joinCode) {
    return c.json({ error: `game "${slug}" does not use public room listing` }, 400);
  }
  return c.json(await listOpenRooms(slug));
});

app.post("/rooms/:slug/join", async (c) => {
  const slug = c.req.param("slug");
  const config = gameConfigs[slug];
  if (!config || config.policy !== "created") {
    return c.json({ error: `game "${slug}" does not use 'created' policy` }, 400);
  }

  const body = await c.req.json<{ joinCode?: string; roomId?: string; playerId?: string }>();
  if (!body.playerId) return c.json({ error: "playerId is required" }, 400);

  try {
    if (config.joinCode) {
      if (!body.joinCode) return c.json({ error: "joinCode is required" }, 400);
      return c.json(await joinRoomByCode(slug, body.joinCode, body.playerId));
    }
    if (!body.roomId) return c.json({ error: "roomId is required" }, 400);
    return c.json(await joinRoomById(slug, body.roomId, body.playerId));
  } catch (err) {
    return c.json({ error: (err as Error).message }, 409);
  }
});

const port = Number(process.env.PORT ?? 4000);

serve({ fetch: app.fetch, port }, (info) => {
  console.log(`api listening on http://localhost:${info.port}`);
});
