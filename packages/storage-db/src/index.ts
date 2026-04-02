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
  type CurationStatus,
} from "@quillby/core";
import {
  DEFAULT_WORKSPACE_ID,
  slugifyWorkspaceId,
  type CreateWorkspaceInput,
  type DraftSummary,
  type WorkspaceStorage,
} from "@quillby/workspace";
import { db as defaultDb, createDb, type QuillbyDb } from "@quillby/database";
import {
  hostedUserState,
  hostedWorkspace as hostedWorkspaceTable,
  hostedWorkspaceContext,
  hostedWorkspaceMemory,
  hostedWorkspaceSources,
  hostedWorkspaceSeenUrls,
  hostedWorkspaceHarvest,
  hostedWorkspaceDraft,
  hostedWorkspaceAccess,
} from "@quillby/database";
import { eq, and } from "drizzle-orm";
import { ensureHostedTables } from "@quillby/database";
import { randomUUID } from "node:crypto";
import {
  getPlanLimits,
  isPlanEnforcementEnabled,
  type PlanLimits,
} from "@quillby/billing";

function sanitizeUserId(userId: string): string {
  return userId
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9_-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "") || "unknown";
}

export type { CreateWorkspaceInput, DraftSummary, WorkspaceStorage };
// ── Database-backed hosted storage (HTTP mode, v0.8+) ────────────────────────
// All data is partitioned by userId — each user's workspaces, context, memory,
// sources, harvests, and drafts are completely isolated in the shared DB.

export class HostedDbWorkspaceStorage implements WorkspaceStorage {
  private initPromise: Promise<void> | null = null;
  /** Set by withWorkspace() to override the active workspace without mutating DB state. */
  _workspaceIdOverride?: string;
  /** Set by withWorkspace() when the pinned workspace belongs to another user (shared access). */
  _ownerUserId?: string;

  constructor(
    private readonly userId: string,
    private readonly db: QuillbyDb = defaultDb
  ) {}

  /** The user whose data rows are read/written for content operations. */
  private get _effectiveUserId(): string { return this._ownerUserId ?? this.userId; }

  private async _limitsForCurrentUser(): Promise<PlanLimits> {
    if (!isPlanEnforcementEnabled()) return getPlanLimits("pro");
    const plan = await this.getPlan();
    return getPlanLimits(plan);
  }

  private async _enforceOwnedWorkspaceLimit(): Promise<void> {
    const limits = await this._limitsForCurrentUser();
    if (limits.maxOwnedWorkspaces == null) return;
    const rows = await this.db
      .select({ id: hostedWorkspaceTable.workspaceId })
      .from(hostedWorkspaceTable)
      .where(eq(hostedWorkspaceTable.userId, this.userId));
    if (rows.length >= limits.maxOwnedWorkspaces) {
      throw new Error(
        `Free plan limit reached: ${limits.maxOwnedWorkspaces} workspaces. Upgrade to pro to create more.`
      );
    }
  }

  private async _enforceDraftLimit(workspaceId: string): Promise<void> {
    const limits = await this._limitsForCurrentUser();
    if (limits.maxDraftsPerWorkspace == null) return;
    const rows = await this.db
      .select({ id: hostedWorkspaceDraft.id })
      .from(hostedWorkspaceDraft)
      .where(
        and(
          eq(hostedWorkspaceDraft.userId, this._effectiveUserId),
          eq(hostedWorkspaceDraft.workspaceId, workspaceId)
        )
      );
    if (rows.length >= limits.maxDraftsPerWorkspace) {
      throw new Error(
        `Free plan limit reached: ${limits.maxDraftsPerWorkspace} drafts per workspace. Upgrade to pro to save more drafts.`
      );
    }
  }

  private async _enforceHarvestCooldown(workspaceId: string): Promise<void> {
    const limits = await this._limitsForCurrentUser();
    if (limits.harvestCooldownMs == null) return;
    const rows = await this.db
      .select({ generatedAt: hostedWorkspaceHarvest.generatedAt })
      .from(hostedWorkspaceHarvest)
      .where(
        and(
          eq(hostedWorkspaceHarvest.userId, this._effectiveUserId),
          eq(hostedWorkspaceHarvest.workspaceId, workspaceId)
        )
      )
      .limit(1);
    const last = rows[0]?.generatedAt;
    if (!last) return;
    const lastTs = last instanceof Date ? last.getTime() : new Date(last).getTime();
    const waitMs = lastTs + limits.harvestCooldownMs - Date.now();
    if (waitMs > 0) {
      const waitMinutes = Math.ceil(waitMs / (60 * 1000));
      throw new Error(
        `Free plan harvest cooldown active. Try again in about ${waitMinutes} minute(s), or upgrade to pro.`
      );
    }
  }

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
    const owned = await this.db
      .select()
      .from(hostedWorkspaceTable)
      .where(eq(hostedWorkspaceTable.userId, this.userId))
      .orderBy(hostedWorkspaceTable.name);
    // Include workspaces shared with this user by other owners.
    const shared = await this.db
      .select({
        workspaceId: hostedWorkspaceTable.workspaceId,
        name: hostedWorkspaceTable.name,
        description: hostedWorkspaceTable.description,
        createdAt: hostedWorkspaceTable.createdAt,
        updatedAt: hostedWorkspaceTable.updatedAt,
      })
      .from(hostedWorkspaceAccess)
      .innerJoin(
        hostedWorkspaceTable,
        and(
          eq(hostedWorkspaceTable.userId, hostedWorkspaceAccess.ownerUserId),
          eq(hostedWorkspaceTable.workspaceId, hostedWorkspaceAccess.workspaceId)
        )
      )
      .where(eq(hostedWorkspaceAccess.granteeUserId, this.userId));
    return [...owned, ...shared].map((r) => this.rowToMetadata(r));
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
    await this._enforceOwnedWorkspaceLimit();
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
    if (this._workspaceIdOverride) return this._workspaceIdOverride;
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
      .where(and(eq(hostedWorkspaceContext.userId, this._effectiveUserId), eq(hostedWorkspaceContext.workspaceId, currentId)))
      .limit(1);
    return rows.length > 0;
  }

  async loadContext(): Promise<UserContext | null> {
    await this.ensureInit();
    const currentId = await this.getCurrentWorkspaceId();
    const rows = await this.db
      .select({ data: hostedWorkspaceContext.data })
      .from(hostedWorkspaceContext)
      .where(and(eq(hostedWorkspaceContext.userId, this._effectiveUserId), eq(hostedWorkspaceContext.workspaceId, currentId)))
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
      .values({ userId: this._effectiveUserId, workspaceId: currentId, data, updatedAt: new Date() })
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
      .where(and(eq(hostedWorkspaceMemory.userId, this._effectiveUserId), eq(hostedWorkspaceMemory.workspaceId, currentId)))
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
      .values({ userId: this._effectiveUserId, workspaceId: currentId, data, updatedAt: new Date() })
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
      .where(and(eq(hostedWorkspaceSources.userId, this._effectiveUserId), eq(hostedWorkspaceSources.workspaceId, currentId)))
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
      .values({ userId: this._effectiveUserId, workspaceId: currentId, urls })
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
      .where(and(eq(hostedWorkspaceSeenUrls.userId, this._effectiveUserId), eq(hostedWorkspaceSeenUrls.workspaceId, currentId)))
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
      .values({ userId: this._effectiveUserId, workspaceId: currentId, urls: data })
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
      .where(and(eq(hostedWorkspaceHarvest.userId, this._effectiveUserId), eq(hostedWorkspaceHarvest.workspaceId, currentId)))
      .limit(1);
    return rows.length > 0;
  }

  async loadLatestHarvest(): Promise<HarvestBundle> {
    await this.ensureInit();
    const currentId = await this.getCurrentWorkspaceId();
    const rows = await this.db
      .select({ data: hostedWorkspaceHarvest.data })
      .from(hostedWorkspaceHarvest)
      .where(and(eq(hostedWorkspaceHarvest.userId, this._effectiveUserId), eq(hostedWorkspaceHarvest.workspaceId, currentId)))
      .limit(1);
    if (rows.length === 0) {
      throw new Error("No harvest found. Run quillby_fetch_articles then quillby_save_cards first.");
    }
    return HarvestBundleSchema.parse(JSON.parse(rows[0].data));
  }

  async saveHarvestOutput(cards: CardInput[], _seenUrls?: Set<string>): Promise<string> {
    void _seenUrls;
    await this.ensureInit();
    const currentId = await this.getCurrentWorkspaceId();
    await this._enforceHarvestCooldown(currentId);
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
      curationState: {},
    };
    const data = JSON.stringify(bundle);
    const now = new Date();
    await this.db
      .insert(hostedWorkspaceHarvest)
      .values({ userId: this._effectiveUserId, workspaceId: currentId, data, generatedAt: now })
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
    await this._enforceDraftLimit(currentId);
    const id = randomUUID();
    await this.db.insert(hostedWorkspaceDraft).values({
      id,
      userId: this._effectiveUserId,
      workspaceId: currentId,
      platform: platform.toLowerCase(),
      cardId: cardId ?? null,
      content,
      createdAt: new Date(),
    });
    return `draft:${id}`;
  }

  async saveCurationState(state: Record<string, CurationStatus>): Promise<void> {
    await this.ensureInit();
    const currentId = await this.getCurrentWorkspaceId();
    const rows = await this.db
      .select({ data: hostedWorkspaceHarvest.data })
      .from(hostedWorkspaceHarvest)
      .where(and(eq(hostedWorkspaceHarvest.userId, this._effectiveUserId), eq(hostedWorkspaceHarvest.workspaceId, currentId)))
      .limit(1);
    if (rows.length === 0) throw new Error("No harvest found. Save cards first before curating.");
    const bundle = HarvestBundleSchema.parse(JSON.parse(rows[0].data));
    const merged = { ...bundle.curationState, ...state };
    const updated = JSON.stringify({ ...bundle, curationState: merged });
    const now = new Date();
    await this.db
      .update(hostedWorkspaceHarvest)
      .set({ data: updated, generatedAt: now })
      .where(and(eq(hostedWorkspaceHarvest.userId, this._effectiveUserId), eq(hostedWorkspaceHarvest.workspaceId, currentId)));
  }

  async listDrafts(): Promise<DraftSummary[]> {
    await this.ensureInit();
    const currentId = await this.getCurrentWorkspaceId();
    const rows = await this.db
      .select()
      .from(hostedWorkspaceDraft)
      .where(and(eq(hostedWorkspaceDraft.userId, this._effectiveUserId), eq(hostedWorkspaceDraft.workspaceId, currentId)))
      .orderBy(hostedWorkspaceDraft.createdAt);
    return rows.map((r) => ({
      id: r.id,
      platform: r.platform,
      cardId: r.cardId ?? undefined,
      createdAt: (r.createdAt instanceof Date ? r.createdAt : new Date(r.createdAt)).toISOString(),
      preview: r.content.slice(0, 200).replace(/\n+/g, " ").trim(),
    })).reverse();
  }

  async withWorkspace(id: string): Promise<WorkspaceStorage> {
    await this.ensureInit();
    // Check if this user owns the workspace.
    const owned = await this.workspaceExists(id);
    if (owned) {
      const scoped = new HostedDbWorkspaceStorage(this.userId, this.db);
      scoped._workspaceIdOverride = id;
      scoped.initPromise = this.initPromise;
      return scoped;
    }
    // Check if the workspace has been shared with this user.
    const access = await this.db
      .select()
      .from(hostedWorkspaceAccess)
      .where(and(eq(hostedWorkspaceAccess.workspaceId, id), eq(hostedWorkspaceAccess.granteeUserId, this.userId)))
      .limit(1);
    if (access.length === 0) throw new Error(`Workspace "${id}" not found or not accessible.`);
    const scoped = new HostedDbWorkspaceStorage(this.userId, this.db);
    scoped._workspaceIdOverride = id;
    scoped._ownerUserId = access[0].ownerUserId;
    scoped.initPromise = this.initPromise;
    return scoped;
  }

  async getPlan(): Promise<"free" | "pro"> {
    await this.ensureInit();
    const rows = await this.db
      .select({ plan: hostedUserState.plan })
      .from(hostedUserState)
      .where(eq(hostedUserState.userId, this.userId))
      .limit(1);
    return ((rows[0]?.plan ?? "free") as "free" | "pro");
  }

  async shareWorkspace(workspaceId: string, granteeUserId: string, role: "viewer" | "editor"): Promise<void> {
    await this.ensureInit();
    if (!await this.workspaceExists(workspaceId)) {
      throw new Error(`Workspace "${workspaceId}" not found or you do not own it.`);
    }
    await this.db
      .insert(hostedWorkspaceAccess)
      .values({ ownerUserId: this.userId, workspaceId, granteeUserId, role, createdAt: new Date() })
      .onConflictDoUpdate({
        target: [hostedWorkspaceAccess.ownerUserId, hostedWorkspaceAccess.workspaceId, hostedWorkspaceAccess.granteeUserId],
        set: { role },
      });
  }

  async revokeAccess(workspaceId: string, granteeUserId: string): Promise<void> {
    await this.ensureInit();
    if (!await this.workspaceExists(workspaceId)) {
      throw new Error(`Workspace "${workspaceId}" not found or you do not own it.`);
    }
    await this.db
      .delete(hostedWorkspaceAccess)
      .where(
        and(
          eq(hostedWorkspaceAccess.ownerUserId, this.userId),
          eq(hostedWorkspaceAccess.workspaceId, workspaceId),
          eq(hostedWorkspaceAccess.granteeUserId, granteeUserId)
        )
      );
  }

  async listWorkspaceAccess(workspaceId: string): Promise<Array<{ userId: string; role: string }>> {
    await this.ensureInit();
    if (!await this.workspaceExists(workspaceId)) {
      throw new Error(`Workspace "${workspaceId}" not found or you do not own it.`);
    }
    const rows = await this.db
      .select({ userId: hostedWorkspaceAccess.granteeUserId, role: hostedWorkspaceAccess.role })
      .from(hostedWorkspaceAccess)
      .where(and(eq(hostedWorkspaceAccess.ownerUserId, this.userId), eq(hostedWorkspaceAccess.workspaceId, workspaceId)));
    return rows;
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
