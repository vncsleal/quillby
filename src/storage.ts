import {
  listWorkspaces as wsListWorkspaces,
  workspaceExists as wsWorkspaceExists,
  loadWorkspace as wsLoadWorkspace,
  createWorkspace as wsCreateWorkspace,
  getCurrentWorkspaceId,
  getCurrentWorkspace as wsGetCurrentWorkspace,
  setCurrentWorkspace as wsSetCurrentWorkspace,
  touchWorkspace as wsTouchWorkspace,
  workspaceContextExists,
  loadWorkspaceContext,
  saveWorkspaceContext,
  loadTypedMemory as wsLoadTypedMemory,
  appendTypedMemory as wsAppendTypedMemory,
  loadSources as wsLoadSources,
  appendSources as wsAppendSources,
  getSeenUrls as wsGetSeenUrls,
  saveSeenUrls as wsSaveSeenUrls,
} from "./workspaces.js";
import {
  loadLatestHarvest as structsLoadLatest,
  latestHarvestExists as structsLatestExists,
  saveHarvestOutput as structsSaveHarvest,
  saveDraft as structsSaveDraft,
} from "./output/structures.js";
import {
  TypedMemorySchema,
  HarvestBundleSchema,
  UserContextSchema,
  WorkspaceMetadataSchema,
  CardInputSchema,
  type UserContext,
  type TypedMemory,
  type HarvestBundle,
  type CardInput,
  type WorkspaceMetadata,
  type StructureCard,
} from "./types.js";
import { db as defaultDb, createDb, type QuillbyDb } from "./db.js";
import {
  hostedUserState,
  hostedWorkspace as hostedWorkspaceTable,
  hostedWorkspaceContext,
  hostedWorkspaceMemory,
  hostedWorkspaceSources,
  hostedWorkspaceSeenUrls,
  hostedWorkspaceHarvest,
  hostedWorkspaceDraft,
} from "./db/schema.js";
import { eq, and } from "drizzle-orm";
import { ensureHostedTables } from "./db/migrate-hosted.js";
import { randomUUID } from "node:crypto";

const DEFAULT_QUILLBY_HOME = `${process.env.HOME ?? ""}/.quillby`;
const DEFAULT_WORKSPACE_ID = "default";

function sanitizeUserId(userId: string): string {
  return userId
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9_-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "") || "unknown";
}

function slugifyWorkspaceId(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48) || DEFAULT_WORKSPACE_ID;
}

function withScopedHome<T>(homeDir: string, fn: () => T): T {
  const previous = process.env.QUILLBY_HOME;
  process.env.QUILLBY_HOME = homeDir;
  try {
    return fn();
  } finally {
    if (previous == null) {
      delete process.env.QUILLBY_HOME;
    } else {
      process.env.QUILLBY_HOME = previous;
    }
  }
}

export type CreateWorkspaceInput = {
  id?: string;
  name: string;
  description?: string;
  makeCurrent?: boolean;
};

export interface WorkspaceStorage {
  listWorkspaces(): Promise<WorkspaceMetadata[]>;
  workspaceExists(id: string): Promise<boolean>;
  loadWorkspace(id: string): Promise<WorkspaceMetadata | null>;
  createWorkspace(input: CreateWorkspaceInput): Promise<WorkspaceMetadata>;
  getCurrentWorkspaceId(): Promise<string>;
  getCurrentWorkspace(): Promise<WorkspaceMetadata>;
  setCurrentWorkspace(id: string): Promise<WorkspaceMetadata>;
  touchWorkspace(id: string): Promise<void>;
  contextExists(): Promise<boolean>;
  loadContext(): Promise<UserContext | null>;
  saveContext(ctx: UserContext): Promise<void>;
  loadTypedMemory(): Promise<TypedMemory>;
  appendTypedMemory(type: keyof TypedMemory, entries: string[], limit?: number): Promise<void>;
  loadSources(): Promise<string[]>;
  appendSources(urls: string[]): Promise<{ added: number; skipped: number }>;
  getSeenUrls(): Promise<Set<string>>;
  saveSeenUrls(urls: Set<string>): Promise<void>;
  loadLatestHarvest(): Promise<HarvestBundle>;
  latestHarvestExists(): Promise<boolean>;
  saveHarvestOutput(cards: CardInput[], seenUrls: Set<string>): Promise<string>;
  saveDraft(content: string, platform: string, cardId?: number): Promise<string>;
}

// ── Local filesystem storage (stdio mode and local CLI) ──────────────────────

export class LocalWorkspaceStorage implements WorkspaceStorage {
  async listWorkspaces() { return wsListWorkspaces(); }
  async workspaceExists(id: string) { return wsWorkspaceExists(id); }
  async loadWorkspace(id: string) { return wsLoadWorkspace(id); }
  async createWorkspace(input: CreateWorkspaceInput) { return wsCreateWorkspace(input); }
  async getCurrentWorkspaceId() { return getCurrentWorkspaceId(); }
  async getCurrentWorkspace() { return wsGetCurrentWorkspace(); }
  async setCurrentWorkspace(id: string) { return wsSetCurrentWorkspace(id); }
  async touchWorkspace(id: string) { wsTouchWorkspace(id); }
  async contextExists() { return workspaceContextExists(getCurrentWorkspaceId()); }
  async loadContext() { return loadWorkspaceContext(getCurrentWorkspaceId()); }
  async saveContext(ctx: UserContext) { saveWorkspaceContext(getCurrentWorkspaceId(), ctx); }
  async loadTypedMemory() { return wsLoadTypedMemory(getCurrentWorkspaceId()); }
  async appendTypedMemory(type: keyof TypedMemory, entries: string[], limit?: number) {
    wsAppendTypedMemory(getCurrentWorkspaceId(), type, entries, limit);
  }
  async loadSources() { return wsLoadSources(getCurrentWorkspaceId()); }
  async appendSources(urls: string[]) { return wsAppendSources(getCurrentWorkspaceId(), urls); }
  async getSeenUrls() { return wsGetSeenUrls(getCurrentWorkspaceId()); }
  async saveSeenUrls(urls: Set<string>) { wsSaveSeenUrls(getCurrentWorkspaceId(), urls); }
  async loadLatestHarvest() { return structsLoadLatest(); }
  async latestHarvestExists() { return structsLatestExists(); }
  async saveHarvestOutput(cards: CardInput[], seenUrls: Set<string>) { return structsSaveHarvest(cards, seenUrls); }
  async saveDraft(content: string, platform: string, cardId?: number) { return structsSaveDraft(content, platform, cardId); }
}

export const storage = new LocalWorkspaceStorage();

// ── Scoped filesystem storage (wraps each call in a QUILLBY_HOME swap) ───────
// Kept for reference but not used in hosted mode after v0.8.

class ScopedWorkspaceStorage implements WorkspaceStorage {
  constructor(private readonly homeDir: string) {}

  async listWorkspaces() { return withScopedHome(this.homeDir, () => wsListWorkspaces()); }
  async workspaceExists(id: string) { return withScopedHome(this.homeDir, () => wsWorkspaceExists(id)); }
  async loadWorkspace(id: string) { return withScopedHome(this.homeDir, () => wsLoadWorkspace(id)); }
  async createWorkspace(input: CreateWorkspaceInput) { return withScopedHome(this.homeDir, () => wsCreateWorkspace(input)); }
  async getCurrentWorkspaceId() { return withScopedHome(this.homeDir, () => getCurrentWorkspaceId()); }
  async getCurrentWorkspace() { return withScopedHome(this.homeDir, () => wsGetCurrentWorkspace()); }
  async setCurrentWorkspace(id: string) { return withScopedHome(this.homeDir, () => wsSetCurrentWorkspace(id)); }
  async touchWorkspace(id: string) { withScopedHome(this.homeDir, () => wsTouchWorkspace(id)); }
  async contextExists() { return withScopedHome(this.homeDir, () => workspaceContextExists(getCurrentWorkspaceId())); }
  async loadContext() { return withScopedHome(this.homeDir, () => loadWorkspaceContext(getCurrentWorkspaceId())); }
  async saveContext(ctx: UserContext) { withScopedHome(this.homeDir, () => saveWorkspaceContext(getCurrentWorkspaceId(), ctx)); }
  async loadTypedMemory() { return withScopedHome(this.homeDir, () => wsLoadTypedMemory(getCurrentWorkspaceId())); }
  async appendTypedMemory(type: keyof TypedMemory, entries: string[], limit?: number) {
    withScopedHome(this.homeDir, () => wsAppendTypedMemory(getCurrentWorkspaceId(), type, entries, limit));
  }
  async loadSources() { return withScopedHome(this.homeDir, () => wsLoadSources(getCurrentWorkspaceId())); }
  async appendSources(urls: string[]) { return withScopedHome(this.homeDir, () => wsAppendSources(getCurrentWorkspaceId(), urls)); }
  async getSeenUrls() { return withScopedHome(this.homeDir, () => wsGetSeenUrls(getCurrentWorkspaceId())); }
  async saveSeenUrls(urls: Set<string>) { withScopedHome(this.homeDir, () => wsSaveSeenUrls(getCurrentWorkspaceId(), urls)); }
  async loadLatestHarvest() { return withScopedHome(this.homeDir, () => structsLoadLatest()); }
  async latestHarvestExists() { return withScopedHome(this.homeDir, () => structsLatestExists()); }
  async saveHarvestOutput(cards: CardInput[], seenUrls: Set<string>) {
    return withScopedHome(this.homeDir, () => structsSaveHarvest(cards, seenUrls));
  }
  async saveDraft(content: string, platform: string, cardId?: number) {
    return withScopedHome(this.homeDir, () => structsSaveDraft(content, platform, cardId));
  }
}

// ── Database-backed hosted storage (HTTP mode, v0.8+) ────────────────────────
// All data is partitioned by userId — each user's workspaces, context, memory,
// sources, harvests, and drafts are completely isolated in the shared DB.

export class HostedDbWorkspaceStorage implements WorkspaceStorage {
  private initPromise: Promise<void> | null = null;

  constructor(
    private readonly userId: string,
    private readonly db: QuillbyDb = defaultDb
  ) {}

  private async ensureInit(): Promise<void> {
    if (!this.initPromise) {
      this.initPromise = (async () => {
        await ensureHostedTables(this.db);
        // Bootstrap the user's workspace system if this is their first access.
        const existing = await this.db
          .select({ id: hostedWorkspaceTable.workspaceId })
          .from(hostedWorkspaceTable)
          .where(eq(hostedWorkspaceTable.userId, this.userId))
          .limit(1);
        if (existing.length === 0) {
          await this._insertWorkspace(DEFAULT_WORKSPACE_ID, "Default Workspace", "Primary Quillby workspace.", true);
        }
      })();
    }
    return this.initPromise;
  }

  private async _insertWorkspace(
    workspaceId: string,
    name: string,
    description: string,
    makeCurrent: boolean
  ): Promise<WorkspaceMetadata> {
    const now = new Date();
    await this.db.insert(hostedWorkspaceTable).values({
      userId: this.userId,
      workspaceId,
      name,
      description,
      createdAt: now,
      updatedAt: now,
    });
    if (makeCurrent) {
      await this._setCurrentWorkspaceId(workspaceId);
    }
    return WorkspaceMetadataSchema.parse({
      id: workspaceId,
      name,
      description,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    });
  }

  private async _setCurrentWorkspaceId(workspaceId: string): Promise<void> {
    await this.db
      .insert(hostedUserState)
      .values({ userId: this.userId, currentWorkspaceId: workspaceId, updatedAt: new Date() })
      .onConflictDoUpdate({
        target: hostedUserState.userId,
        set: { currentWorkspaceId: workspaceId, updatedAt: new Date() },
      });
  }

  private rowToMetadata(r: { workspaceId: string; name: string; description: string; createdAt: Date | number; updatedAt: Date | number }): WorkspaceMetadata {
    const toIso = (v: Date | number) => (v instanceof Date ? v : new Date(v)).toISOString();
    return WorkspaceMetadataSchema.parse({
      id: r.workspaceId,
      name: r.name,
      description: r.description,
      createdAt: toIso(r.createdAt),
      updatedAt: toIso(r.updatedAt),
    });
  }

  async listWorkspaces(): Promise<WorkspaceMetadata[]> {
    await this.ensureInit();
    const rows = await this.db
      .select()
      .from(hostedWorkspaceTable)
      .where(eq(hostedWorkspaceTable.userId, this.userId))
      .orderBy(hostedWorkspaceTable.name);
    return rows.map((r) => this.rowToMetadata(r));
  }

  async workspaceExists(id: string): Promise<boolean> {
    await this.ensureInit();
    const rows = await this.db
      .select({ id: hostedWorkspaceTable.workspaceId })
      .from(hostedWorkspaceTable)
      .where(and(eq(hostedWorkspaceTable.userId, this.userId), eq(hostedWorkspaceTable.workspaceId, id)))
      .limit(1);
    return rows.length > 0;
  }

  async loadWorkspace(id: string): Promise<WorkspaceMetadata | null> {
    await this.ensureInit();
    const rows = await this.db
      .select()
      .from(hostedWorkspaceTable)
      .where(and(eq(hostedWorkspaceTable.userId, this.userId), eq(hostedWorkspaceTable.workspaceId, id)))
      .limit(1);
    if (rows.length === 0) return null;
    return this.rowToMetadata(rows[0]);
  }

  async createWorkspace(input: CreateWorkspaceInput): Promise<WorkspaceMetadata> {
    await this.ensureInit();
    const workspaceId = slugifyWorkspaceId(input.id ?? input.name);
    if (await this.workspaceExists(workspaceId)) {
      throw new Error(`Workspace "${workspaceId}" already exists.`);
    }
    return this._insertWorkspace(
      workspaceId,
      input.name.trim() || workspaceId,
      input.description?.trim() ?? "",
      input.makeCurrent ?? false
    );
  }

  async getCurrentWorkspaceId(): Promise<string> {
    await this.ensureInit();
    const rows = await this.db
      .select({ id: hostedUserState.currentWorkspaceId })
      .from(hostedUserState)
      .where(eq(hostedUserState.userId, this.userId))
      .limit(1);
    if (rows.length > 0) return rows[0].id;
    const workspaces = await this.listWorkspaces();
    const fallback = workspaces[0]?.id ?? DEFAULT_WORKSPACE_ID;
    await this._setCurrentWorkspaceId(fallback);
    return fallback;
  }

  async getCurrentWorkspace(): Promise<WorkspaceMetadata> {
    const id = await this.getCurrentWorkspaceId();
    const ws = await this.loadWorkspace(id);
    if (!ws) {
      return this._insertWorkspace(DEFAULT_WORKSPACE_ID, "Default Workspace", "", true);
    }
    return ws;
  }

  async setCurrentWorkspace(id: string): Promise<WorkspaceMetadata> {
    await this.ensureInit();
    const ws = await this.loadWorkspace(id);
    if (!ws) throw new Error(`Workspace "${id}" does not exist.`);
    await this._setCurrentWorkspaceId(id);
    return ws;
  }

  async touchWorkspace(id: string): Promise<void> {
    await this.ensureInit();
    await this.db
      .update(hostedWorkspaceTable)
      .set({ updatedAt: new Date() })
      .where(and(eq(hostedWorkspaceTable.userId, this.userId), eq(hostedWorkspaceTable.workspaceId, id)));
  }

  async contextExists(): Promise<boolean> {
    await this.ensureInit();
    const currentId = await this.getCurrentWorkspaceId();
    const rows = await this.db
      .select({ data: hostedWorkspaceContext.data })
      .from(hostedWorkspaceContext)
      .where(and(eq(hostedWorkspaceContext.userId, this.userId), eq(hostedWorkspaceContext.workspaceId, currentId)))
      .limit(1);
    return rows.length > 0;
  }

  async loadContext(): Promise<UserContext | null> {
    await this.ensureInit();
    const currentId = await this.getCurrentWorkspaceId();
    const rows = await this.db
      .select({ data: hostedWorkspaceContext.data })
      .from(hostedWorkspaceContext)
      .where(and(eq(hostedWorkspaceContext.userId, this.userId), eq(hostedWorkspaceContext.workspaceId, currentId)))
      .limit(1);
    if (rows.length === 0) return null;
    try { return UserContextSchema.parse(JSON.parse(rows[0].data)); } catch { return null; }
  }

  async saveContext(ctx: UserContext): Promise<void> {
    await this.ensureInit();
    const currentId = await this.getCurrentWorkspaceId();
    const data = JSON.stringify(UserContextSchema.parse(ctx));
    await this.db
      .insert(hostedWorkspaceContext)
      .values({ userId: this.userId, workspaceId: currentId, data, updatedAt: new Date() })
      .onConflictDoUpdate({
        target: [hostedWorkspaceContext.userId, hostedWorkspaceContext.workspaceId],
        set: { data, updatedAt: new Date() },
      });
    await this.touchWorkspace(currentId);
  }

  async loadTypedMemory(): Promise<TypedMemory> {
    await this.ensureInit();
    const currentId = await this.getCurrentWorkspaceId();
    const rows = await this.db
      .select({ data: hostedWorkspaceMemory.data })
      .from(hostedWorkspaceMemory)
      .where(and(eq(hostedWorkspaceMemory.userId, this.userId), eq(hostedWorkspaceMemory.workspaceId, currentId)))
      .limit(1);
    if (rows.length === 0) return TypedMemorySchema.parse({});
    try { return TypedMemorySchema.parse(JSON.parse(rows[0].data)); } catch { return TypedMemorySchema.parse({}); }
  }

  async appendTypedMemory(type: keyof TypedMemory, entries: string[], limit?: number): Promise<void> {
    await this.ensureInit();
    const currentId = await this.getCurrentWorkspaceId();
    const current = await this.loadTypedMemory();
    const existing = current[type];
    const deduped = [...new Set([...entries, ...existing].map((e) => e.trim()).filter(Boolean))];
    const next = limit != null ? deduped.slice(0, limit) : deduped;
    const data = JSON.stringify(TypedMemorySchema.parse({ ...current, [type]: next }));
    await this.db
      .insert(hostedWorkspaceMemory)
      .values({ userId: this.userId, workspaceId: currentId, data, updatedAt: new Date() })
      .onConflictDoUpdate({
        target: [hostedWorkspaceMemory.userId, hostedWorkspaceMemory.workspaceId],
        set: { data, updatedAt: new Date() },
      });
    await this.touchWorkspace(currentId);
  }

  async loadSources(): Promise<string[]> {
    await this.ensureInit();
    const currentId = await this.getCurrentWorkspaceId();
    const rows = await this.db
      .select({ urls: hostedWorkspaceSources.urls })
      .from(hostedWorkspaceSources)
      .where(and(eq(hostedWorkspaceSources.userId, this.userId), eq(hostedWorkspaceSources.workspaceId, currentId)))
      .limit(1);
    if (rows.length === 0) return [];
    try { return JSON.parse(rows[0].urls) as string[]; } catch { return []; }
  }

  async appendSources(newUrls: string[]): Promise<{ added: number; skipped: number }> {
    await this.ensureInit();
    const currentId = await this.getCurrentWorkspaceId();
    const existing = await this.loadSources();
    const existingSet = new Set(existing);
    const toAdd = newUrls.filter((u) => u.trim() && !existingSet.has(u.trim()));
    if (toAdd.length === 0) return { added: 0, skipped: newUrls.length };
    const urls = JSON.stringify([...existing, ...toAdd]);
    await this.db
      .insert(hostedWorkspaceSources)
      .values({ userId: this.userId, workspaceId: currentId, urls })
      .onConflictDoUpdate({
        target: [hostedWorkspaceSources.userId, hostedWorkspaceSources.workspaceId],
        set: { urls },
      });
    await this.touchWorkspace(currentId);
    return { added: toAdd.length, skipped: newUrls.length - toAdd.length };
  }

  async getSeenUrls(): Promise<Set<string>> {
    await this.ensureInit();
    const currentId = await this.getCurrentWorkspaceId();
    const rows = await this.db
      .select({ urls: hostedWorkspaceSeenUrls.urls })
      .from(hostedWorkspaceSeenUrls)
      .where(and(eq(hostedWorkspaceSeenUrls.userId, this.userId), eq(hostedWorkspaceSeenUrls.workspaceId, currentId)))
      .limit(1);
    if (rows.length === 0) return new Set();
    try { return new Set(JSON.parse(rows[0].urls) as string[]); } catch { return new Set(); }
  }

  async saveSeenUrls(urls: Set<string>): Promise<void> {
    await this.ensureInit();
    const currentId = await this.getCurrentWorkspaceId();
    const data = JSON.stringify([...urls]);
    await this.db
      .insert(hostedWorkspaceSeenUrls)
      .values({ userId: this.userId, workspaceId: currentId, urls: data })
      .onConflictDoUpdate({
        target: [hostedWorkspaceSeenUrls.userId, hostedWorkspaceSeenUrls.workspaceId],
        set: { urls: data },
      });
  }

  async latestHarvestExists(): Promise<boolean> {
    await this.ensureInit();
    const currentId = await this.getCurrentWorkspaceId();
    const rows = await this.db
      .select({ id: hostedWorkspaceHarvest.workspaceId })
      .from(hostedWorkspaceHarvest)
      .where(and(eq(hostedWorkspaceHarvest.userId, this.userId), eq(hostedWorkspaceHarvest.workspaceId, currentId)))
      .limit(1);
    return rows.length > 0;
  }

  async loadLatestHarvest(): Promise<HarvestBundle> {
    await this.ensureInit();
    const currentId = await this.getCurrentWorkspaceId();
    const rows = await this.db
      .select({ data: hostedWorkspaceHarvest.data })
      .from(hostedWorkspaceHarvest)
      .where(and(eq(hostedWorkspaceHarvest.userId, this.userId), eq(hostedWorkspaceHarvest.workspaceId, currentId)))
      .limit(1);
    if (rows.length === 0) {
      throw new Error("No harvest found. Run quillby_fetch_articles then quillby_save_cards first.");
    }
    return HarvestBundleSchema.parse(JSON.parse(rows[0].data));
  }

  async saveHarvestOutput(cards: CardInput[], _seenUrls?: Set<string>): Promise<string> {
    await this.ensureInit();
    const currentId = await this.getCurrentWorkspaceId();
    const dateLabel = new Date().toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
    const structCards: StructureCard[] = cards.map((raw, index) => ({
      ...CardInputSchema.parse(raw),
      id: index + 1,
      references: [],
    }));
    const bundle: HarvestBundle = {
      generatedAt: new Date().toISOString(),
      dateLabel,
      cards: structCards,
    };
    const data = JSON.stringify(bundle);
    const now = new Date();
    await this.db
      .insert(hostedWorkspaceHarvest)
      .values({ userId: this.userId, workspaceId: currentId, data, generatedAt: now })
      .onConflictDoUpdate({
        target: [hostedWorkspaceHarvest.userId, hostedWorkspaceHarvest.workspaceId],
        set: { data, generatedAt: now },
      });
    await this.touchWorkspace(currentId);
    return `db:${currentId}:harvest`;
  }

  async saveDraft(content: string, platform: string, cardId?: number): Promise<string> {
    await this.ensureInit();
    const currentId = await this.getCurrentWorkspaceId();
    const id = randomUUID();
    await this.db.insert(hostedWorkspaceDraft).values({
      id,
      userId: this.userId,
      workspaceId: currentId,
      platform: platform.toLowerCase(),
      cardId: cardId ?? null,
      content,
      createdAt: new Date(),
    });
    return `draft:${id}`;
  }
}

// ── Factory ───────────────────────────────────────────────────────────────────

const hostedStorageCache = new Map<string, WorkspaceStorage>();

export function getHostedUserStorage(userId: string): WorkspaceStorage {
  const key = sanitizeUserId(userId);
  const cached = hostedStorageCache.get(key);
  if (cached) return cached;
  const instance = new HostedDbWorkspaceStorage(key);
  hostedStorageCache.set(key, instance);
  return instance;
}

export { createDb };

