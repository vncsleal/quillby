import "dotenv/config";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
  ListPromptsRequestSchema,
  GetPromptRequestSchema,
  type Tool,
  type Resource,
  type Prompt,
} from "@modelcontextprotocol/sdk/types.js";
import { UserContextSchema, CardInputSchema } from "../types.js";
import {
  loadContext,
  saveContext,
  contextExists,
  contextToPromptText,
  ONBOARDING_PROMPT,
} from "../agents/onboard.js";
import { loadSources, appendSources } from "../agents/discover.js";
import { fetchArticles, preScoreArticles } from "../agents/harvest.js";
import { getGoogleNewsFeeds, getFeedlyFeeds } from "../agents/seeds.js";
import { PLATFORM_GUIDES } from "../agents/compose.js";
import { enrichArticle } from "../extractors/content.js";
import { saveSeenUrls } from "../extractors/rss.js";
import {
  loadLatestHarvest,
  latestHarvestExists,
  saveHarvestOutput,
  saveDraft,
} from "../output/structures.js";

const server = new Server(
  { name: "grist-mcp", version: "0.2.1" },
  { capabilities: { tools: {}, resources: {}, prompts: {}, logging: {} } }
);

function log(message: string) {
  server.sendLoggingMessage({ level: "info", data: message }).catch(() => {});
}

/**
 * Ask the host model to run inference via MCP Sampling.
 * Returns null if the host does not support Sampling — callers degrade gracefully.
 */
async function sample(prompt: string, maxTokens = 4096): Promise<string | null> {
  const caps = server.getClientCapabilities();
  if (!caps?.sampling) return null;
  try {
    const result = await server.createMessage({
      messages: [{ role: "user", content: { type: "text", text: prompt } }],
      maxTokens,
    });
    if (result.content.type === "text") return result.content.text;
    return null;
  } catch {
    return null;
  }
}

const TOOLS: Tool[] = [
  // ── Profile ───────────────────────────────────────────────────────────────
  {
    name: "grist_set_context",
    description: "Save the user content creator profile after onboarding.",
    annotations: { destructiveHint: false, idempotentHint: true },
    inputSchema: {
      type: "object",
      properties: {
        context: {
          type: "object",
          properties: {
            name: { type: "string" },
            role: { type: "string" },
            industry: { type: "string" },
            topics: { type: "array", items: { type: "string" } },
            voice: { type: "string" },
            audienceDescription: { type: "string" },
            contentGoals: { type: "array", items: { type: "string" } },
            excludeTopics: { type: "array", items: { type: "string" } },
            platforms: { type: "array", items: { type: "string" } },
            voiceExamples: { type: "array", items: { type: "string" } },
          },
          required: ["role", "industry", "topics", "voice", "audienceDescription", "contentGoals", "platforms"],
        },
      },
      required: ["context"],
    },
  },
  {
    name: "grist_get_context",
    description: "Load the saved user profile.",
    annotations: { readOnlyHint: true, idempotentHint: true },
    inputSchema: { type: "object", properties: {} },
  },

  // ── Feeds ─────────────────────────────────────────────────────────────────
  {
    name: "grist_discover_feeds",
    description:
      "Discover and save RSS feeds for the user's topics. Uses Google News RSS (any language/country) + Feedly search (curated publications) + Sampling for niche community feeds. No hardcoded lists.",
    annotations: { idempotentHint: true },
    inputSchema: {
      type: "object",
      properties: {
        topics: {
          type: "array",
          items: { type: "string" },
          description: "Override topics. Defaults to saved user context topics.",
        },
        locale: {
          type: "string",
          description: "BCP-47 language tag for Google News, e.g. \"en-US\", \"pt-BR\", \"fr-FR\". Defaults to en-US.",
        },
        country: {
          type: "string",
          description: "ISO 3166-1 country code for Google News, e.g. \"US\", \"BR\", \"FR\". Defaults to US.",
        },
      },
    },
  },
  {
    name: "grist_add_feeds",
    description: "Add RSS feed URLs to the sources list. Deduplicates automatically.",
    annotations: { idempotentHint: true },
    inputSchema: {
      type: "object",
      properties: {
        urls: { type: "array", items: { type: "string" }, description: "RSS/Atom feed URLs to add" },
      },
      required: ["urls"],
    },
  },
  {
    name: "grist_list_feeds",
    description: "List all configured RSS feed URLs.",
    annotations: { readOnlyHint: true, idempotentHint: true },
    inputSchema: { type: "object", properties: {} },
  },

  // ── Fetch & Research ──────────────────────────────────────────────────────
  {
    name: "grist_fetch_articles",
    description:
      "Fetch articles from RSS feeds. Use slim=true for a fast headline index, then grist_read_article for depth. Articles are pre-sorted by keyword relevance against saved user topics.",
    annotations: { readOnlyHint: false },
    inputSchema: {
      type: "object",
      properties: {
        sources: { type: "array", items: { type: "string" }, description: "Override RSS URLs. Defaults to all configured sources." },
        slim: { type: "boolean", description: "Return only title/source/link/snippet — no content fetching. Default: false." },
      },
    },
  },
  {
    name: "grist_read_article",
    description: "Fetch full text for a single article URL using Mozilla Readability. Use after grist_fetch_articles (slim=true).",
    annotations: { readOnlyHint: true, idempotentHint: true },
    inputSchema: {
      type: "object",
      properties: {
        url: { type: "string", description: "Article URL to fetch" },
        title: { type: "string", description: "Article title (improves extraction)" },
      },
      required: ["url"],
    },
  },

  // ── Analyze (Sampling-powered) ────────────────────────────────────────────
  {
    name: "grist_analyze_articles",
    description:
      "Full pipeline in one call: fetches feeds, pre-filters by keyword relevance, enriches top articles with Readability, then uses MCP Sampling to score and structure them into cards — all via the host model, no extra API key needed. Falls back to returning pre-scored headlines if Sampling is unavailable.",
    annotations: { readOnlyHint: false },
    inputSchema: {
      type: "object",
      properties: {
        articleIds: {
          type: "array",
          items: { type: "string" },
          description: "Limit analysis to specific article links. Omit to analyze all fetched articles.",
        },
        topN: {
          type: "number",
          description: "Analyze only the top N pre-scored articles. Default: 15.",
        },
      },
    },
  },

  // ── Cards ─────────────────────────────────────────────────────────────────
  {
    name: "grist_save_cards",
    description: "Save analyzed structure cards. GRIST persists them.",
    annotations: { destructiveHint: false },
    inputSchema: {
      type: "object",
      properties: {
        cards: {
          type: "array",
          items: {
            type: "object",
            properties: {
              title: { type: "string" },
              source: { type: "string" },
              link: { type: "string" },
              thesis: { type: "string" },
              relevanceScore: { type: "number" },
              relevanceReason: { type: "string" },
              keyInsights: { type: "array", items: { type: "string" } },
              insightOptions: { type: "array", items: { type: "string" } },
              takeOptions: { type: "array", items: { type: "string" } },
              angleOptions: { type: "array", items: { type: "string" } },
              hookOptions: { type: "array", items: { type: "string" } },
              wireframeOptions: { type: "array", items: { type: "string" } },
              trendTags: { type: "array", items: { type: "string" } },
              transposabilityHint: { type: "string" },
            },
            required: ["title", "source", "link", "thesis"],
          },
        },
      },
      required: ["cards"],
    },
  },
  {
    name: "grist_list_cards",
    description: "List saved structure cards from the latest harvest.",
    annotations: { readOnlyHint: true, idempotentHint: true },
    inputSchema: {
      type: "object",
      properties: {
        limit: { type: "number", description: "Max cards to return." },
        minScore: { type: "number", description: "Filter cards at or above this relevance score (0–10)." },
      },
    },
  },
  {
    name: "grist_get_card",
    description: "Get full details of a structure card by ID.",
    annotations: { readOnlyHint: true, idempotentHint: true },
    inputSchema: {
      type: "object",
      properties: { cardId: { type: "number" } },
      required: ["cardId"],
    },
  },

  // ── Drafts ────────────────────────────────────────────────────────────────
  {
    name: "grist_save_draft",
    description: "Save a draft post to disk.",
    annotations: { destructiveHint: false },
    inputSchema: {
      type: "object",
      properties: {
        content: { type: "string" },
        platform: { type: "string", description: "linkedin, x, instagram, threads, blog, newsletter, medium" },
        cardId: { type: "number" },
      },
      required: ["content", "platform"],
    },
  },
];

const RESOURCES: Resource[] = [
  {
    uri: "grist://context",
    name: "User Content Profile",
    description: "The user content creator profile: role, industry, topics, voice, audience, goals, platforms.",
    mimeType: "application/json",
  },
  {
    uri: "grist://harvest/latest",
    name: "Latest Harvest Cards",
    description: "Structure cards from the most recent fetch+analysis session.",
    mimeType: "application/json",
  },
  {
    uri: "grist://feeds",
    name: "RSS Feed Sources",
    description: "All configured RSS feed URLs.",
    mimeType: "text/plain",
  },
];

const PROMPTS: Prompt[] = [
  {
    name: "grist_onboarding",
    description: "Guide the user through initial GRIST setup to collect their content creator profile.",
  },
  {
    name: "grist_workflow",
    description: "Full GRIST workflow: onboard, discover feeds, fetch, analyze, generate posts.",
  },
];

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const { name, arguments: args = {} } = req.params;

  try {
    switch (name) {
      case "grist_set_context": {
        const context = UserContextSchema.parse((args as { context: unknown }).context);
        saveContext(context);
        return {
          content: [{ type: "text" as const, text: `Context saved. Role: ${context.role}. Topics: ${context.topics.join(", ")}. Platforms: ${context.platforms.join(", ")}.` }],
        };
      }

      case "grist_get_context": {
        if (!contextExists()) {
          return { content: [{ type: "text" as const, text: "No context saved. Run grist_onboarding first." }] };
        }
        return { content: [{ type: "text" as const, text: JSON.stringify(loadContext(), null, 2) }] };
      }

      case "grist_add_feeds": {
        const { urls } = args as { urls: string[] };
        const result = appendSources(urls);
        return {
          content: [{ type: "text" as const, text: `Added ${result.added} feed(s). Skipped ${result.skipped} duplicate(s). Total: ${loadSources().length}. Use grist_fetch_articles to pull articles.` }],
        };
      }

      case "grist_discover_feeds": {
        const ctx = contextExists() ? loadContext() : null;
        const { topics: topicOverride, locale = "en-US", country = "US" } = args as { topics?: string[]; locale?: string; country?: string };
        const topics: string[] = topicOverride?.length ? topicOverride : (ctx?.topics ?? []);
        if (topics.length === 0) {
          return { content: [{ type: "text" as const, text: "No topics in context. Run grist_onboarding first." }] };
        }
        // 1. Google News RSS — one feed per topic, real-time, multilingual
        const googleUrls = getGoogleNewsFeeds(topics, locale, country);
        // 2. Feedly search — curated publication feeds per topic
        const feedlyUrls = await getFeedlyFeeds(topics, 3);
        // 3. Sampling — ask the model for subreddits and niche community feeds
        const samplingAvailable = !!(server.getClientCapabilities()?.sampling);
        let samplingUrls: string[] = [];
        if (samplingAvailable) {
          const samplingPrompt = `The user is a content creator covering these topics: ${topics.join(", ")}.

Suggest relevant RSS/Atom community feeds that Google News and mainstream publications would miss — specifically:
- Subreddits (format: https://www.reddit.com/r/<name>/.rss)
- Niche industry forums or association blogs with RSS
- Specialist newsletters or substack feeds

Return ONLY a JSON array of URL strings. 10 items max. No explanation.`;
          const raw = await sample(samplingPrompt, 600);
          if (raw) {
            try {
              const match = raw.match(/\[.*\]/s);
              if (match) {
                const parsed = JSON.parse(match[0]) as unknown[];
                samplingUrls = parsed.filter((u): u is string => typeof u === "string" && u.startsWith("http"));
              }
            } catch {
              // ignore parse errors
            }
          }
        }
        const allUrls = [...new Set([...googleUrls, ...feedlyUrls, ...samplingUrls])];
        const result = appendSources(allUrls);
        return {
          content: [{
            type: "text" as const,
            text: JSON.stringify({
              topics,
              googleNewsFeeds: googleUrls.length,
              feedlyFeeds: feedlyUrls.length,
              samplingFeeds: samplingUrls.length,
              added: result.added,
              skipped: result.skipped,
              totalFeeds: loadSources().length,
            }, null, 2),
          }],
        };
      }

      case "grist_list_feeds": {
        const sources = loadSources();
        return {
          content: [{ type: "text" as const, text: sources.length ? JSON.stringify({ count: sources.length, feeds: sources }, null, 2) : "No feeds configured. Use grist_add_feeds." }],
        };
      }

      case "grist_fetch_articles": {
        const { sources: overrideSources, slim } = args as { sources?: string[]; slim?: boolean };
        const sources = overrideSources?.length ? overrideSources : loadSources();
        if (sources.length === 0) {
          return { content: [{ type: "text" as const, text: "No RSS sources configured. Use grist_discover_feeds to add curated feeds, or grist_add_feeds with manual URLs." }] };
        }
        const ctx = contextExists() ? loadContext() : null;
        const topics: string[] = ctx?.topics ?? [];
        const { articles, seenUrls } = await fetchArticles(sources, log, slim ?? false);
        saveSeenUrls(seenUrls);
        const scored = topics.length > 0 ? preScoreArticles(articles, topics) : articles.map((a) => ({ ...a, _preScore: 0 }));
        const output = slim
          ? scored.map(({ enrichedContent: _ec, ...rest }: { enrichedContent?: unknown; [k: string]: unknown }) => rest)
          : scored;
        return {
          content: [{ type: "text" as const, text: JSON.stringify({ feedsChecked: sources.length, articleCount: articles.length, slim: slim ?? false, articles: output }, null, 2) }],
        };
      }

      case "grist_read_article": {
        const { url, title = "" } = args as { url: string; title?: string };
        const content = await enrichArticle(url, title);
        if (!content) {
          return { content: [{ type: "text" as const, text: "Could not retrieve article content (paywalled or fetch failed)." }] };
        }
        return { content: [{ type: "text" as const, text: content }] };
      }

      case "grist_save_cards": {
        const { cards: rawCards } = args as { cards: unknown[] };
        const cards = rawCards.map((c) => CardInputSchema.parse(c));
        if (cards.length === 0) {
          return { content: [{ type: "text" as const, text: "No cards provided." }] };
        }
        const outputDir = saveHarvestOutput(cards, new Set());
        return { content: [{ type: "text" as const, text: `Saved ${cards.length} card(s) to ${outputDir}.` }] };
      }

      case "grist_list_cards": {
        if (!latestHarvestExists()) {
          return { content: [{ type: "text" as const, text: "No harvest found. Fetch articles and save cards first." }] };
        }
        const { limit, minScore } = args as { limit?: number; minScore?: number };
        const bundle = loadLatestHarvest();
        let cards = bundle.cards;
        if (minScore != null) {
          cards = cards.filter((c) => (c.relevanceScore ?? 0) >= minScore);
        }
        if (limit) cards = cards.slice(0, limit);
        return {
          content: [{ type: "text" as const, text: JSON.stringify({ generatedAt: bundle.generatedAt, total: bundle.cards.length, showing: cards.length, cards: cards.map((c) => ({ id: c.id, title: c.title, source: c.source, relevanceScore: c.relevanceScore, thesis: c.thesis, trendTags: c.trendTags })) }, null, 2) }],
        };
      }

      case "grist_analyze_articles": {
        const { topN: rawTopN } = args as { topN?: number };
        const topN = rawTopN ?? 15;
        if (!contextExists()) {
          return { content: [{ type: "text" as const, text: "No context saved. Run grist_onboarding first." }] };
        }
        const ctx = loadContext()!;
        const sources = loadSources();
        if (sources.length === 0) {
          return { content: [{ type: "text" as const, text: "No RSS sources configured. Use grist_discover_feeds first." }] };
        }
        const samplingAvailable = !!(server.getClientCapabilities()?.sampling);
        if (!samplingAvailable) {
          return { content: [{ type: "text" as const, text: "Sampling not available in this client. Use grist_fetch_articles + grist_read_article + grist_save_cards for manual analysis." }] };
        }
        // Fetch slim articles and pre-score
        const { articles, seenUrls } = await fetchArticles(sources, log, true);
        saveSeenUrls(seenUrls);
        if (articles.length === 0) {
          return { content: [{ type: "text" as const, text: "No new articles found. All items have been seen before." }] };
        }
        const scored = preScoreArticles(articles, ctx.topics);
        const topArticles = scored.slice(0, topN);
        // Enrich top articles
        const enriched: { title: string; url: string; snippet: string; content: string | null }[] = [];
        for (const article of topArticles) {
          const content = await enrichArticle(article.link, article.title ?? "");
          enriched.push({ title: article.title ?? "", url: article.link, snippet: article.snippet ?? "", content });
        }
        // Build analysis prompt
        const articleBlobs = enriched.map((a, i) =>
          `## Article ${i + 1}: ${a.title}\nURL: ${a.url}\n\n${a.content ?? a.snippet}`
        ).join("\n\n---\n\n");
        const voiceBlock = ctx.voiceExamples?.length
          ? `\n\nUser voice examples (study and match this style — do NOT smooth it out):\n${ctx.voiceExamples.map((e, i) => `[${i + 1}]\n${e}`).join("\n\n")}`
          : `\n\nUser voice: ${ctx.voice ?? "direct and authentic"}`;

        const analysisPrompt = `You are an expert content strategist. Analyze these articles for a ${ctx.role} in ${ctx.industry ?? "their industry"}.

User topics: ${ctx.topics.join(", ")}
User audience: ${ctx.audienceDescription ?? "general"}
User platforms: ${ctx.platforms.join(", ")}${voiceBlock}

${articleBlobs}

For each article, produce a JSON object with these fields:
- title (string)
- url (string)
- source (string — domain of URL)
- thesis (string — one sharp sentence: the single most important insight)
- relevanceScore (number 1-10)
- trendTags (array of 3-5 short tags)
- contentAngles (array of 2-3 post angles for the user's platforms)
- keyQuotes (array of 1-2 memorable lines or stats from the article)

Return ONLY a valid JSON array of these objects, no prose.`;
        const raw = await sample(analysisPrompt, 2000);
        if (!raw) {
          return { content: [{ type: "text" as const, text: "Sampling returned no result. Try again or use grist_fetch_articles + grist_save_cards manually." }] };
        }
        let cards: unknown[];
        try {
          const match = raw.match(/\[.*\]/s);
          if (!match) throw new Error("No JSON array in response");
          cards = JSON.parse(match[0]) as unknown[];
        } catch (e) {
          return { content: [{ type: "text" as const, text: `Sampling returned malformed JSON. Raw response:\n${raw}` }] };
        }
        const parsed = cards.map((c) => CardInputSchema.parse(c));
        const outputDir = saveHarvestOutput(parsed, seenUrls);
        return {
          content: [{ type: "text" as const, text: JSON.stringify({ analyzed: parsed.length, outputDir, cards: parsed.map((c) => ({ title: c.title, relevanceScore: c.relevanceScore, thesis: c.thesis })) }, null, 2) }],
        };
      }

      case "grist_get_card": {
        if (!latestHarvestExists()) {
          return { content: [{ type: "text" as const, text: "No harvest found." }] };
        }
        const { cardId } = args as { cardId: number };
        const bundle = loadLatestHarvest();
        const card = bundle.cards.find((c) => c.id === cardId);
        if (!card) {
          return { content: [{ type: "text" as const, text: `Card #${cardId} not found. Available: ${bundle.cards.map((c) => c.id).join(", ")}.` }] };
        }
        return { content: [{ type: "text" as const, text: JSON.stringify(card, null, 2) }] };
      }

      case "grist_save_draft": {
        const { content, platform, cardId } = args as { content: string; platform: string; cardId?: number };
        const filePath = saveDraft(content, platform, cardId);
        return { content: [{ type: "text" as const, text: `Draft saved to ${filePath}.` }] };
      }

      default:
        return { content: [{ type: "text" as const, text: `Unknown tool: ${name}` }], isError: true };
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { content: [{ type: "text" as const, text: `Error: ${message}` }], isError: true };
  }
});

server.setRequestHandler(ListResourcesRequestSchema, async () => ({ resources: RESOURCES }));

server.setRequestHandler(ReadResourceRequestSchema, async (req) => {
  const { uri } = req.params;
  switch (uri) {
    case "grist://context": {
      const text = contextExists()
        ? JSON.stringify(loadContext(), null, 2)
        : JSON.stringify({ error: "No context saved. Run grist_onboarding first." });
      return { contents: [{ uri, mimeType: "application/json", text }] };
    }
    case "grist://harvest/latest": {
      const text = latestHarvestExists()
        ? JSON.stringify(loadLatestHarvest(), null, 2)
        : JSON.stringify({ error: "No harvest yet. Run grist_fetch_articles and grist_save_cards." });
      return { contents: [{ uri, mimeType: "application/json", text }] };
    }
    case "grist://feeds": {
      const sources = loadSources();
      return { contents: [{ uri, mimeType: "text/plain", text: sources.length ? sources.join("\n") : "# No feeds configured." }] };
    }
    default:
      throw new Error(`Unknown resource: ${uri}`);
  }
});

server.setRequestHandler(ListPromptsRequestSchema, async () => ({ prompts: PROMPTS }));

server.setRequestHandler(GetPromptRequestSchema, async (req) => {
  const { name } = req.params;
  switch (name) {
    case "grist_onboarding": {
      const exists = contextExists();
      const existing = exists ? loadContext() : null;
      return {
        description: "GRIST onboarding",
        messages: [
          {
            role: "user" as const,
            content: {
              type: "text" as const,
              text: exists
                ? `I have a saved profile:\n\n${contextToPromptText(existing!)}\n\nUpdate it?`
                : "Set up GRIST for my content workflow.",
            },
          },
          {
            role: "assistant" as const,
            content: {
              type: "text" as const,
              text: exists
                ? "I can see your profile. Tell me what to change and I will call grist_set_context."
                : ONBOARDING_PROMPT,
            },
          },
        ],
      };
    }

    case "grist_workflow": {
      const platformGuideText = Object.entries(PLATFORM_GUIDES)
        .map(([p, g]) => `**${p}**: ${g}`)
        .join("\n\n");

      const ctx = contextExists() ? loadContext() : null;
      const voiceSection = ctx?.voiceExamples?.length
        ? `### Voice reference (read before writing any draft)

These are approved posts that define the target voice. Match the register, rhythm, and directness. Oversteer — if it feels too contained, it's wrong.

${ctx.voiceExamples.map((e, i) => `**Example ${i + 1}:**\n\`\`\`\n${e}\n\`\`\``).join("\n\n")}`
        : ctx?.voice
        ? `### Voice\n\n${ctx.voice}\n\nNo approved examples yet. Call grist_set_context with voiceExamples to lock in reference posts.`
        : "### Voice\n\nNo profile saved. Run grist_onboarding first.";

      const workflowText = `## GRIST Workflow

GRIST handles file I/O and data plumbing. All editorial judgment lives in the model.

### Setup (once)
1. Run grist_onboarding prompt, collect answers, call grist_set_context.
2. Call grist_discover_feeds — it matches your topics against a curated seed list and optionally expands it via Sampling. No manual feed hunting needed.

### Daily workflow — Automated (when Sampling is available)
1. Call grist_analyze_articles (limit: 8–12). GRIST fetches articles, pre-scores by topic overlap, enriches the top N, sends them to you via Sampling, and saves the resulting cards automatically.
2. Call grist_list_cards (minScore: 7) to see the strongest cards.
3. Call grist_get_card for the card you want to post about.
4. Write the post using the platform guide below.
5. Call grist_save_draft to persist it.

### Daily workflow — Manual (when Sampling is unavailable)
1. Call grist_fetch_articles with slim=true — returns a headline index sorted by pre-score. Fast, no content fetching.
2. Read grist://context. Identify the most promising articles by title and _preScore.
3. Call grist_read_article for each article you want to read in full.
4. Score relevance yourself. Generate card fields.
5. Call grist_save_cards with your analyzed cards.
6. Call grist_get_card for the card you want to post about.
7. Write the post using the platform guide below.
8. Call grist_save_draft to persist it.

### Voice rules (apply before writing any draft)
- Read the user's voiceExamples in their context. Identify the 2-3 strongest stylistic quirks. Amplify them — oversteer, not understeer.
- BANNED: “It’s not X, it’s Y” contrasts. Em-dash clusters. Bullet lists as prose. “Game-changer”, “transformative”, “powerful”, “unlock”, “leverage”, “dive into”. Filler openers (“In today’s world”, “Here’s the thing”). Emoji stacking. Numbered listicles. Motivational closings.
- Write like the user, not like an assistant helping the user.

${voiceSection}

### Platform guides

${platformGuideText}`;

      return {
        description: "GRIST workflow",
        messages: [
          { role: "user" as const, content: { type: "text" as const, text: "How do I use GRIST?" } },
          { role: "assistant" as const, content: { type: "text" as const, text: workflowText } },
        ],
      };
    }

    default:
      throw new Error(`Unknown prompt: ${name}`);
  }
});

const transport = new StdioServerTransport();
await server.connect(transport);
