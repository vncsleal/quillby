import OpenAI from "openai";
import { CONFIG } from "../config";
import * as fs from "fs";
import * as path from "path";

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

/**
 * Generate embeddings for text content
 */
export async function generateEmbedding(text: string): Promise<number[]> {
  const response = await client.embeddings.create({
    model: CONFIG.LLM.EMBEDDING_MODEL,
    input: text.slice(0, 8000), // Limit to avoid token limits
  });

  return response.data[0].embedding;
}

/**
 * Calculate cosine similarity between two vectors
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) {
    throw new Error("Vectors must have the same length");
  }

  let dotProduct = 0;
  let magnitudeA = 0;
  let magnitudeB = 0;

  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    magnitudeA += a[i] * a[i];
    magnitudeB += b[i] * b[i];
  }

  magnitudeA = Math.sqrt(magnitudeA);
  magnitudeB = Math.sqrt(magnitudeB);

  if (magnitudeA === 0 || magnitudeB === 0) {
    return 0;
  }

  return dotProduct / (magnitudeA * magnitudeB);
}

/**
 * Simple in-memory vector store for semantic deduplication
 */
export class VectorStore {
  private vectors: Map<string, { embedding: number[]; metadata: any }> = new Map();
  private cachePath: string;

  constructor(cachePath: string = ".cache/vector_store.json") {
    this.cachePath = path.join(process.cwd(), cachePath);
    this.load();
  }

  /**
   * Add a new vector to the store
   */
  async add(id: string, text: string, metadata: any = {}): Promise<void> {
    const embedding = await generateEmbedding(text);
    this.vectors.set(id, { embedding, metadata });
  }

  /**
   * Find similar vectors above a threshold
   */
  findSimilar(embedding: number[], threshold: number = 0.85): Array<{ id: string; score: number; metadata: any }> {
    const results: Array<{ id: string; score: number; metadata: any }> = [];

    for (const [id, stored] of this.vectors.entries()) {
      const similarity = cosineSimilarity(embedding, stored.embedding);
      if (similarity >= threshold) {
        results.push({
          id,
          score: similarity,
          metadata: stored.metadata,
        });
      }
    }

    // Sort by score descending
    results.sort((a, b) => b.score - a.score);
    return results;
  }

  /**
   * Check if content is semantically similar to existing content
   */
  async isDuplicate(text: string, threshold: number = 0.9): Promise<{ isDuplicate: boolean; similar?: any }> {
    const embedding = await generateEmbedding(text);
    const similar = this.findSimilar(embedding, threshold);

    if (similar.length > 0) {
      return {
        isDuplicate: true,
        similar: similar[0],
      };
    }

    return { isDuplicate: false };
  }

  /**
   * Save vector store to disk
   */
  save(): void {
    const dir = path.dirname(this.cachePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    const data = Array.from(this.vectors.entries()).map(([id, value]) => ({
      id,
      ...value,
    }));

    fs.writeFileSync(this.cachePath, JSON.stringify(data, null, 2));
  }

  /**
   * Load vector store from disk
   */
  private load(): void {
    try {
      if (fs.existsSync(this.cachePath)) {
        const data = JSON.parse(fs.readFileSync(this.cachePath, "utf-8"));
        this.vectors = new Map(
          data.map((item: any) => [
            item.id,
            {
              embedding: item.embedding,
              metadata: item.metadata,
            },
          ])
        );
        console.log(`  📦 Loaded ${this.vectors.size} vectors from cache`);
      }
    } catch (error) {
      console.warn("  ⚠️  Failed to load vector store cache:", error);
    }
  }

  /**
   * Get number of vectors in store
   */
  size(): number {
    return this.vectors.size;
  }

  /**
   * Clear all vectors
   */
  clear(): void {
    this.vectors.clear();
  }
}
