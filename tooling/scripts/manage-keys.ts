#!/usr/bin/env tsx
/**
 * Quillby API key management CLI.
 *
 * Usage (run from project root):
 *
 *   # Create a user account first, then create a key for them:
 *   npx tsx scripts/manage-keys.ts create-user <email> <password> <name>
 *
 *   # Create an API key for an existing user:
 *   npx tsx scripts/manage-keys.ts create <userId> <keyName> [rateLimitMax]
 *
 *   # List all keys for a user:
 *   npx tsx scripts/manage-keys.ts list <userId>
 *
 *   # Revoke a key by its ID:
 *   npx tsx scripts/manage-keys.ts revoke <keyId>
 *
 * Env vars required:
 *   QUILLBY_AUTH_DB_URL  — defaults to file:./quillby-auth.db
 *   LIBSQL_AUTH_TOKEN    — only needed for remote Turso connections
 */

import "dotenv/config";
import { auth } from "../src/auth.js";

const [, , command, ...args] = process.argv;

async function main(): Promise<void> {
  switch (command) {
    case "create-user": {
      const [email, password, name] = args;
      if (!email || !password || !name) {
        console.error("Usage: manage-keys.ts create-user <email> <password> <name>");
        process.exit(1);
      }
      const result = await auth.api.signUpEmail({ body: { email, password, name } });
      console.log("Created user:");
      console.log(JSON.stringify({ id: result.user.id, email: result.user.email, name: result.user.name }, null, 2));
      break;
    }

    case "create": {
      const [userId, keyName, limitArg] = args;
      if (!userId || !keyName) {
        console.error("Usage: manage-keys.ts create <userId> <keyName> [rateLimitMax]");
        process.exit(1);
      }
      const rateLimitMax = limitArg
        ? parseInt(limitArg, 10)
        : parseInt(process.env.QUILLBY_RATE_LIMIT ?? "60", 10);

      const result = await auth.api.createApiKey({
        body: {
          userId,
          name: keyName,
          rateLimitEnabled: true,
          rateLimitTimeWindow: 60_000, // 1 minute window
          rateLimitMax,
          // prefix makes keys identifiable in logs: "qb_<random>"
          prefix: "qb",
        },
      });

      console.log("Created API key (shown only once — save it now):");
      console.log(
        JSON.stringify(
          { key: result.key, id: result.id, name: keyName, userId, rateLimitMax },
          null,
          2,
        ),
      );
      break;
    }

    case "list": {
      const [userId] = args;
      if (!userId) {
        console.error("Usage: manage-keys.ts list <userId>");
        process.exit(1);
      }
      const keys = await auth.api.listApiKeys({ body: { userId } });
      if (!keys || (Array.isArray(keys) && keys.length === 0)) {
        console.log("No keys found for user:", userId);
      } else {
        console.log(JSON.stringify(keys, null, 2));
      }
      break;
    }

    case "revoke": {
      const [keyId] = args;
      if (!keyId) {
        console.error("Usage: manage-keys.ts revoke <keyId>");
        process.exit(1);
      }
      await auth.api.deleteApiKey({ body: { keyId } });
      console.log(`Revoked key: ${keyId}`);
      break;
    }

    default:
      console.error(
        [
          "Quillby key manager",
          "",
          "Commands:",
          "  create-user <email> <password> <name>",
          "  create      <userId> <keyName> [rateLimitMax]",
          "  list        <userId>",
          "  revoke      <keyId>",
        ].join("\n"),
      );
      process.exit(1);
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
