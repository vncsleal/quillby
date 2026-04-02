/**
 * migrate-local-to-hosted.ts
 *
 * One-shot CLI to copy local ~/.quillby workspace data into the hosted
 * Quillby database for a given userId.
 *
 * Usage:
 *   npm run migrate -- <userId> [quillbyHome] [--dry-run]
 *
 *   userId      — hosted DB user ID (from `npm run keys create-user`)
 *   quillbyHome — local data directory (default: ~/.quillby)
 *   --dry-run   — print what would be migrated without writing anything
 *
 * The script is idempotent: workspaces already present in the hosted DB are
 * silently skipped so it can safely be re-run after a partial failure.
 */

import "dotenv/config";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { createDb } from "../src/db.js";
import {
  hostedWorkspace as hostedWorkspaceTable,
  hostedUserState,
  hostedWorkspaceContext,
  hostedWorkspaceMemory,
  hostedWorkspaceSources,
  hostedWorkspaceSeenUrls,
  hostedWorkspaceHarvest,
} from "../src/db/schema.js";
import { ensureHostedTables } from "../src/db/migrate-hosted.js";
import { HarvestBundleSchema, TypedMemorySchema } from "../src/types.js";
import {
  listWorkspaces,
  loadWorkspaceContext,
  loadTypedMemory,
  loadSources,
  getSeenUrls,
  getWorkspacePaths,
} from "../src/workspaces.js";
import { eq, and } from "drizzle-orm";

// ── CLI args ──────────────────────────────────────────────────────────────────

const rawArgs = process.argv.slice(2);
const dryRun = rawArgs.includes("--dry-run");
const positional = rawArgs.filter((a) => !a.startsWith("--"));
const [userId, quillbyHomeArg] = positional;
const quillbyHome = path.resolve(quillbyHomeArg ?? path.join(os.homedir(), ".quillby"));

if (!userId) {
  console.error("Usage: npm run migrate -- <userId> [quillbyHome] [--dry-run]");
  console.error("  userId      — hosted DB user ID (from `npm run keys create-user`)");
  console.error("  quillbyHome — local data dir (default: ~/.quillby)");
  console.error("  --dry-run   — print what would be migrated without writing");
  process.exit(1);
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log("\nQuillby local → hosted migration");
  console.log(`  User:    ${userId}`);
  console.log(`  Source:  ${quillbyHome}`);
  console.log(`  Mode:    ${dryRun ? "dry-run (no writes)" : "live"}\n`);

  // Point CONFIG.DATA_DIR getter at the source directory.
  // CONFIG.DATA_DIR re-reads process.env.QUILLBY_HOME on every call, so
  // setting this before any workspace function invocation is sufficient.
  process.env.QUILLBY_HOME = quillbyHome;

  if (!fs.existsSync(quillbyHome)) {
    console.error(`Source directory not found: ${quillbyHome}`);
    process.exit(1);
  }

  // ── Read local workspaces ─────────────────────────────────────────────────

  const workspaces = listWorkspaces();
  if (workspaces.length === 0) {
    console.log("No workspaces found in source — nothing to migrate.");
    return;
  }
  console.log(`Found ${workspaces.length} workspace(s) in source.\n`);

  const currentWorkspaceFile = path.join(quillbyHome, "current_workspace.txt");
  const localCurrentId = fs.existsSync(currentWorkspaceFile)
    ? fs.readFileSync(currentWorkspaceFile, "utf-8").trim() || workspaces[0].id
    : workspaces[0].id;

  // ── Hosted DB setup ───────────────────────────────────────────────────────

  const dbUrl = process.env.QUILLBY_AUTH_DB_URL ?? "file:./quillby-auth.db";
  const { db } = createDb(dbUrl, process.env.LIBSQL_AUTH_TOKEN);

  if (!dryRun) await ensureHostedTables(db);

  // ── Migrate each workspace ────────────────────────────────────────────────

  let migrated = 0;
  let skipped = 0;

  for (const meta of workspaces) {
    const wsId = meta.id;

    // Idempotency: skip workspaces already present in the hosted DB.
    if (!dryRun) {
      const existing = await db
        .select({ workspaceId: hostedWorkspaceTable.workspaceId })
        .from(hostedWorkspaceTable)
        .where(
          and(
            eq(hostedWorkspaceTable.userId, userId),
            eq(hostedWorkspaceTable.workspaceId, wsId)
          )
        )
        .get();

      if (existing) {
        console.log(`[SKIP]     ${wsId}  —  already exists in hosted DB`);
        skipped++;
        continue;
      }
    }

    // Read all local data for this workspace.
    const ctx = loadWorkspaceContext(wsId);
    const typedMem = loadTypedMemory(wsId);
    const sources = loadSources(wsId);
    const seenUrls = getSeenUrls(wsId);

    // Read the latest harvest via the pointer file.
    const wsPaths = getWorkspacePaths(wsId);
    let harvestData: string | null = null;
    let harvestDate: Date | null = null;
    if (fs.existsSync(wsPaths.latestHarvestPointer)) {
      const harvestPath = fs.readFileSync(wsPaths.latestHarvestPointer, "utf-8").trim();
      if (harvestPath && fs.existsSync(harvestPath)) {
        try {
          const raw = JSON.parse(fs.readFileSync(harvestPath, "utf-8"));
          const bundle = HarvestBundleSchema.parse(raw);
          harvestData = JSON.stringify(bundle);
          harvestDate = new Date(bundle.generatedAt);
        } catch {
          console.warn(`  ⚠  Could not parse harvest for ${wsId}, skipping harvest data`);
        }
      }
    }

    const memEntries = Object.values(typedMem).reduce((sum, v) => sum + (v?.length ?? 0), 0);

    console.log(
      `[${dryRun ? "DRY-RUN  " : "MIGRATING"}] ${wsId}  (${meta.name})\n` +
        `           context: ${ctx ? "yes" : "no"} | memory entries: ${memEntries} | ` +
        `sources: ${sources.length} | seen URLs: ${seenUrls.size} | harvest: ${harvestDate ? harvestDate.toISOString().slice(0, 10) : "none"}`
    );

    if (dryRun) {
      migrated++;
      continue;
    }

    // Insert workspace metadata (preserving original timestamps).
    await db.insert(hostedWorkspaceTable).values({
      userId,
      workspaceId: wsId,
      name: meta.name,
      description: meta.description ?? "",
      createdAt: new Date(meta.createdAt),
      updatedAt: new Date(meta.updatedAt),
    });

    if (ctx) {
      await db.insert(hostedWorkspaceContext).values({
        userId,
        workspaceId: wsId,
        data: JSON.stringify(ctx),
      });
    }

    if (memEntries > 0) {
      await db.insert(hostedWorkspaceMemory).values({
        userId,
        workspaceId: wsId,
        data: JSON.stringify(TypedMemorySchema.parse(typedMem)),
      });
    }

    if (sources.length > 0) {
      await db.insert(hostedWorkspaceSources).values({
        userId,
        workspaceId: wsId,
        urls: JSON.stringify(sources),
      });
    }

    if (seenUrls.size > 0) {
      await db.insert(hostedWorkspaceSeenUrls).values({
        userId,
        workspaceId: wsId,
        urls: JSON.stringify([...seenUrls]),
      });
    }

    if (harvestData && harvestDate) {
      await db.insert(hostedWorkspaceHarvest).values({
        userId,
        workspaceId: wsId,
        data: harvestData,
        generatedAt: harvestDate,
      });
    }

    migrated++;
  }

  // ── Set current workspace in hosted DB ────────────────────────────────────

  if (!dryRun && migrated > 0) {
    const hostedCurrentId =
      workspaces.find((w) => w.id === localCurrentId)?.id ?? workspaces[0].id;

    await db
      .insert(hostedUserState)
      .values({ userId, currentWorkspaceId: hostedCurrentId })
      .onConflictDoUpdate({
        target: hostedUserState.userId,
        set: { currentWorkspaceId: hostedCurrentId, updatedAt: new Date() },
      });

    console.log(`\n✓ Current workspace set to: ${hostedCurrentId}`);
  }

  // ── Summary ───────────────────────────────────────────────────────────────

  console.log("\n── Summary " + "─".repeat(52));
  if (dryRun) {
    console.log(`  Would migrate: ${migrated} workspace(s)`);
    console.log(`  Run without --dry-run to apply.`);
  } else {
    console.log(`  Migrated: ${migrated} workspace(s)`);
    console.log(`  Skipped:  ${skipped} workspace(s)  (already in hosted DB)`);
  }
  console.log();
}

main().catch((err) => {
  console.error("\nMigration failed:", err);
  process.exit(1);
});
