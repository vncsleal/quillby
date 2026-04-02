import * as https from "https";
import * as http from "http";
import { Readability } from "@mozilla/readability";
import { parseHTML } from "linkedom";
import { CONFIG } from "../config.js";

/**
 * Fetch HTML from a URL with redirect handling
 */
export function fetchURL(url: string, redirects = 0): Promise<string> {
  if (redirects > 5) return Promise.resolve("");

  // Validate URL
  try {
    new URL(url);
  } catch {
    return Promise.resolve("");
  }

  return new Promise((resolve) => {
    const protocol = url.startsWith("https") ? https : http;
    const req = protocol.get(
      url,
      {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
          Accept: "text/html,application/xhtml+xml",
        },
        timeout: CONFIG.ENRICHMENT.TIMEOUT,
      },
      (res) => {
        // Handle redirects
        if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          const redirectUrl = new URL(res.headers.location, url).href;
          fetchURL(redirectUrl, redirects + 1).then(resolve);
          return;
        }

        let data = "";
        res.on("data", (chunk) => {
          data += chunk;
        });
        res.on("end", () => resolve(data));
        res.on("error", () => resolve(""));
      }
    );

    req.on("error", () => resolve(""));
    req.on("timeout", () => {
      req.destroy();
      resolve("");
    });
  });
}

/**
 * Extract readable text from HTML using Mozilla Readability.
 * Falls back to basic tag stripping if Readability cannot parse the page.
 */
export function extractTextFromHTML(html: string, url: string): string {
  void url;
  try {
    const { document } = parseHTML(html);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const article = new Readability(document as any).parse();
    if (article?.textContent) {
      return article.textContent.replace(/\s+/g, " ").trim().slice(0, CONFIG.ENRICHMENT.MAX_CONTENT_LENGTH);
    }
  } catch {
    // fall through to basic extraction
  }

  // Fallback: strip all tags
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, CONFIG.ENRICHMENT.MAX_CONTENT_LENGTH);
}

/**
 * Fetch and extract key content from a URL
 */
export async function enrichArticle(url: string, title: string): Promise<string> {
  void title;
  if (!CONFIG.ENRICHMENT.ENABLED) return "";

  for (let attempt = 0; attempt < CONFIG.ENRICHMENT.RETRIES; attempt++) {
    try {
      const html = await fetchURL(url);
      if (!html) continue;

      const text = extractTextFromHTML(html, url);
      if (text.length > 200) return text;
    } catch {
      // continue to next attempt
    }
  }

  return "";
}
