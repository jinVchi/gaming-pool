import { serve } from "@hono/node-server";
import { getConnInfo } from "@hono/node-server/conninfo";
import { Hono, type Context } from "hono";
import { cors } from "hono/cors";
import {
  deriveGuestPlayerId,
  gameConfigs,
  getGameAuthSecret,
  isGameSlug,
  signPlayerToken,
  verifyPlayerToken,
  type PlayerTokenPayload,
} from "@gaming-pool/shared";
import { auth } from "./auth";
import {
  MatchmakingError,
  assignAutoRoom,
  createRoom,
  joinRoomByCode,
  joinRoomById,
  listOpenRooms,
} from "./matchmaking";

const app = new Hono();
const gameAuthSecret = getGameAuthSecret();
const GUEST_TOKEN_LIMIT = 30;
const GUEST_TOKEN_WINDOW_MS = 60_000;
const trustProxy = process.env.TRUST_PROXY === "true";
const guestTokenWindows = new Map<string, { startedAt: number; count: number }>();
const guestTokenCleanup = setInterval(() => {
  const cutoff = Date.now() - GUEST_TOKEN_WINDOW_MS * 2;
  for (const [address, window] of guestTokenWindows) {
    if (window.startedAt < cutoff) guestTokenWindows.delete(address);
  }
}, GUEST_TOKEN_WINDOW_MS);
guestTokenCleanup.unref();

// WEB_ORIGIN is a comma-separated CORS allowlist (default: local web).
const allowedOrigins = (process.env.WEB_ORIGIN ?? "http://localhost:3000")
  .split(",")
  .map((o) => o.trim());

app.use(
  "*",
  cors({
    origin: allowedOrigins,
    allowMethods: ["GET", "POST", "OPTIONS"],
    allowHeaders: ["Content-Type", "Authorization"],
    credentials: true,
  }),
);

// Liveness probe.
app.get("/health", (c) => c.json({ ok: true }));

// Better Auth session/login handlers.
app.on(["GET", "POST"], "/api/auth/*", (c) => auth.handler(c.req.raw));

function clientAddress(c: Context): string {
  const directAddress = getConnInfo(c).remote.address ?? "unknown";
  // Fly sets this header itself; only trust it when the Fly runtime is present.
  if (process.env.FLY_APP_NAME) return c.req.header("fly-client-ip") ?? directAddress;
  if (!trustProxy) return directAddress;
  // TRUST_PROXY requires the front proxy to replace, not append to, client XFF.
  return c.req.header("x-forwarded-for")?.split(",")[0]?.trim() || directAddress;
}

function consumeGuestTokenLimit(address: string): number | null {
  const now = Date.now();
  const window = guestTokenWindows.get(address);
  if (!window || now - window.startedAt >= GUEST_TOKEN_WINDOW_MS) {
    guestTokenWindows.set(address, { startedAt: now, count: 1 });
    return null;
  }
  window.count += 1;
  if (window.count <= GUEST_TOKEN_LIMIT) return null;
  return Math.max(1, Math.ceil((GUEST_TOKEN_WINDOW_MS - (now - window.startedAt)) / 1000));
}

function matchmakingFailure(c: Context, err: unknown) {
  if (err instanceof MatchmakingError) return c.json({ error: err.message }, err.status);
  console.error("[matchmaking] infrastructure failure:", err);
  return c.json({ error: "matchmaking is temporarily unavailable" }, 500);
}

function authenticatedPlayer(authorization: string | undefined): PlayerTokenPayload | null {
  if (!authorization?.startsWith("Bearer ")) return null;
  return verifyPlayerToken(authorization.slice("Bearer ".length), gameAuthSecret);
}

// Exchange a Better Auth session or browser-held guest credential for a short-
// lived game token used by matchmaking and the direct WebSocket connection.
app.post("/player-token", async (c) => {
  const session = await auth.api.getSession({ headers: c.req.raw.headers });
  let playerId: string;
  let displayName: string;
  let isGuest: boolean;

  if (session?.user) {
    playerId = session.user.id;
    displayName = (session.user.name || "Player").slice(0, 48);
    isGuest = false;
  } else {
    const retryAfter = consumeGuestTokenLimit(clientAddress(c));
    if (retryAfter) {
      c.header("Retry-After", String(retryAfter));
      return c.json({ error: "too many guest token requests" }, 429);
    }
    const body = await c.req
      .json<{ guestCredential?: string; displayName?: string }>()
      .catch(() => ({}) as Record<string, never>);
    if (!body.guestCredential || !/^[a-f0-9]{32}$/i.test(body.guestCredential)) {
      return c.json({ error: "a valid guest credential is required" }, 400);
    }
    if (!body.displayName || body.displayName.length > 32) {
      return c.json({ error: "a guest display name between 1 and 32 characters is required" }, 400);
    }
    playerId = deriveGuestPlayerId(body.guestCredential, gameAuthSecret);
    displayName = body.displayName;
    isGuest = true;
  }

  return c.json({
    playerId,
    displayName,
    token: signPlayerToken({ playerId, displayName, isGuest }, gameAuthSecret),
  });
});

// Auto-policy matchmaking → { server, roomId }.
app.post("/matchmake/:slug", async (c) => {
  const slug = c.req.param("slug");
  if (!isGameSlug(slug)) return c.json({ error: `unknown game "${slug}"` }, 404);
  const config = gameConfigs[slug];

  const player = authenticatedPlayer(c.req.header("Authorization"));
  if (!player) return c.json({ error: "valid player token required" }, 401);

  if (config.policy === "auto") {
    try {
      return c.json(await assignAutoRoom(slug, player.playerId));
    } catch (err) {
      return matchmakingFailure(c, err);
    }
  }
  return c.json({ error: `game "${slug}" uses 'created' policy — use POST /rooms/:slug` }, 400);
});

// Create a created-policy room (host).
app.post("/rooms/:slug", async (c) => {
  const slug = c.req.param("slug");
  if (!isGameSlug(slug)) return c.json({ error: `unknown game "${slug}"` }, 404);
  const config = gameConfigs[slug];
  if (config.policy !== "created") {
    return c.json({ error: `game "${slug}" does not use 'created' policy` }, 400);
  }

  const player = authenticatedPlayer(c.req.header("Authorization"));
  if (!player) return c.json({ error: "valid player token required" }, 401);

  try {
    return c.json(await createRoom(slug, player.playerId, player.displayName));
  } catch (err) {
    return matchmakingFailure(c, err);
  }
});

// List publicly joinable created-policy rooms.
app.get("/rooms/:slug", async (c) => {
  const slug = c.req.param("slug");
  if (!isGameSlug(slug)) return c.json({ error: `unknown game "${slug}"` }, 404);
  const config = gameConfigs[slug];
  if (config.policy !== "created" || config.joinCode) {
    return c.json({ error: `game "${slug}" does not use public room listing` }, 400);
  }
  return c.json(await listOpenRooms(slug));
});

// Join a created-policy room by roomId or joinCode.
app.post("/rooms/:slug/join", async (c) => {
  const slug = c.req.param("slug");
  if (!isGameSlug(slug)) return c.json({ error: `unknown game "${slug}"` }, 404);
  const config = gameConfigs[slug];
  if (config.policy !== "created") {
    return c.json({ error: `game "${slug}" does not use 'created' policy` }, 400);
  }

  const player = authenticatedPlayer(c.req.header("Authorization"));
  if (!player) return c.json({ error: "valid player token required" }, 401);
  const body = await c.req.json<{ joinCode?: string; roomId?: string }>().catch(() => ({}) as Record<string, never>);

  try {
    if (config.joinCode) {
      if (!body.joinCode) return c.json({ error: "joinCode is required" }, 400);
      return c.json(await joinRoomByCode(slug, body.joinCode, player.playerId));
    }
    if (!body.roomId) return c.json({ error: "roomId is required" }, 400);
    return c.json(await joinRoomById(slug, body.roomId, player.playerId));
  } catch (err) {
    return matchmakingFailure(c, err);
  }
});

const port = Number(process.env.PORT ?? 4000);

app.onError((err, c) => {
  console.error("[api] unhandled error:", err);
  return c.json({ error: "internal server error" }, 500);
});

serve({ fetch: app.fetch, port }, (info) => {
  console.log(`api listening on http://localhost:${info.port}`);
});
