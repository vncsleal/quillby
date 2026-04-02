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
  type CreateWorkspaceInput,
  type DraftSummary,
  type WorkspaceStorage,
} from "@quillby/workspace";
import {
  loadLatestHarvest as structsLoadLatest,
  latestHarvestExists as structsLatestExists,
  saveHarvestOutput as structsSaveHarvest,
  saveDraft as structsSaveDraft,
  saveCurationState as structsSaveCurationState,
  listLocalDrafts as structsListLocalDrafts,
} from "./structures.js";
import {
  type UserContext,
  type TypedMemory,
  type CardInput,
  type WorkspaceMetadata,
  type CurationStatus,
} from "@quillby/core";

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

export type { CreateWorkspaceInput, DraftSummary, WorkspaceStorage };
export {
  loadLatestHarvest,
  latestHarvestExists,
  saveHarvestOutput,
  saveDraft,
  saveCurationState,
  listLocalDrafts,
} from "./structures.js";

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
  async saveCurationState(state: Record<string, CurationStatus>) { structsSaveCurationState(state); }
  async listDrafts() { return structsListLocalDrafts(); }

  async withWorkspace(id: string): Promise<WorkspaceStorage> {
    if (!await this.workspaceExists(id)) throw new Error(`Workspace "${id}" not found.`);
    return new LocalPinnedStorage(id);
  }
  async getPlan(): Promise<"free" | "pro"> { return "free"; }
  async shareWorkspace(): Promise<void> { throw new Error("Team workspaces require hosted mode."); }
  async revokeAccess(): Promise<void> { throw new Error("Team workspaces require hosted mode."); }
  async listWorkspaceAccess(): Promise<Array<{ userId: string; role: string }>> { return []; }
}

export const storage = new LocalWorkspaceStorage();

// ── Pinned local storage (per-tool workspace override for local mode) ─────────

class LocalPinnedStorage implements WorkspaceStorage {
  constructor(private readonly pinnedId: string) {}

  async listWorkspaces() { return wsListWorkspaces(); }
  async workspaceExists(id: string) { return wsWorkspaceExists(id); }
  async loadWorkspace(id: string) { return wsLoadWorkspace(id); }
  async createWorkspace(input: CreateWorkspaceInput) { return wsCreateWorkspace(input); }
  async getCurrentWorkspaceId() { return this.pinnedId; }
  async getCurrentWorkspace() { return wsLoadWorkspace(this.pinnedId) ?? wsGetCurrentWorkspace(); }
  async setCurrentWorkspace(): Promise<WorkspaceMetadata> { throw new Error("Cannot switch workspace on a pinned storage view."); }
  async touchWorkspace(id: string) { wsTouchWorkspace(id); }
  async contextExists() { return workspaceContextExists(this.pinnedId); }
  async loadContext() { return loadWorkspaceContext(this.pinnedId); }
  async saveContext(ctx: UserContext) { saveWorkspaceContext(this.pinnedId, ctx); }
  async loadTypedMemory() { return wsLoadTypedMemory(this.pinnedId); }
  async appendTypedMemory(type: keyof TypedMemory, entries: string[], limit?: number) {
    wsAppendTypedMemory(this.pinnedId, type, entries, limit);
  }
  async loadSources() { return wsLoadSources(this.pinnedId); }
  async appendSources(urls: string[]) { return wsAppendSources(this.pinnedId, urls); }
  async getSeenUrls() { return wsGetSeenUrls(this.pinnedId); }
  async saveSeenUrls(urls: Set<string>) { wsSaveSeenUrls(this.pinnedId, urls); }
  async loadLatestHarvest() { return structsLoadLatest(this.pinnedId); }
  async latestHarvestExists() { return structsLatestExists(this.pinnedId); }
  async saveHarvestOutput(cards: CardInput[], seenUrls: Set<string>) { return structsSaveHarvest(cards, seenUrls, this.pinnedId); }
  async saveDraft(content: string, platform: string, cardId?: number) { return structsSaveDraft(content, platform, cardId, this.pinnedId); }
  async saveCurationState(state: Record<string, CurationStatus>) { structsSaveCurationState(state, this.pinnedId); }
  async listDrafts() { return structsListLocalDrafts(this.pinnedId); }

  async withWorkspace(id: string): Promise<WorkspaceStorage> {
    if (!await this.workspaceExists(id)) throw new Error(`Workspace "${id}" not found.`);
    return new LocalPinnedStorage(id);
  }
  async getPlan(): Promise<"free" | "pro"> { return "free"; }
  async shareWorkspace(): Promise<void> { throw new Error("Team workspaces require hosted mode."); }
  async revokeAccess(): Promise<void> { throw new Error("Team workspaces require hosted mode."); }
  async listWorkspaceAccess(): Promise<Array<{ userId: string; role: string }>> { return []; }
}

// ── Scoped filesystem storage (wraps each call in a QUILLBY_HOME swap) ───────
// Kept for reference but not used in hosted mode after v0.8.

export class ScopedWorkspaceStorage implements WorkspaceStorage {
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
  async saveCurationState(state: Record<string, CurationStatus>) {
    withScopedHome(this.homeDir, () => structsSaveCurationState(state));
  }
  async listDrafts() {
    return withScopedHome(this.homeDir, () => structsListLocalDrafts());
  }

  async withWorkspace(id: string): Promise<WorkspaceStorage> {
    const exists = await withScopedHome(this.homeDir, () => wsWorkspaceExists(id));
    if (!exists) throw new Error(`Workspace "${id}" not found.`);
    return new ScopedWorkspaceStorage(this.homeDir); // scoped home already pins the env; caller switches via setCurrentWorkspace
  }
  async getPlan(): Promise<"free" | "pro"> { return "free"; }
  async shareWorkspace(): Promise<void> { throw new Error("Team workspaces require hosted mode."); }
  async revokeAccess(): Promise<void> { throw new Error("Team workspaces require hosted mode."); }
  async listWorkspaceAccess(): Promise<Array<{ userId: string; role: string }>> { return []; }
}
