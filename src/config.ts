import * as fs from "fs";
import * as path from "path";

export const CONFIG = {
  FILES: {
    CONTEXT: "config/context.md",
    SOURCES: "config/rss_sources.txt",
    PROMPTS: {
      LIBRARIAN: "config/prompts/librarian.txt",
      RESEARCHER: "config/prompts/researcher.txt",
      EDITOR: "config/prompts/editor.txt",
      COPYWRITER: "config/prompts/copywriter.txt",
      GHOSTWRITER: "config/prompts/ghostwriter.txt",
      TREND_SPOTTER: "config/prompts/trend-spotter.txt",
    },
    OUTPUT_DIR: "output",
    CACHE: ".cache/seen_urls.json",
    HISTORY: ".cache/content_history.json",
  },
  RSS: {
    ITEMS_PER_FEED: parseInt(process.env.RSS_ITEMS_PER_FEED || "4", 10),
    TIMEOUT: 12000,
    CONCURRENCY: 5,
  },
  ENRICHMENT: {
    ENABLED: true,
    MAX_CONTENT_LENGTH: 3000,
    TIMEOUT: 8000,
    RETRIES: 2,
  },
  LLM: {
    // Model selection by task complexity (2026 latest models)
    MODEL_FAST: process.env.LLM_MODEL_FAST || "gpt-5-mini", // Filtering & scoring - fast, economical
    MODEL_STANDARD: process.env.LLM_MODEL || "gpt-5.2", // General tasks - latest GPT-5
    MODEL_ADVANCED: process.env.LLM_MODEL_RESEARCH || "gpt-5.2", // Research & analysis - best quality
    MODEL_REASONING: process.env.LLM_MODEL_REASONING || "o3", // Deep reasoning - highest reasoning level
    MODEL_PRO: process.env.LLM_MODEL_PRO || "gpt-5.2-pro", // Complex multi-step analysis (optional)
    
    // Temperature for different tasks
    TEMPERATURE_ANALYTICAL: 0.1, // Low variance for scoring
    TEMPERATURE_CREATIVE: 0.4, // Moderate for content generation
    
    // Concurrency & batching
    PARALLEL_WORKERS: parseInt(process.env.PARALLEL_WORKERS || "4", 10),
    BATCH_SIZE: parseInt(process.env.BATCH_SIZE || "10", 10),
    
    // Retry & timeout
    RETRY_ATTEMPTS: 3,
    REQUEST_TIMEOUT_MS: 30000,
    
    // Advanced features
    USE_STREAMING: true, // Enable streaming for long operations
    USE_BATCH_API: false, // Disable batch API (for async processing)
    
    // Embeddings for semantic search
    EMBEDDING_MODEL: process.env.EMBEDDING_MODEL || "text-embedding-3-large",
    USE_VECTOR_STORE: process.env.USE_VECTOR_STORE === "true", // Enable vector store deduplication
  },
  PIPELINE: {
    MIN_LIBRARIAN_SCORE: parseFloat(process.env.MIN_LIBRARIAN_SCORE || "6"),
    MAX_ITEMS_TO_RESEARCH: parseInt(process.env.MAX_ITEMS_TO_RESEARCH || "12", 10),
    MAX_CONCEPTS_TO_WRITE: parseInt(process.env.MAX_CONCEPTS_TO_WRITE || "12", 10),
    PARALLEL_REQUESTS: parseInt(process.env.PARALLEL_REQUESTS || "5", 10),
    USE_CONCURRENCY: true, // Enable concurrent processing for all agents
  },
  CACHE: {
    ENABLED: true,
    TTL_HOURS: 24,
  },
};

export function ensureDir(dir: string) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

export function readTextFile(filename: string): string {
  const ext = path.extname(filename);
  const hasExt = ext.length > 0;
  const localVariant = hasExt
    ? `${filename.slice(0, -ext.length)}.local${ext}`
    : `${filename}.local`;

  const candidateFiles = [localVariant, filename];

  const paths = candidateFiles.flatMap((candidate) => [
    path.join(process.cwd(), candidate),
    path.join(process.cwd(), "rss-filter", candidate),
  ]);

  for (const filePath of paths) {
    try {
      return fs.readFileSync(filePath, "utf-8");
    } catch {
      continue;
    }
  }

  console.error(`Error reading ${filename}: not found in any path`);
  throw new Error(`Cannot read ${filename}`);
}

// Initialize directories
ensureDir(CONFIG.FILES.CACHE.split("/")[0]); // .cache
ensureDir(CONFIG.FILES.OUTPUT_DIR);
