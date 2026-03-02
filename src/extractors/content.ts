import * as https from "https";
import * as http from "http";
import { CONFIG } from "../config";

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
 * Extract readable text from HTML
 */
export function extractTextFromHTML(html: string): string {
  // Remove scripts, styles, nav, header, footer
  let text = html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<nav[^>]*>[\s\S]*?<\/nav>/gi, "")
    .replace(/<footer[^>]*>[\s\S]*?<\/footer>/gi, "")
    .replace(/<header[^>]*>[\s\S]*?<\/header>/gi, "")
    .replace(/<aside[^>]*>[\s\S]*?<\/aside>/gi, "");

  // Try to extract article content
  const articleMatch =
    text.match(/<article[^>]*>([\s\S]*?)<\/article>/i) ||
    text.match(/<main[^>]*>([\s\S]*?)<\/main>/i) ||
    text.match(/<div[^>]*class="[^"]*(?:post|article|content|entry)[^"]*"[^>]*>([\s\S]*?)<\/div>/i);

  if (articleMatch) text = articleMatch[1];

  // Remove HTML tags and decode entities
  text = text
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();

  return text.slice(0, CONFIG.ENRICHMENT.MAX_CONTENT_LENGTH);
}

/**
 * Fetch and extract key content from a URL
 */
export async function enrichArticle(url: string, title: string): Promise<string> {
  if (!CONFIG.ENRICHMENT.ENABLED) return "";

  for (let attempt = 0; attempt < CONFIG.ENRICHMENT.RETRIES; attempt++) {
    try {
      const html = await fetchURL(url);
      if (!html) continue;

      const text = extractTextFromHTML(html);
      if (text.length > 200) return text;
    } catch {
      // continue to next attempt
    }
  }

  return "";
}
