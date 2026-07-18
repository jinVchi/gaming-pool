import { createHmac, timingSafeEqual } from "node:crypto";

const TOKEN_VERSION = 2;
const DEFAULT_TOKEN_TTL_S = 30 * 60;
const DEV_GAME_AUTH_SECRET = "dev-only-game-auth-secret-change-me";

export interface PlayerTokenPayload {
  version: typeof TOKEN_VERSION;
  playerId: string;
  displayName: string;
  isGuest: boolean;
  expiresAt: number;
}

// Require an explicit shared secret in production; keep local setup one-command.
export function getGameAuthSecret(): string {
  const secret = process.env.GAME_AUTH_SECRET;
  if (secret) {
    if (secret.length < 32) throw new Error("GAME_AUTH_SECRET must be at least 32 characters");
    return secret;
  }
  if (process.env.NODE_ENV === "production") {
    throw new Error("GAME_AUTH_SECRET is required in production");
  }
  return DEV_GAME_AUTH_SECRET;
}

// Derive a stable guest id from a browser-held random credential. The credential
// never becomes the public player id, so seeing a guest in a lobby is not enough
// to impersonate them.
export function deriveGuestPlayerId(credential: string, secret: string): string {
  const digest = createHmac("sha256", secret).update(`guest:${credential}`).digest("hex");
  return `guest_${digest.slice(0, 32)}`;
}

export function signPlayerToken(
  player: { playerId: string; displayName: string; isGuest: boolean },
  secret: string,
  ttlSeconds = DEFAULT_TOKEN_TTL_S,
): string {
  const payload: PlayerTokenPayload = {
    version: TOKEN_VERSION,
    playerId: player.playerId,
    displayName: player.displayName,
    isGuest: player.isGuest,
    expiresAt: Math.floor(Date.now() / 1000) + ttlSeconds,
  };
  const body = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  const signature = createHmac("sha256", secret).update(body).digest("base64url");
  return `${body}.${signature}`;
}

export function verifyPlayerToken(token: string, secret: string): PlayerTokenPayload | null {
  if (token.length > 2048) return null;
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [body, signature] = parts;
  if (!body || !signature) return null;

  const expected = createHmac("sha256", secret).update(body).digest();
  let supplied: Buffer;
  try {
    supplied = Buffer.from(signature, "base64url");
  } catch {
    return null;
  }
  if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) return null;

  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as Partial<PlayerTokenPayload>;
    if (
      payload.version !== TOKEN_VERSION ||
      typeof payload.playerId !== "string" ||
      payload.playerId.length < 1 ||
      payload.playerId.length > 128 ||
      typeof payload.displayName !== "string" ||
      payload.displayName.length < 1 ||
      payload.displayName.length > 48 ||
      typeof payload.isGuest !== "boolean" ||
      typeof payload.expiresAt !== "number" ||
      !Number.isSafeInteger(payload.expiresAt) ||
      payload.expiresAt <= Math.floor(Date.now() / 1000)
    ) {
      return null;
    }
    return payload as PlayerTokenPayload;
  } catch {
    return null;
  }
}
