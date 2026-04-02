import * as fs from "fs";
import * as path from "path";
import * as os from "os";

const DEFAULT_DATA_DIR = path.join(os.homedir(), ".quillby");

export type DeploymentMode = "local" | "self-hosted" | "cloud";

/**
 * Resolve how Quillby is being run:
 * - local: stdio binary on a user's machine
 * - self-hosted: user-operated HTTP deployment
 * - cloud: Quillby-operated managed deployment
 */
export function getDeploymentMode(): DeploymentMode {
  const explicit = process.env.QUILLBY_DEPLOYMENT_MODE?.trim().toLowerCase();
  if (explicit === "local" || explicit === "self-hosted" || explicit === "cloud") {
    return explicit;
  }

  const transport = (
    process.env.Quillby_TRANSPORT ??
    process.env.QUILLBY_TRANSPORT ??
    "stdio"
  ).trim().toLowerCase();

  // Default heuristic keeps local installs simple and subscription-free.
  return transport === "http" ? "self-hosted" : "local";
}

export const CONFIG = {
  get DATA_DIR() {
    return process.env.QUILLBY_HOME?.trim() || DEFAULT_DATA_DIR;
  },
  FILES: {
    get WORKSPACES_DIR() {
      return path.join(CONFIG.DATA_DIR, "workspaces");
    },
    get CURRENT_WORKSPACE() {
      return path.join(CONFIG.DATA_DIR, "current_workspace.txt");
    },
  },
  RSS: {
    ITEMS_PER_FEED: parseInt(process.env.RSS_ITEMS_PER_FEED || "5", 10),
    TIMEOUT: 12000,
    CONCURRENCY: 8,
  },
  ENRICHMENT: {
    ENABLED: true,
    MAX_CONTENT_LENGTH: 6000,
    TIMEOUT: 10000,
    RETRIES: 2,
  },
};

export function ensureDir(dir: string) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

export function ensureDataDir() {
  ensureDir(CONFIG.DATA_DIR);
  ensureDir(CONFIG.FILES.WORKSPACES_DIR);
}
