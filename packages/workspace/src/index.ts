import * as fs from "fs";
import * as path from "path";
import { CONFIG, ensureDataDir, ensureDir } from "@quillby/config";
import {
  TypedMemorySchema,
  UserContextSchema,
  WorkspaceMetadataSchema,
  type TypedMemory,
  type UserContext,
  type WorkspaceMetadata,
} from "@quillby/core";

export const DEFAULT_WORKSPACE_ID = "default";

export type CreateWorkspaceInput = {
  id?: string;
  name: string;
  description?: string;
  makeCurrent?: boolean;
};

export type DraftSummary = {
  id: string;
  platform: string;
  cardId?: number;
  createdAt: string;
  preview: string;
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
  loadLatestHarvest(): Promise<import("@quillby/core").HarvestBundle>;
  latestHarvestExists(): Promise<boolean>;
  saveHarvestOutput(cards: import("@quillby/core").CardInput[], seenUrls: Set<string>): Promise<string>;
  saveDraft(content: string, platform: string, cardId?: number): Promise<string>;
  saveCurationState(state: Record<string, import("@quillby/core").CurationStatus>): Promise<void>;
  listDrafts(): Promise<DraftSummary[]>;
  withWorkspace(workspaceId: string): Promise<WorkspaceStorage>;
  getPlan(): Promise<"free" | "pro">;
  shareWorkspace(workspaceId: string, granteeUserId: string, role: "viewer" | "editor"): Promise<void>;
  revokeAccess(workspaceId: string, granteeUserId: string): Promise<void>;
  listWorkspaceAccess(workspaceId: string): Promise<Array<{ userId: string; role: string }>>;
}

export function slugifyWorkspaceId(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48) || DEFAULT_WORKSPACE_ID;
}

function nowIso(): string {
  return new Date().toISOString();
}

export function getWorkspaceDir(workspaceId: string): string {
  return path.join(CONFIG.FILES.WORKSPACES_DIR, workspaceId);
}

export function getWorkspacePaths(workspaceId: string) {
  const root = getWorkspaceDir(workspaceId);
  return {
    root,
    meta: path.join(root, "workspace.json"),
    context: path.join(root, "context.json"),
    sources: path.join(root, "rss_sources.txt"),
    outputDir: path.join(root, "output"),
    cacheDir: path.join(root, ".cache"),
    cache: path.join(root, ".cache", "seen_urls.json"),
    latestHarvestPointer: path.join(root, ".cache", "latest_harvest_path.txt"),
    memoryDir: path.join(root, "memory"),
    typedMemory: path.join(root, "memory", "typed-memory.json"),
  };
}

function ensureWorkspaceDirs(workspaceId: string) {
  const paths = getWorkspacePaths(workspaceId);
  ensureDataDir();
  ensureDir(paths.root);
  ensureDir(paths.outputDir);
  ensureDir(paths.cacheDir);
  ensureDir(paths.memoryDir);
}

function writeWorkspaceMeta(meta: WorkspaceMetadata) {
  const parsed = WorkspaceMetadataSchema.parse(meta);
  const paths = getWorkspacePaths(parsed.id);
  ensureWorkspaceDirs(parsed.id);
  fs.writeFileSync(paths.meta, JSON.stringify(parsed, null, 2));
}

export function ensureWorkspaceSystem() {
  ensureDataDir();
  if (listWorkspaces().length === 0) {
    createWorkspace({
      id: DEFAULT_WORKSPACE_ID,
      name: "Default Workspace",
      description: "Primary Quillby workspace.",
      makeCurrent: true,
    });
  }
}

export function listWorkspaces(): WorkspaceMetadata[] {
  ensureDataDir();
  if (!fs.existsSync(CONFIG.FILES.WORKSPACES_DIR)) return [];
  return fs
    .readdirSync(CONFIG.FILES.WORKSPACES_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => {
      const metaPath = getWorkspacePaths(entry.name).meta;
      if (fs.existsSync(metaPath)) {
        try {
          const raw = JSON.parse(fs.readFileSync(metaPath, "utf-8"));
          return WorkspaceMetadataSchema.parse(raw);
        } catch {
          // fall through to rebuild minimal metadata
        }
      }
      const fallback: WorkspaceMetadata = {
        id: entry.name,
        name: entry.name,
        description: "",
        createdAt: nowIso(),
        updatedAt: nowIso(),
      };
      writeWorkspaceMeta(fallback);
      return fallback;
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function workspaceExists(workspaceId: string): boolean {
  return fs.existsSync(getWorkspacePaths(workspaceId).meta);
}

export function loadWorkspace(workspaceId: string): WorkspaceMetadata | null {
  const metaPath = getWorkspacePaths(workspaceId).meta;
  if (!fs.existsSync(metaPath)) return null;
  try {
    return WorkspaceMetadataSchema.parse(JSON.parse(fs.readFileSync(metaPath, "utf-8")));
  } catch {
    return null;
  }
}

export function getCurrentWorkspaceId(): string {
  ensureWorkspaceSystem();
  if (fs.existsSync(CONFIG.FILES.CURRENT_WORKSPACE)) {
    const workspaceId = fs.readFileSync(CONFIG.FILES.CURRENT_WORKSPACE, "utf-8").trim();
    if (workspaceId && workspaceExists(workspaceId)) return workspaceId;
  }
  const fallback = listWorkspaces()[0]?.id ?? DEFAULT_WORKSPACE_ID;
  setCurrentWorkspace(fallback);
  return fallback;
}

export function getCurrentWorkspace(): WorkspaceMetadata {
  return loadWorkspace(getCurrentWorkspaceId()) ?? createWorkspace({ id: DEFAULT_WORKSPACE_ID, name: "Default Workspace", makeCurrent: true });
}

export function setCurrentWorkspace(workspaceId: string): WorkspaceMetadata {
  ensureWorkspaceSystem();
  const workspace = loadWorkspace(workspaceId);
  if (!workspace) {
    throw new Error(`Workspace "${workspaceId}" does not exist.`);
  }
  fs.writeFileSync(CONFIG.FILES.CURRENT_WORKSPACE, workspaceId);
  return workspace;
}

export function createWorkspace(input: {
  id?: string;
  name: string;
  description?: string;
  makeCurrent?: boolean;
  createdAt?: string;
}): WorkspaceMetadata {
  ensureDataDir();
  const workspaceId = slugifyWorkspaceId(input.id ?? input.name);
  if (workspaceExists(workspaceId)) {
    throw new Error(`Workspace "${workspaceId}" already exists.`);
  }
  const createdAt = input.createdAt ?? nowIso();
  const meta: WorkspaceMetadata = {
    id: workspaceId,
    name: input.name.trim() || workspaceId,
    description: input.description?.trim() ?? "",
    createdAt,
    updatedAt: createdAt,
  };
  ensureWorkspaceDirs(workspaceId);
  writeWorkspaceMeta(meta);
  saveTypedMemory(workspaceId, {});
  if (input.makeCurrent) setCurrentWorkspace(workspaceId);
  return meta;
}

export function touchWorkspace(workspaceId: string) {
  const existing = loadWorkspace(workspaceId);
  if (!existing) return;
  writeWorkspaceMeta({ ...existing, updatedAt: nowIso() });
}

// ─── Context ──────────────────────────────────────────────────────────────────

export function workspaceContextExists(workspaceId: string): boolean {
  return fs.existsSync(getWorkspacePaths(workspaceId).context);
}

export function loadWorkspaceContext(workspaceId: string): UserContext | null {
  const file = getWorkspacePaths(workspaceId).context;
  if (!fs.existsSync(file)) return null;
  try {
    return UserContextSchema.parse(JSON.parse(fs.readFileSync(file, "utf-8")));
  } catch {
    return null;
  }
}

export function saveWorkspaceContext(workspaceId: string, ctx: UserContext) {
  const file = getWorkspacePaths(workspaceId).context;
  ensureWorkspaceDirs(workspaceId);
  fs.writeFileSync(file, JSON.stringify(UserContextSchema.parse(ctx), null, 2));
  touchWorkspace(workspaceId);
}

// ─── Typed memory ─────────────────────────────────────────────────────────────

export function loadTypedMemory(workspaceId: string): TypedMemory {
  const file = getWorkspacePaths(workspaceId).typedMemory;
  if (!fs.existsSync(file)) return TypedMemorySchema.parse({});
  try {
    return TypedMemorySchema.parse(JSON.parse(fs.readFileSync(file, "utf-8")));
  } catch {
    return TypedMemorySchema.parse({});
  }
}

export function saveTypedMemory(workspaceId: string, partial: Partial<TypedMemory>) {
  const current = loadTypedMemory(workspaceId);
  const next = TypedMemorySchema.parse({ ...current, ...partial });
  const file = getWorkspacePaths(workspaceId).typedMemory;
  ensureWorkspaceDirs(workspaceId);
  fs.writeFileSync(file, JSON.stringify(next, null, 2));
  touchWorkspace(workspaceId);
}

export function appendTypedMemory(
  workspaceId: string,
  memoryType: keyof TypedMemory,
  entries: string[],
  limit?: number
) {
  const current = loadTypedMemory(workspaceId);
  const existing = current[memoryType];
  const deduped = [...new Set([...entries, ...existing].map((entry) => entry.trim()).filter(Boolean))];
  const next = limit != null ? deduped.slice(0, limit) : deduped;
  saveTypedMemory(workspaceId, { [memoryType]: next } as Partial<TypedMemory>);
}

// ─── Sources ──────────────────────────────────────────────────────────────────

export function loadSources(workspaceId: string): string[] {
  const file = getWorkspacePaths(workspaceId).sources;
  if (!fs.existsSync(file)) return [];
  return fs
    .readFileSync(file, "utf-8")
    .split("\n")
    .map((s) => s.trim())
    .filter((s) => s && !s.startsWith("#"));
}

export function appendSources(
  workspaceId: string,
  newUrls: string[]
): { added: number; skipped: number } {
  const sourcesFile = getWorkspacePaths(workspaceId).sources;
  const existing = new Set(loadSources(workspaceId));
  const toAdd = newUrls.filter((u) => u.trim() && !existing.has(u.trim()));

  if (toAdd.length === 0) return { added: 0, skipped: newUrls.length };

  ensureDir(getWorkspacePaths(workspaceId).root);
  const header = !fs.existsSync(sourcesFile) ? "# Quillby RSS Sources\n\n" : "";
  fs.appendFileSync(sourcesFile, header + toAdd.join("\n") + "\n");
  touchWorkspace(workspaceId);

  return { added: toAdd.length, skipped: newUrls.length - toAdd.length };
}

// ─── Seen URL cache ───────────────────────────────────────────────────────────

export function getSeenUrls(workspaceId: string): Set<string> {
  const cacheFile = getWorkspacePaths(workspaceId).cache;
  try {
    if (fs.existsSync(cacheFile)) {
      return new Set(JSON.parse(fs.readFileSync(cacheFile, "utf-8")) as string[]);
    }
  } catch {
    // Ignore malformed cache.
  }
  return new Set();
}

export function saveSeenUrls(workspaceId: string, urls: Set<string>) {
  const paths = getWorkspacePaths(workspaceId);
  ensureDir(paths.cacheDir);
  fs.writeFileSync(paths.cache, JSON.stringify([...urls], null, 2));
}
