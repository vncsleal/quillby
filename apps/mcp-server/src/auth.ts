import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { apiKey } from "@better-auth/api-key";
import { db } from "./db.js";
import * as schema from "./db/schema.js";

// QUILLBY_RATE_LIMIT sets the default max requests per minute for new API keys.
// Individual keys can override this at creation time via manage-keys.ts.
const defaultRateLimitMax = parseInt(process.env.QUILLBY_RATE_LIMIT ?? "60", 10);
type BetterAuthOptions = Parameters<typeof betterAuth>[0];

const apiKeyPlugin = apiKey({
  // Keys are validated on every /mcp request — enableSessionForAPIKeys
  // is OFF to avoid the per-request double-hit on rate limit counters.
  enableSessionForAPIKeys: false,

  // Default rate-limit window: 60 requests per 60 seconds.
  // These defaults apply when a key is created without explicit limits.
  rateLimit: {
    enabled: true,
    maxRequests: defaultRateLimitMax,
    timeWindow: 60_000,
  },
}) as unknown as NonNullable<BetterAuthOptions["plugins"]>[number];

export const auth = betterAuth({
  database: drizzleAdapter(db, {
    provider: "sqlite",
    schema: {
      user: schema.user,
      session: schema.session,
      account: schema.account,
      verification: schema.verification,
      apikey: schema.apikey,
    },
  }),

  // Email + password is the primary way to register users who then generate
  // API keys. Social providers can be added here in a future version.
  emailAndPassword: { enabled: true },

  plugins: [
    apiKeyPlugin,
  ],
});
