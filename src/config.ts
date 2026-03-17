import * as fs from "fs";
import * as path from "path";
import * as os from "os";

const DATA_DIR = path.join(os.homedir(), ".quillby");

export const CONFIG = {
  FILES: {
    CONTEXT: path.join(DATA_DIR, "context.json"),
    MEMORY: path.join(DATA_DIR, "memory.json"),
    SOURCES: path.join(DATA_DIR, "rss_sources.txt"),
    OUTPUT_DIR: path.join(DATA_DIR, "output"),
    CACHE: path.join(DATA_DIR, ".cache/seen_urls.json"),
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

export function readTextFile(filePath: string): string {
  const ext = path.extname(filePath);
  const localVariant = ext
    ? `${filePath.slice(0, -ext.length)}.local${ext}`
    : `${filePath}.local`;

  for (const candidate of [localVariant, filePath]) {
    const resolved = path.isAbsolute(candidate)
      ? candidate
      : path.join(process.cwd(), candidate);
    if (fs.existsSync(resolved)) return fs.readFileSync(resolved, "utf-8");
  }

  throw new Error(`Cannot read config file: ${filePath}`);
}

// Initialize required directories on import
ensureDir(path.dirname(CONFIG.FILES.CACHE));
ensureDir(CONFIG.FILES.OUTPUT_DIR);

