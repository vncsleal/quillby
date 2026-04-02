import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import * as schema from "./db/schema.js";

// QUILLBY_AUTH_DB_URL accepts any libSQL connection string:
//   file:./quillby-auth.db         — local SQLite (default, zero setup)
//   libsql://<db>.turso.io         — Turso remote  (v0.8+ production)
//   libsql://localhost:8080?tls=0  — local sqld instance

export function createDb(url: string, authToken?: string) {
  const c = createClient({ url, authToken });
  return { client: c, db: drizzle(c, { schema }) };
}

const defaultUrl = process.env.QUILLBY_AUTH_DB_URL ?? "file:./quillby-auth.db";
export const { client, db } = createDb(defaultUrl, process.env.LIBSQL_AUTH_TOKEN);
export type QuillbyDb = typeof db;

export * from "./db/schema.js";
export * from "./db/migrate-hosted.js";
