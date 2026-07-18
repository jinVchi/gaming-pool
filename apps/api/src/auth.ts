import "dotenv/config";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { username } from "better-auth/plugins";
import { db } from "@gaming-pool/db";

const webOrigins = (process.env.WEB_ORIGIN ?? "http://localhost:3000").split(",").map((o) => o.trim());

export const auth = betterAuth({
  database: drizzleAdapter(db, { provider: "pg" }),
  emailAndPassword: { enabled: true },
  plugins: [username()],
  trustedOrigins: webOrigins,
  advanced: {
    // apps/web (:3000) and apps/api (:4000) are different origins in dev, so the
    // session cookie needs SameSite=None to survive the cross-origin fetch.
    // Browsers allow Secure cookies on http://localhost as a development-only
    // trustworthy-origin exception; production still requires HTTPS.
    defaultCookieAttributes: {
      sameSite: "none",
      secure: true,
    },
  },
});
