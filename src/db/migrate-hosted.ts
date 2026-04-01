import { sql } from "drizzle-orm";
import type { QuillbyDb } from "../db.js";

/**
 * Ensure hosted workspace storage tables exist.
 * Safe to call multiple times — all statements use CREATE TABLE IF NOT EXISTS.
 * Called lazily on the first operation for each HostedDbWorkspaceStorage instance.
 */
export async function ensureHostedTables(dbInstance: QuillbyDb): Promise<void> {
  const ddl = [
    sql.raw(`CREATE TABLE IF NOT EXISTS hosted_user_state (
      user_id TEXT PRIMARY KEY,
      current_workspace_id TEXT NOT NULL,
      updated_at INTEGER NOT NULL DEFAULT (cast(unixepoch('subsecond') * 1000 as integer))
    )`),
    sql.raw(`CREATE TABLE IF NOT EXISTS hosted_workspace (
      user_id TEXT NOT NULL,
      workspace_id TEXT NOT NULL,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      created_at INTEGER NOT NULL DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)),
      updated_at INTEGER NOT NULL DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)),
      PRIMARY KEY (user_id, workspace_id)
    )`),
    sql.raw(`CREATE TABLE IF NOT EXISTS hosted_workspace_context (
      user_id TEXT NOT NULL,
      workspace_id TEXT NOT NULL,
      data TEXT NOT NULL,
      updated_at INTEGER NOT NULL DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)),
      PRIMARY KEY (user_id, workspace_id)
    )`),
    sql.raw(`CREATE TABLE IF NOT EXISTS hosted_workspace_memory (
      user_id TEXT NOT NULL,
      workspace_id TEXT NOT NULL,
      data TEXT NOT NULL,
      updated_at INTEGER NOT NULL DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)),
      PRIMARY KEY (user_id, workspace_id)
    )`),
    sql.raw(`CREATE TABLE IF NOT EXISTS hosted_workspace_sources (
      user_id TEXT NOT NULL,
      workspace_id TEXT NOT NULL,
      urls TEXT NOT NULL DEFAULT '[]',
      PRIMARY KEY (user_id, workspace_id)
    )`),
    sql.raw(`CREATE TABLE IF NOT EXISTS hosted_workspace_seen_urls (
      user_id TEXT NOT NULL,
      workspace_id TEXT NOT NULL,
      urls TEXT NOT NULL DEFAULT '[]',
      PRIMARY KEY (user_id, workspace_id)
    )`),
    sql.raw(`CREATE TABLE IF NOT EXISTS hosted_workspace_harvest (
      user_id TEXT NOT NULL,
      workspace_id TEXT NOT NULL,
      data TEXT NOT NULL,
      generated_at INTEGER NOT NULL DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)),
      PRIMARY KEY (user_id, workspace_id)
    )`),
    sql.raw(`CREATE TABLE IF NOT EXISTS hosted_workspace_draft (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      workspace_id TEXT NOT NULL,
      platform TEXT NOT NULL,
      card_id INTEGER,
      content TEXT NOT NULL,
      created_at INTEGER NOT NULL DEFAULT (cast(unixepoch('subsecond') * 1000 as integer))
    )`),
  ];

  for (const stmt of ddl) {
    await dbInstance.run(stmt);
  }
}
