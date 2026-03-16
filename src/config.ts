import * as fs from "fs";
import * as path from "path";

export const CONFIG = {
  FILES: {
    CONTEXT: "config/context.json",
    SOURCES: "config/rss_sources.txt",
    OUTPUT_DIR: "output",
    CACHE: ".cache/seen_urls.json",
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

export function readTextFile(filename: string): string {
  const ext = path.extname(filename);
  const localVariant = ext
    ? `${filename.slice(0, -ext.length)}.local${ext}`
    : `${filename}.local`;

  for (const candidate of [localVariant, filename]) {
    const filePath = path.join(process.cwd(), candidate);
    if (fs.existsSync(filePath)) return fs.readFileSync(filePath, "utf-8");
  }

  throw new Error(`Cannot read config file: ${filename}`);
}

// Initialize required directories on import
ensureDir(".cache");
ensureDir(CONFIG.FILES.OUTPUT_DIR);

