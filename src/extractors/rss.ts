import * as fs from "fs";
import Parser from "rss-parser";
import { CONFIG } from "../config.js";
import type { RssItem } from "../types.js";

const parser = new Parser({
  timeout: CONFIG.RSS.TIMEOUT,
  requestOptions: { rejectUnauthorized: false },
  headers: {
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
  },
});

export function getSeenUrls(): Set<string> {
  try {
    if (fs.existsSync(CONFIG.FILES.CACHE)) {
      return new Set(JSON.parse(fs.readFileSync(CONFIG.FILES.CACHE, "utf-8")) as string[]);
    }
  } catch {
    // Ignore malformed cache.
  }
  return new Set();
}

export function saveSeenUrls(urls: Set<string>) {
  fs.writeFileSync(CONFIG.FILES.CACHE, JSON.stringify([...urls], null, 2));
}

export async function fetchFeeds(
  sources: string[],
  log: (msg: string) => void = () => {}
): Promise<RssItem[]> {
  const seen = getSeenUrls();
  const allItems: RssItem[] = [];
  let processed = 0;

  for (let index = 0; index < sources.length; index += CONFIG.RSS.CONCURRENCY) {
    const batch = sources.slice(index, index + CONFIG.RSS.CONCURRENCY);

    const batchResults = await Promise.all(
      batch.map(async (url) => {
        try {
          const feed = await parser.parseURL(url);
          return feed.items
            .filter((item) => item.link && !seen.has(item.link))
            .slice(0, CONFIG.RSS.ITEMS_PER_FEED)
            .map((item, itemIndex) => ({
              id: `${url}-${itemIndex}`,
              source: typeof feed.title === "string" ? feed.title : url,
              title: typeof item.title === "string" ? item.title : "Untitled",
              link: item.link as string,
              snippet: (
                typeof item.contentSnippet === "string" ? item.contentSnippet :
                typeof item.content === "string" ? item.content :
                ""
              ).slice(0, 500).replace(/\s+/g, " ").trim(),
              publishedAt: item.pubDate || item.isoDate || undefined,
            } satisfies RssItem));
        } catch {
          return [] as RssItem[];
        }
      })
    );

    batchResults.forEach((items) => allItems.push(...items));
    processed += batch.length;
    log(`Feeds processed: ${processed}/${sources.length} (${allItems.length} new items so far)`);
  }

  return allItems;
}
