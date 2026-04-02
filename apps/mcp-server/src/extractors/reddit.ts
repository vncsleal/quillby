import * as https from "https";
import type { RssItem } from "../types.js";

const ITEMS_PER_SOURCE = 25;

type RedditPost = {
  data: {
    id: string;
    title: string;
    selftext?: string;
    url?: string;
    permalink: string;
    subreddit: string;
    subreddit_name_prefixed: string;
    score: number;
    num_comments: number;
    author: string;
    created_utc: number;
    is_self: boolean;
    post_hint?: string;
  };
};

type RedditListing = {
  data: {
    children: RedditPost[];
  };
};

function get<T>(url: string): Promise<T | null> {
  return new Promise((resolve) => {
    https
      .get(
        url,
        {
          headers: {
            "User-Agent": "quillby-mcp/1.0 (content research tool)",
            Accept: "application/json",
          },
        },
        (res) => {
          // Reddit may redirect to old.reddit.com — follow
          if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
            get<T>(res.headers.location).then(resolve);
            return;
          }
          let data = "";
          res.on("data", (c) => (data += c));
          res.on("end", () => {
            try {
              resolve(JSON.parse(data) as T);
            } catch {
              resolve(null);
            }
          });
          res.on("error", () => resolve(null));
        }
      )
      .on("error", () => resolve(null));
  });
}

/**
 * Fetch hot posts from a subreddit.
 * @param subreddit subreddit name without r/ prefix (e.g. "marketing")
 * @param sort "hot" | "new" | "top" | "rising"
 */
export async function fetchReddit(
  subreddit: string,
  sort: string = "hot",
  log: (msg: string) => void = () => {}
): Promise<RssItem[]> {
  const url = `https://www.reddit.com/r/${subreddit}/${sort}.json?limit=${ITEMS_PER_SOURCE}&raw_json=1`;
  log(`Reddit r/${subreddit}/${sort}: fetching...`);

  const listing = await get<RedditListing>(url);
  if (!listing?.data?.children) {
    log(`Reddit r/${subreddit}: no data (may be private or non-existent)`);
    return [];
  }

  const results: RssItem[] = [];
  for (const post of listing.data.children) {
    const d = post.data;
    if (!d.title) continue;

    // For link posts: use the external URL. For text posts: use the reddit permalink.
    const link = d.is_self
      ? `https://www.reddit.com${d.permalink}`
      : (d.url ?? `https://www.reddit.com${d.permalink}`);

    const snippet = d.is_self && d.selftext
      ? d.selftext.slice(0, 500).replace(/\s+/g, " ").trim()
      : `r/${d.subreddit} · ${d.score} upvotes · ${d.num_comments} comments · by u/${d.author}`;

    results.push({
      id: `reddit-${d.id}`,
      source: d.subreddit_name_prefixed,
      title: d.title,
      link,
      snippet,
      publishedAt: new Date(d.created_utc * 1000).toISOString(),
    });
  }

  log(`Reddit r/${subreddit}: ${results.length} posts ready`);
  return results;
}
