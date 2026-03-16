import { fetchFeeds, getSeenUrls } from "../extractors/rss.js";
import { enrichArticle } from "../extractors/content.js";
import { mapWithConcurrency } from "../llm.js";
import type { EnrichedArticle } from "../types.js";
import { CONFIG } from "../config.js";

/**
 * Fetch RSS feeds and enrich article content.
 * Returns raw enriched articles for the host model to analyze.
 * No LLM calls — pure I/O.
 *
 * slim=true: skip content fetching, return only title/source/link/snippet.
 *   Use this first to scan headlines cheaply, then call enrichArticle on demand.
 */
export async function fetchArticles(
  sources: string[],
  log: (msg: string) => void = () => {},
  slim = false
): Promise<{ articles: EnrichedArticle[]; seenUrls: Set<string> }> {
  log(`Fetching ${sources.length} RSS feeds...`);
  const items = await fetchFeeds(sources, log);
  const seenUrls = getSeenUrls();
  items.forEach((item) => seenUrls.add(item.link));

  if (items.length === 0) {
    log("No new items found.");
    return { articles: [], seenUrls };
  }

  if (slim) {
    log(`Found ${items.length} items. Slim mode — skipping content fetch.`);
    return {
      articles: items.map((item) => ({ ...item, enrichedContent: "" })),
      seenUrls,
    };
  }

  log(`Found ${items.length} new items. Enriching content...`);

  const articles = await mapWithConcurrency(
    items,
    async (item, index): Promise<EnrichedArticle> => {
      const enrichedContent = await enrichArticle(item.link, item.title);
      if (index > 0 && index % 10 === 0) {
        log(`Enriched ${index}/${items.length} articles...`);
      }
      return {
        id: item.id,
        source: item.source,
        title: item.title,
        link: item.link,
        snippet: item.snippet,
        enrichedContent,
        publishedAt: item.publishedAt,
      };
    },
    CONFIG.RSS.CONCURRENCY
  );

  log(`Fetch complete. ${articles.length} articles ready for analysis.`);
  return { articles, seenUrls };
}

/**
 * Keyword pre-filter: score articles by how many user topic words appear
 * in the title + snippet. Returns articles sorted descending by score,
 * with score=0 articles kept at the end so nothing is dropped.
 * This runs before sending to the LLM to reduce context window waste.
 */
export function preScoreArticles(
  articles: { title: string; snippet: string; link: string }[],
  topics: string[]
): Array<{ title: string; snippet: string; link: string; _preScore: number }> {
  const keywords = topics.map((t) => t.toLowerCase().trim()).filter(Boolean);
  if (keywords.length === 0) return articles.map((a) => ({ ...a, _preScore: 0 }));

  return articles
    .map((a) => {
      const haystack = `${a.title} ${a.snippet}`.toLowerCase();
      const score = keywords.reduce((acc, kw) => acc + (haystack.includes(kw) ? 1 : 0), 0);
      return { ...a, _preScore: score };
    })
    .sort((a, b) => b._preScore - a._preScore);
}


