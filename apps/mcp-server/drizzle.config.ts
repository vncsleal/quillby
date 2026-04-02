import { defineConfig } from "drizzle-kit";

const url = process.env.QUILLBY_AUTH_DB_URL ?? "file:./quillby-auth.db";

export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dialect: "turso",
  dbCredentials: {
    url,
    // authToken is only needed for remote Turso — local file:// works without it
    authToken: process.env.LIBSQL_AUTH_TOKEN,
  },
});
