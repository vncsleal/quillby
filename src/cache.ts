import * as fs from "fs";
import * as path from "path";
import OpenAI from "openai";
import { EMBEDDING_INPUT_COST_PER_TOKEN } from "./costs";
import type { Research } from "./types";

const apiKey = process.env.OPENAI_API_KEY;
if (!apiKey) {
  throw new Error("Missing OPENAI_API_KEY environment variable");
}

const client = new OpenAI({ apiKey });

const CACHE_DIR = path.join(process.cwd(), ".cache");
const CACHE_FILE = path.join(CACHE_DIR, "articles.json");

export interface CachedArticle {
  url: string;
  title: string;
  embedding: number[];
  research: Research;
  timestamp: number;
}

interface CacheIndex {
  articles: CachedArticle[];
}

function ensureCacheDir() {
  if (!fs.existsSync(CACHE_DIR)) {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
  }
}

function loadCache(): CacheIndex {
  ensureCacheDir();
  if (!fs.existsSync(CACHE_FILE)) {
    return { articles: [] };
  }
  try {
    const content = fs.readFileSync(CACHE_FILE, "utf-8");
    return JSON.parse(content);
  } catch {
    return { articles: [] };
  }
}

function saveCache(cache: CacheIndex) {
  ensureCacheDir();
  fs.writeFileSync(CACHE_FILE, JSON.stringify(cache, null, 2));
}

async function createEmbeddingResponse(text: string) {
  return client.embeddings.create({
    model: "text-embedding-3-small",
    input: text,
  });
}

async function getEmbedding(text: string): Promise<number[]> {
  const response = await createEmbeddingResponse(text);
  return response.data[0].embedding;
}

function cosineSimilarity(a: number[], b: number[]): number {
  const dotProduct = a.reduce((sum, ai, i) => sum + ai * b[i], 0);
  const normA = Math.sqrt(a.reduce((sum, ai) => sum + ai * ai, 0));
  const normB = Math.sqrt(b.reduce((sum, bi) => sum + bi * bi, 0));
  return dotProduct / (normA * normB);
}

export async function findSimilarCached(
  url: string,
  title: string,
  similarity_threshold = 0.85
): Promise<CachedArticle | null> {
  const cache = loadCache();
  if (cache.articles.length === 0) return null;

  // Quick URL check first
  const exactMatch = cache.articles.find((a) => a.url === url);
  if (exactMatch) return exactMatch;

  // Semantic similarity check
  const embedding = await getEmbedding(title);
  for (const cached of cache.articles) {
    const similarity = cosineSimilarity(embedding, cached.embedding);
    if (similarity >= similarity_threshold) {
      return cached;
    }
  }

  return null;
}

export function cacheArticle(
  url: string,
  title: string,
  embedding: number[],
  research: Research
) {
  const cache = loadCache();

  // Don't duplicate URLs
  if (cache.articles.some((a) => a.url === url)) {
    return;
  }

  cache.articles.push({
    url,
    title,
    embedding,
    research,
    timestamp: Date.now(),
  });

  // Keep only last 1000 cached articles (FIFO)
  if (cache.articles.length > 1000) {
    cache.articles = cache.articles.slice(-1000);
  }

  saveCache(cache);
}

export async function getEmbeddingWithCost(text: string): Promise<{ embedding: number[]; cost: number }> {
  const response = await createEmbeddingResponse(text);

  // Use API-reported tokens when available; fallback to rough estimate
  const inputTokens = response.usage?.total_tokens ?? Math.ceil(text.split(/\s+/).length * 1.3);
  const cost = inputTokens * EMBEDDING_INPUT_COST_PER_TOKEN;

  return {
    embedding: response.data[0].embedding,
    cost,
  };
}
