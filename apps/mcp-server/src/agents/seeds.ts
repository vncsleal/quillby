/**
 * Dynamic RSS feed discovery — no hardcoded lists.
 *
 * Sources:
 *   1. Google News RSS — one query-based feed per topic, zero API keys, multilingual
 *   2. Medium tag feeds — one feed per topic, covers any niche (healthcare, law, fashion, etc.)
 *   3. Feedly Search   — discovers curated publication feeds by topic (no key required)
 */
/**
 * Build Google News RSS search URLs for each topic.
 * Results are real-time news, multilingual, maintained by Google.
 *
 * @param topics  User topic strings
 * @param hl      BCP-47 language tag: "en-US", "pt-BR", "fr-FR", etc.
 * @param gl      ISO 3166-1 country code: "US", "BR", "FR", etc.
 */
export function getGoogleNewsFeeds(
  topics: string[],
  hl = "en-US",
  gl = "US"
): string[] {
  const lang = hl.split("-")[0];
  return topics.map(
    (t) =>
      `https://news.google.com/rss/search?q=${encodeURIComponent(t)}&hl=${hl}&gl=${gl}&ceid=${gl}:${lang}`
  );
}

/**
 * Build Medium tag RSS feed URLs for each topic.
 * Medium covers virtually every professional topic: healthcare, law, fashion,
 * farming, construction, marketing, fitness, finance, etc.
 * No API key required — these are standard RSS feeds.
 *
 * Topics are slugified (lowercase, spaces → dashes) to match Medium tag format.
 */
export function getMediumTagFeeds(topics: string[]): string[] {
  return topics.map((t) => {
    const slug = t.toLowerCase().trim().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "");
    return `https://medium.com/feed/tag/${slug}`;
  });
}

/**
 * Query Feedly's free search endpoint to find curated publication RSS/Atom feeds
 * for each topic. Returns raw feed URLs ("feed/" prefix stripped).
 *
 * No API key required. Each topic is fetched independently; network errors
 * are swallowed per-topic so a single failure never aborts the whole run.
 */
export async function getFeedlyFeeds(
  topics: string[],
  perTopic = 3
): Promise<string[]> {
  const found = new Set<string>();
  for (const topic of topics) {
    try {
      const url = `https://cloud.feedly.com/v3/search/feeds?query=${encodeURIComponent(topic)}&count=${perTopic}`;
      const res = await fetch(url, { signal: AbortSignal.timeout(6000) });
      if (!res.ok) continue;
      const data = (await res.json()) as { results?: { feedId?: string }[] };
      for (const r of data.results ?? []) {
        // feedId format: "feed/https://example.com/rss" — strip the prefix
        if (r.feedId?.startsWith("feed/http")) {
          found.add(r.feedId.slice(5));
        }
      }
    } catch {
      // network error or timeout — skip this topic
    }
  }
  return [...found];
}
