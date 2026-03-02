import Parser from "rss-parser";
import { CONFIG } from "../config";
import type { RssItem } from "../types";
import * as fs from "fs";
import { VectorStore } from "../semantic/embeddings";
import * as cli from "../cli";

const parser = new Parser({
  timeout: CONFIG.RSS.TIMEOUT,
  requestOptions: { rejectUnauthorized: false },
  headers: {
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
  },
});

/**
 * Get set of seen URLs from cache
 */
export function getSeenUrls(): Set<string> {
  try {
    if (fs.existsSync(CONFIG.FILES.CACHE)) {
      return new Set(JSON.parse(fs.readFileSync(CONFIG.FILES.CACHE, "utf-8")));
    }
  } catch {
    // ignore
  }
  return new Set();
}

/**
 * Save seen URLs to cache
 */
export function saveSeenUrls(urls: Set<string>) {
  fs.writeFileSync(CONFIG.FILES.CACHE, JSON.stringify([...urls], null, 2));
}

/**
 * Fetch all RSS feeds and return new items
 */
export async function fetchFeeds(sources: string[]): Promise<RssItem[]> {
  const seen = getSeenUrls();
  const allItems: RssItem[] = [];
  let processed = 0;

  cli.printStageStart(`Fetching ${sources.length} feeds`);
  
  // Initialize vector store for semantic deduplication (if enabled)
  const vectorStore = CONFIG.LLM.USE_VECTOR_STORE ? new VectorStore() : null;
  if (vectorStore) {
    cli.printMessage(`Semantic deduplication enabled (${vectorStore.size()} cached)`, "muted");
  }

  // Process feeds in batches for better parallelism
  for (let i = 0; i < sources.length; i += CONFIG.RSS.CONCURRENCY) {
    const batch = sources.slice(i, i + CONFIG.RSS.CONCURRENCY);

    const results = await Promise.all(
      batch.map(async (url) => {
        const items: RssItem[] = [];
        try {
          const feed = await parser.parseURL(url);

          const newItems = feed.items
            .filter((item) => item.link && !seen.has(item.link))
            .slice(0, CONFIG.RSS.ITEMS_PER_FEED)
            .map((item, idx) => ({
              id: `${url}-${idx}`,
              source: feed.title || url,
              title: item.title || "Untitled",
              link: item.link!,
              snippet: (item.contentSnippet || item.content || "")
                .slice(0, 500)
                .replace(/\s+/g, " ")
                .trim(),
              publishedAt: item.pubDate || item.isoDate || undefined,
            }));

          items.push(...newItems);
        } catch (err) {
          // silently skip failed feeds
        }
        return items;
      })
    );

    results.forEach((items) => allItems.push(...items));
    processed += batch.length;

    const pct = Math.round((processed / sources.length) * 100);
    cli.printProgress(processed, sources.length, `${allItems.length} items`);
  }
  cli.printProgressDone();

  // Semantic deduplication (filter out very similar content)
  let finalItems = allItems;
  if (vectorStore && allItems.length > 0) {
    cli.printMessage("Checking semantic duplicates", "muted");
    const unique: RssItem[] = [];
    let duplicates = 0;

    for (const item of allItems) {
      const text = `${item.title} ${item.snippet}`;
      const result = await vectorStore.isDuplicate(text, 0.92); // High threshold for duplicates

      if (!result.isDuplicate) {
        unique.push(item);
        await vectorStore.add(item.link, text, { title: item.title, source: item.source });
      } else {
        duplicates++;
      }
    }

    vectorStore.save();
    finalItems = unique;
    if (duplicates > 0) {
      cli.printResult("Removed duplicates", duplicates, unique.length, "semantic");
    }
  }

  cli.printResult("Fetched", finalItems.length, sources.length, "new items");
  return finalItems;
}
