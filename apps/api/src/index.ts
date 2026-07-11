import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { gameConfigs } from "@gaming-pool/shared";
import { auth } from "./auth.js";
import { assignAutoRoom, createRoom, joinRoomByCode } from "./matchmaking.js";

const app = new Hono();

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

// created policy: host creates a room and shares the joinCode with others.
app.post("/rooms/:slug", async (c) => {
  const slug = c.req.param("slug");
  const config = gameConfigs[slug];
  if (!config || config.policy !== "created") {
    return c.json({ error: `game "${slug}" does not use 'created' policy` }, 400);
  }
  return c.json(await createRoom(slug));
});

app.post("/rooms/:slug/join", async (c) => {
  const slug = c.req.param("slug");
  const { joinCode } = await c.req.json<{ joinCode: string }>();
  if (!joinCode) return c.json({ error: "joinCode is required" }, 400);

  try {
    return c.json(await joinRoomByCode(slug, joinCode));
  } catch (err) {
    return c.json({ error: (err as Error).message }, 404);
  }
});

const port = Number(process.env.PORT ?? 4000);

serve({ fetch: app.fetch, port }, (info) => {
  console.log(`api listening on http://localhost:${info.port}`);
});
