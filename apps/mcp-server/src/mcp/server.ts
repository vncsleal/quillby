import "dotenv/config";
import * as http from "node:http";
import { randomUUID } from "node:crypto";
import { toNodeHandler } from "better-auth/node";
import { auth } from "../auth.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import {
  type Tool,
  type Resource,
  type Prompt,
} from "@modelcontextprotocol/sdk/types.js";
import { sql } from "drizzle-orm";
import { UserContextSchema, CardInputSchema } from "../types.js";
import {
  contextToPromptText,
  ONBOARDING_PROMPT,
} from "../agents/onboard.js";
import { fetchArticles, preScoreArticles } from "../agents/harvest.js";
import { getGoogleNewsFeeds, getMediumTagFeeds, getFeedlyFeeds } from "../agents/seeds.js";
import { PLATFORM_GUIDES } from "../agents/compose.js";
import { enrichArticle } from "../extractors/content.js";
import { getHostedUserStorage, storage, type WorkspaceStorage } from "../storage.js";
import { db } from "../db.js";
import {
  applyStripeWebhookEvent,
  getBillingActionUrl,
  getBillingPortalUrl,
  getPlanLimits,
  isCloudMode,
  isPlanEnforcementEnabled,
  verifyStripeWebhookSignature,
} from "../billing.js";
import { getDeploymentMode } from "../config.js";

const MEMORY_TYPES = {
  voice_examples: "voiceExamples",
  style_rules: "styleRules",
  audience_insights: "audienceInsights",
  do_not_say: "doNotSay",
  successful_posts: "successfulPosts",
  campaign_context: "campaignContext",
  source_preferences: "sourcePreferences",
} as const;

type MemoryTypeInput = keyof typeof MEMORY_TYPES;

const SERVER_INFO = { name: "quillby-mcp", version: "1.5.0" } as const;

function createMcpServer(): McpServer {
  return new McpServer(
    SERVER_INFO,
    { capabilities: { tools: {}, resources: {}, prompts: {}, logging: {} } }
  );
}

/**
 * Ask the host model to run inference via MCP Sampling.
 * Returns null if the host does not support Sampling — callers degrade gracefully.
 */
async function sample(server: McpServer, prompt: string, maxTokens = 4096): Promise<string | null> {
  const caps = server.server.getClientCapabilities();
  if (!caps?.sampling) return null;
  try {
    const result = await server.server.createMessage({
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
  // ── Onboarding ────────────────────────────────────────────────────────────
  {
    name: "quillby_onboard",
    description:
      "Interactive onboarding via MCP Elicitation. Asks 3 inline questions and saves your content creator profile. Falls back to text instructions if the client does not support Elicitation.",
    annotations: { idempotentHint: true },
    outputSchema: { type: "object" as const },
    inputSchema: { type: "object", properties: {} },
  },

  // ── Profile ───────────────────────────────────────────────────────────────
  {
    name: "quillby_list_workspaces",
    description: "List Quillby workspaces. Use one workspace per Claude Project, client, publication, or campaign.",
    annotations: { readOnlyHint: true, idempotentHint: true },
    outputSchema: { type: "object" as const },
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "quillby_create_workspace",
    description: "Create a workspace with isolated context, memories, feeds, and outputs.",
    annotations: { destructiveHint: false },
    outputSchema: { type: "object" as const },
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string" },
        workspaceId: { type: "string" },
        description: { type: "string" },
        makeCurrent: { type: "boolean" },
      },
      required: ["name"],
    },
  },
  {
    name: "quillby_select_workspace",
    description: "Switch the active Quillby workspace.",
    annotations: { destructiveHint: false, idempotentHint: true },
    outputSchema: { type: "object" as const },
    inputSchema: {
      type: "object",
      properties: {
        workspaceId: { type: "string" },
      },
      required: ["workspaceId"],
    },
  },
  {
    name: "quillby_get_workspace",
    description: "Inspect the active workspace or a specific workspace.",
    annotations: { readOnlyHint: true, idempotentHint: true },
    outputSchema: { type: "object" as const },
    inputSchema: {
      type: "object",
      properties: {
        workspaceId: { type: "string" },
      },
    },
  },
  {
    name: "quillby_get_plan",
    description: "Get the current hosted plan for this account.",
    annotations: { readOnlyHint: true, idempotentHint: true },
    outputSchema: { type: "object" as const },
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "quillby_manage_subscription",
    description: "Cloud billing lifecycle actions: upgrade, downgrade, or open billing portal.",
    annotations: { readOnlyHint: true, idempotentHint: true },
    outputSchema: { type: "object" as const },
    inputSchema: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["upgrade", "downgrade", "manage"] },
      },
      required: ["action"],
    },
  },
  {
    name: "quillby_share_workspace",
    description: "Grant another hosted user access to one of your workspaces.",
    annotations: { destructiveHint: false },
    outputSchema: { type: "object" as const },
    inputSchema: {
      type: "object",
      properties: {
        workspaceId: { type: "string" },
        granteeUserId: { type: "string" },
        role: { type: "string", enum: ["viewer", "editor"] },
      },
      required: ["workspaceId", "granteeUserId", "role"],
    },
  },
  {
    name: "quillby_revoke_access",
    description: "Revoke another hosted user's access to one of your workspaces.",
    annotations: { destructiveHint: false, idempotentHint: true },
    outputSchema: { type: "object" as const },
    inputSchema: {
      type: "object",
      properties: {
        workspaceId: { type: "string" },
        granteeUserId: { type: "string" },
      },
      required: ["workspaceId", "granteeUserId"],
    },
  },
  {
    name: "quillby_list_workspace_access",
    description: "List users who have access to one of your hosted workspaces.",
    annotations: { readOnlyHint: true, idempotentHint: true },
    outputSchema: { type: "object" as const },
    inputSchema: {
      type: "object",
      properties: {
        workspaceId: { type: "string" },
      },
      required: ["workspaceId"],
    },
  },
  {
    name: "quillby_server_info",
    description: "Get server runtime info: version, deployment mode, transport, and DB status. Useful for self-hosted operations.",
    annotations: { readOnlyHint: true, idempotentHint: true },
    outputSchema: { type: "object" as const },
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "quillby_set_context",
    description: "Save the user content creator profile after onboarding.",
    annotations: { destructiveHint: false, idempotentHint: true },
    outputSchema: { type: "object" as const },
    inputSchema: {
      type: "object",
      properties: {
        workspaceId: { type: "string", description: "Optional workspace override without changing global selection." },
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
          },
          required: ["role", "industry", "topics", "voice", "audienceDescription", "contentGoals", "platforms"],
        },
      },
      required: ["context"],
    },
  },
  {
    name: "quillby_get_context",
    description: "Load the saved user profile.",
    annotations: { readOnlyHint: true, idempotentHint: true },
    outputSchema: { type: "object" as const },
    inputSchema: {
      type: "object",
      properties: {
        workspaceId: { type: "string", description: "Optional workspace override without changing global selection." },
      },
    },
  },

  // ── Feeds ─────────────────────────────────────────────────────────────────
  {
    name: "quillby_discover_feeds",
    description:
      "Discover and save content sources for the user's topics. Adds: Google News RSS (real-time news, any language), Medium tag feeds (professional articles on any industry), Feedly curated publications, and Reddit communities (reddit://r/<subreddit>) via Sampling. Works for any niche: healthcare, law, fashion, construction, farming, finance, etc.",
    annotations: { idempotentHint: true },
    outputSchema: { type: "object" as const },
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
    name: "quillby_add_feeds",
    description: "Add content sources manually. Accepts: standard RSS/Atom URLs, Medium tag feeds (https://medium.com/feed/tag/<topic>), Google News RSS URLs, and Reddit communities (reddit://r/<subreddit> or reddit://r/<subreddit>/top). Deduplicates automatically.",
    annotations: { idempotentHint: true },
    outputSchema: { type: "object" as const },
    inputSchema: {
      type: "object",
      properties: {
        urls: { type: "array", items: { type: "string" }, description: "Source URLs: RSS/Atom URLs, medium.com/feed/tag/*, reddit://r/name" },
      },
      required: ["urls"],
    },
  },
  {
    name: "quillby_list_feeds",
    description: "List all configured RSS feed URLs.",
    annotations: { readOnlyHint: true, idempotentHint: true },
    outputSchema: { type: "object" as const },
    inputSchema: {
      type: "object",
      properties: {
        workspaceId: { type: "string", description: "Optional workspace override without changing global selection." },
      },
    },
  },

  // ── Fetch & Research ──────────────────────────────────────────────────────
  {
    name: "quillby_fetch_articles",
    description:
      "Fetch articles from all configured sources: RSS feeds (Google News, Medium, Feedly, any Atom/RSS URL) and Reddit communities (reddit://r/). Use slim=true for a fast headline index, then quillby_read_article for depth. Articles are pre-sorted by keyword relevance against saved user topics.",
    annotations: { readOnlyHint: false },
    outputSchema: { type: "object" as const },
    inputSchema: {
      type: "object",
      properties: {
        sources: { type: "array", items: { type: "string" }, description: "Override RSS URLs. Defaults to all configured sources." },
        slim: { type: "boolean", description: "Return only title/source/link/snippet — no content fetching. Default: false." },
      },
    },
  },
  {
    name: "quillby_read_article",
    description: "Fetch full text for a single article URL using Mozilla Readability. Use after quillby_fetch_articles (slim=true).",
    annotations: { readOnlyHint: true, idempotentHint: true },
    outputSchema: { type: "object" as const },
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
    name: "quillby_analyze_articles",
    description:
      "Full pipeline in one call: fetches feeds, pre-filters by keyword relevance, enriches top articles with Readability, then uses MCP Sampling to score and structure them into cards — all via the host model, no extra API key needed. Falls back to returning pre-scored headlines if Sampling is unavailable.",
    annotations: { readOnlyHint: false },
    outputSchema: { type: "object" as const },
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

  // ── Daily Brief (two-pass Sampling pipeline) ──────────────────────────────
  {
    name: "quillby_daily_brief",
    description:
      "Generate a fresh Quillby Briefing by fetching feeds, scoring headlines semantically, deep-reading top articles, and producing ranked cards via Sampling. Call this only when the Briefing is stale, missing, or the user explicitly asks for a refresh. To open an existing saved Briefing instantly, use quillby_open_briefing instead. Requires Sampling.",
    annotations: { readOnlyHint: false },
    outputSchema: { type: "object" as const },
    inputSchema: {
      type: "object",
      properties: {
        topN: {
          type: "number",
          description: "How many top-scored articles to deep-read and card. Default: 10.",
        },
      },
    },
  },

  // ── Open Briefing (instant, from saved state) ─────────────────────────────
  {
    name: "quillby_open_briefing",
    description:
      "Open the most recent Quillby Briefing instantly from saved workspace state — no network calls, no Sampling. Always call this first when the user opens Quillby or asks to see their brief. Falls back with a clear message if no Briefing has been generated yet.",
    annotations: { readOnlyHint: true, idempotentHint: true },
    outputSchema: { type: "object" as const },
    inputSchema: {
      type: "object",
      properties: {
        workspaceId: { type: "string", description: "Optional workspace override without changing global selection." },
      },
    },
  },

  // ── Cards ─────────────────────────────────────────────────────────────────
  {
    name: "quillby_save_cards",
    description: "Save analyzed structure cards. Quillby persists them.",
    annotations: { destructiveHint: false },
    outputSchema: { type: "object" as const },
    inputSchema: {
      type: "object",
      properties: {
        workspaceId: { type: "string", description: "Optional workspace override without changing global selection." },
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
    name: "quillby_list_cards",
    description: "List saved story candidates from the latest harvest. Best used behind the scenes when Claude is opening or updating a Story artifact.",
    annotations: { readOnlyHint: true, idempotentHint: true },
    outputSchema: { type: "object" as const },
    inputSchema: {
      type: "object",
      properties: {
        workspaceId: { type: "string", description: "Optional workspace override without changing global selection." },
        limit: { type: "number", description: "Max cards to return." },
        minScore: { type: "number", description: "Filter cards at or above this relevance score (0–10)." },
      },
    },
  },
  {
    name: "quillby_get_card",
    description: "Get full details for one saved story candidate by ID. Best used behind the scenes when Claude is opening or updating a Story artifact.",
    annotations: { readOnlyHint: true, idempotentHint: true },
    outputSchema: { type: "object" as const },
    inputSchema: {
      type: "object",
      properties: {
        workspaceId: { type: "string", description: "Optional workspace override without changing global selection." },
        cardId: { type: "number" },
      },
      required: ["cardId"],
    },
  },

  // ── Drafts ────────────────────────────────────────────────────────────────
  {
    name: "quillby_save_draft",
    description: "Persist a finished draft post to workspace storage. Call after quillby_generate_post or whenever the user approves a draft to keep.",
    annotations: { destructiveHint: false },
    outputSchema: { type: "object" as const },
    inputSchema: {
      type: "object",
      properties: {
        workspaceId: { type: "string", description: "Optional workspace override without changing global selection." },
        content: { type: "string" },
        platform: { type: "string", description: "linkedin, x, instagram, threads, blog, newsletter, medium" },
        cardId: { type: "number" },
        addToVoiceExamples: { type: "boolean", description: "If true, saves this draft as a voice example in memory." },
      },
      required: ["content", "platform"],
    },
  },
  {
    name: "quillby_list_drafts",
    description: "List saved draft posts for the current workspace, most recent first.",
    annotations: { readOnlyHint: true, idempotentHint: true },
    outputSchema: { type: "object" as const },
    inputSchema: {
      type: "object",
      properties: {
        workspaceId: { type: "string", description: "Optional workspace override without changing global selection." },
      },
    },
  },

  // ── Card curation ─────────────────────────────────────────────────────────
  {
    name: "quillby_curate_card",
    description:
      "Mark a story card as shortlisted, approved, skipped, or clear its status. Use this to build a ranked drafting queue from the Briefing. Shortlisted = queued for drafting; approved = drafted and approved; skipped = not useful this cycle; clear = remove any status.",
    annotations: { destructiveHint: false, idempotentHint: true },
    outputSchema: { type: "object" as const },
    inputSchema: {
      type: "object",
      properties: {
        workspaceId: { type: "string", description: "Optional workspace override without changing global selection." },
        cardId: { type: "number", description: "Structure card ID to curate." },
        action: {
          type: "string",
          enum: ["shortlist", "approve", "skip", "clear"],
          description: "shortlist = queue for drafting; approve = drafted and approved; skip = skip this cycle; clear = remove status.",
        },
      },
      required: ["cardId", "action"],
    },
  },

  // ── Generate (Sampling-powered) ───────────────────────────────────────────
  {
    name: "quillby_generate_post",
    description:
      "Generate a finished post via MCP Sampling and save it as a draft. Loads the card, user profile, platform guide, and voice examples — writes the post, saves it. One call: write + save. Requires Sampling.",
    annotations: { destructiveHint: false },
    outputSchema: { type: "object" as const },
    inputSchema: {
      type: "object",
      properties: {
        cardId: { type: "number", description: "Structure card ID to base the post on." },
        platform: { type: "string", description: "linkedin, x, instagram, threads, blog, newsletter, medium" },
        angle: { type: "string", description: "Specific angle or take to use. If omitted, uses the card's top angle option." },
      },
      required: ["cardId", "platform"],
    },
  },

  // ── Memory ────────────────────────────────────────────────────────────────
  {
    name: "quillby_remember",
    description:
      "Add structured memory to the current workspace. Supports voice examples plus typed editorial memory buckets.",
    annotations: { destructiveHint: false },
    outputSchema: { type: "object" as const },
    inputSchema: {
      type: "object",
      properties: {
        workspaceId: { type: "string", description: "Optional workspace override without changing global selection." },
        entries: {
          type: "array",
          items: { type: "string" },
          description: "Memory entries to add.",
        },
        memoryType: {
          type: "string",
          enum: Object.keys(MEMORY_TYPES),
          description: "voice_examples, style_rules, audience_insights, do_not_say, successful_posts, campaign_context, source_preferences",
        },
      },
      required: ["entries"],
    },
  },
  {
    name: "quillby_get_memory",
    description: "Read typed memory from the current workspace. Claude should use this behind the scenes when opening or updating the Voice System artifact.",
    annotations: { readOnlyHint: true, idempotentHint: true },
    outputSchema: { type: "object" as const },
    inputSchema: {
      type: "object",
      properties: {
        workspaceId: { type: "string", description: "Optional workspace override without changing global selection." },
        memoryType: {
          type: "string",
          enum: Object.keys(MEMORY_TYPES),
        },
      },
    },
  },
];

const RESOURCES: Resource[] = [
  {
    uri: "quillby://workspace/current",
    name: "Active Workspace",
    description: "Current Quillby workspace metadata.",
    mimeType: "application/json",
  },
  {
    uri: "quillby://context",
    name: "User Content Profile",
    description: "The user content creator profile: role, industry, topics, voice, audience, goals, platforms.",
    mimeType: "application/json",
  },
  {
    uri: "quillby://memory",
    name: "User Memory",
    description: "Typed memory for the active workspace.",
    mimeType: "application/json",
  },
  {
    uri: "quillby://harvest/latest",
    name: "Latest Harvest Cards",
    description: "Structure cards from the most recent fetch+analysis session.",
    mimeType: "application/json",
  },
  {
    uri: "quillby://feeds",
    name: "RSS Feed Sources",
    description: "All configured RSS feed URLs.",
    mimeType: "text/plain",
  },
];

const PROMPTS: Prompt[] = [
  {
    name: "quillby_onboarding",
    description: "Guide the user through initial Quillby setup to collect their content creator profile.",
  },
  {
    name: "quillby_session_start",
    description: "Open Quillby the Claude-native way: onboarding if needed, otherwise create or update the Briefing artifact.",
  },
  {
    name: "quillby_briefing",
    description: "How Claude should create and update the Quillby Briefing artifact.",
  },
  {
    name: "quillby_story",
    description: "How Claude should open and update a Quillby Story artifact from a ranked item.",
  },
  {
    name: "quillby_voice_system",
    description: "How Claude should open and update the Quillby Voice System artifact from workspace memory.",
  },
  {
    name: "quillby_projects_playbook",
    description: "How to align Quillby workspaces, Claude Projects, and native Artifacts.",
  },
];

async function handleToolCall(
  server: McpServer,
  storage: WorkspaceStorage,
  name: string,
  args: Record<string, unknown> = {}
) {
  const log = (message: string) => {
    server.sendLoggingMessage({ level: "info", data: message }).catch(() => {});
  };

  try {
    const resolveStorage = async (): Promise<WorkspaceStorage> => {
      const workspaceId = typeof args.workspaceId === "string" ? args.workspaceId : undefined;
      if (!workspaceId) return storage;
      return storage.withWorkspace(workspaceId);
    };

    switch (name) {
      case "quillby_list_workspaces": {
        const currentWorkspaceId = await storage.getCurrentWorkspaceId();
        const workspaces = (await storage.listWorkspaces()).map((workspace) => ({
          ...workspace,
          current: workspace.id === currentWorkspaceId,
        }));
        return {
          content: [{ type: "text" as const, text: JSON.stringify({ currentWorkspaceId, workspaces }, null, 2) }],
          structuredContent: { currentWorkspaceId, workspaces },
        };
      }

      case "quillby_create_workspace": {
        const { name: workspaceName, workspaceId, description, makeCurrent } = args as {
          name: string;
          workspaceId?: string;
          description?: string;
          makeCurrent?: boolean;
        };
        const workspace = await storage.createWorkspace({
          id: workspaceId,
          name: workspaceName,
          description,
          makeCurrent: makeCurrent ?? true,
        });
        return {
          content: [{ type: "text" as const, text: `Workspace "${workspace.name}" created with id "${workspace.id}".` }],
          structuredContent: workspace,
        };
      }

      case "quillby_select_workspace": {
        const { workspaceId } = args as { workspaceId: string };
        const workspace = await storage.setCurrentWorkspace(workspaceId);
        return {
          content: [{ type: "text" as const, text: `Current workspace set to "${workspace.name}" (${workspace.id}).` }],
          structuredContent: workspace,
        };
      }

      case "quillby_get_workspace": {
        const activeStorage = await resolveStorage();
        const workspace = await activeStorage.getCurrentWorkspace();
        const [ctx, mem, sources] = await Promise.all([
          activeStorage.loadContext(),
          activeStorage.loadTypedMemory(),
          activeStorage.loadSources(),
        ]);
        return {
          content: [{
            type: "text" as const,
            text: JSON.stringify({
              workspace,
              current: true,
              context: ctx,
              memory: mem,
              feedCount: sources.length,
            }, null, 2),
          }],
          structuredContent: {
            workspace,
            current: true,
            context: ctx,
            memory: mem,
            feedCount: sources.length,
          },
        };
      }

      case "quillby_get_plan": {
        const plan = await storage.getPlan();
        const mode = getDeploymentMode();
        const limits = getPlanLimits(plan);
        const portalUrl = getBillingPortalUrl();
        return {
          content: [{
            type: "text" as const,
            text: JSON.stringify({
              plan,
              mode,
              planEnforcementEnabled: isPlanEnforcementEnabled(),
              limits,
              billingPortalUrl: portalUrl,
              lifecycleActions: {
                upgrade: isCloudMode() ? "quillby_manage_subscription(action=upgrade)" : null,
                downgrade: isCloudMode() ? "quillby_manage_subscription(action=downgrade)" : null,
                manage: isCloudMode() ? "quillby_manage_subscription(action=manage)" : null,
              },
            }, null, 2),
          }],
          structuredContent: {
            plan,
            mode,
            planEnforcementEnabled: isPlanEnforcementEnabled(),
            limits,
            billingPortalUrl: portalUrl,
              lifecycleActions: {
                upgrade: isCloudMode() ? "quillby_manage_subscription(action=upgrade)" : null,
                downgrade: isCloudMode() ? "quillby_manage_subscription(action=downgrade)" : null,
                manage: isCloudMode() ? "quillby_manage_subscription(action=manage)" : null,
              },
          },
        };
      }

        case "quillby_manage_subscription": {
          const { action } = args as { action: "upgrade" | "downgrade" | "manage" };
          const plan = await storage.getPlan();
          if (!isCloudMode()) {
            return {
              content: [{ type: "text" as const, text: "Subscription management is only available in Quillby Cloud mode." }],
              structuredContent: { action, available: false, reason: "not_cloud_mode", plan, mode: getDeploymentMode() },
            };
          }
          const url = getBillingActionUrl(action, plan);
          if (!url) {
            return {
              content: [{ type: "text" as const, text: `Billing action URL for ${action} is not configured.` }],
              structuredContent: { action, available: false, reason: "missing_configuration", plan },
            };
          }
          return {
            content: [{ type: "text" as const, text: JSON.stringify({ action, plan, url }, null, 2) }],
            structuredContent: { action, plan, url, available: true },
          };
        }

      case "quillby_share_workspace": {
        const { workspaceId, granteeUserId, role } = args as { workspaceId: string; granteeUserId: string; role: "viewer" | "editor" };
        await storage.shareWorkspace(workspaceId, granteeUserId, role);
        return {
          content: [{ type: "text" as const, text: `Granted ${role} access to ${granteeUserId} on workspace "${workspaceId}".` }],
          structuredContent: { workspaceId, granteeUserId, role, shared: true },
        };
      }

      case "quillby_revoke_access": {
        const { workspaceId, granteeUserId } = args as { workspaceId: string; granteeUserId: string };
        await storage.revokeAccess(workspaceId, granteeUserId);
        return {
          content: [{ type: "text" as const, text: `Revoked access for ${granteeUserId} on workspace "${workspaceId}".` }],
          structuredContent: { workspaceId, granteeUserId, revoked: true },
        };
      }

      case "quillby_list_workspace_access": {
        const { workspaceId } = args as { workspaceId: string };
        const access = await storage.listWorkspaceAccess(workspaceId);
        return {
          content: [{ type: "text" as const, text: JSON.stringify({ workspaceId, count: access.length, access }, null, 2) }],
          structuredContent: { workspaceId, count: access.length, access },
        };
      }

      case "quillby_server_info": {
        const mode = getDeploymentMode();
        const transport = process.env.Quillby_TRANSPORT ?? process.env.QUILLBY_TRANSPORT ?? "stdio";
        const dbUrl = process.env.QUILLBY_AUTH_DB_URL ?? "file:./quillby-auth.db";
        let dbStatus: "ok" | "error" = "ok";
        let dbError: string | null = null;
        try {
          await db.run(sql.raw("SELECT 1"));
        } catch (err) {
          dbStatus = "error";
          dbError = err instanceof Error ? err.message : String(err);
        }
        return {
          content: [{
            type: "text" as const,
            text: JSON.stringify({
              name: SERVER_INFO.name,
              version: SERVER_INFO.version,
              mode,
              transport,
              cloudMode: isCloudMode(),
              planEnforcementEnabled: isPlanEnforcementEnabled(),
              db: {
                status: dbStatus,
                url: dbUrl,
                error: dbError,
              },
            }, null, 2),
          }],
          structuredContent: {
            name: SERVER_INFO.name,
            version: SERVER_INFO.version,
            mode,
            transport,
            cloudMode: isCloudMode(),
            planEnforcementEnabled: isPlanEnforcementEnabled(),
            db: {
              status: dbStatus,
              url: dbUrl,
              error: dbError,
            },
          },
        };
      }

      case "quillby_onboard": {
        const caps = server.server.getClientCapabilities();
        if (!caps?.elicitation?.form) {
          // Client doesn't support form elicitation — return the static onboarding prompt
          return {
            content: [{ type: "text" as const, text: ONBOARDING_PROMPT }],
            structuredContent: { elicitationAvailable: false, message: ONBOARDING_PROMPT },
          };
        }

        // Step 1 — Identity
        const s1 = await server.server.elicitInput({
          message: "Let's set up your Quillby profile. Step 1 of 3: who are you?",
          requestedSchema: {
            type: "object" as const,
            properties: {
              name: { type: "string" as const, title: "Your name", description: "Optional — used to personalize prompts" },
              role: { type: "string" as const, title: "Your role", description: "e.g. founder, marketer, software engineer, researcher" },
              industry: { type: "string" as const, title: "Industry or niche", description: "e.g. SaaS, healthcare, fintech, creator economy" },
            },
            required: ["role", "industry"],
          },
        });
        if (s1.action !== "accept" || !s1.content) {
          return {
            content: [{ type: "text" as const, text: "Onboarding cancelled." }],
            structuredContent: { cancelled: true, message: "Onboarding cancelled." },
          };
        }

        // Step 2 — Topics & audience
        const s2 = await server.server.elicitInput({
          message: "Step 2 of 3: what do you write about, and who reads it?",
          requestedSchema: {
            type: "object" as const,
            properties: {
              topics: { type: "string" as const, title: "Topics to cover", description: "Comma-separated: e.g. AI, developer tools, startup fundraising" },
              audienceDescription: { type: "string" as const, title: "Your audience", description: "e.g. senior engineers at B2B SaaS companies" },
              contentGoals: { type: "string" as const, title: "Content goals", description: "Comma-separated: e.g. build authority, grow newsletter, drive inbound leads" },
            },
            required: ["topics", "audienceDescription", "contentGoals"],
          },
        });
        if (s2.action !== "accept" || !s2.content) {
          return {
            content: [{ type: "text" as const, text: "Onboarding cancelled." }],
            structuredContent: { cancelled: true, message: "Onboarding cancelled." },
          };
        }

        // Step 3 — Voice & platforms
        const s3 = await server.server.elicitInput({
          message: "Step 3 of 3: how do you write, and where do you publish?",
          requestedSchema: {
            type: "object" as const,
            properties: {
              voice: { type: "string" as const, title: "Writing voice", description: "e.g. direct and analytical, no corporate speak, sardonic, data-heavy" },
              platforms: {
                type: "array" as const,
                title: "Publishing platforms",
                description: "Select all platforms you use",
                items: { type: "string" as const, enum: ["linkedin", "x", "blog", "newsletter", "medium", "instagram", "threads"] },
              },
              excludeTopics: { type: "string" as const, title: "Topics to avoid (optional)", description: "Comma-separated topics Quillby should filter out" },
            },
            required: ["voice", "platforms"],
          },
        });
        if (s3.action !== "accept" || !s3.content) {
          return {
            content: [{ type: "text" as const, text: "Onboarding cancelled." }],
            structuredContent: { cancelled: true, message: "Onboarding cancelled." },
          };
        }

        const splitCSV = (v: unknown): string[] =>
          typeof v === "string" ? v.split(",").map((s) => s.trim()).filter(Boolean) : [];
        const toStrArr = (v: unknown): string[] =>
          Array.isArray(v) ? (v as unknown[]).filter((x): x is string => typeof x === "string") : splitCSV(v);

        const onboardCtx = UserContextSchema.parse({
          name: s1.content.name || undefined,
          role: s1.content.role,
          industry: s1.content.industry,
          topics: splitCSV(s2.content.topics),
          audienceDescription: s2.content.audienceDescription,
          contentGoals: splitCSV(s2.content.contentGoals),
          voice: s3.content.voice,
          platforms: toStrArr(s3.content.platforms),
          excludeTopics: s3.content.excludeTopics ? splitCSV(s3.content.excludeTopics) : [],
        });
        await storage.saveContext(onboardCtx);

        const onboardWs = await storage.getCurrentWorkspace();
        const summary = `Workspace: ${onboardWs.name}\n\nRole: ${onboardCtx.role} in ${onboardCtx.industry}\nTopics: ${onboardCtx.topics.join(", ")}\nPlatforms: ${onboardCtx.platforms.join(", ")}\nVoice: ${onboardCtx.voice}\n\nNext: call quillby_discover_feeds to set up your RSS sources.`;
        return {
          content: [{ type: "text" as const, text: summary }],
          structuredContent: { saved: true, profile: onboardCtx as unknown as Record<string, unknown> },
        };
      }

      case "quillby_set_context": {
        const activeStorage = await resolveStorage();
        const context = UserContextSchema.parse((args as { context: unknown }).context);
        await activeStorage.saveContext(context);
        const setCtxWs = await activeStorage.getCurrentWorkspace();
        return {
          content: [{ type: "text" as const, text: `Context saved for workspace "${setCtxWs.name}". Role: ${context.role}. Topics: ${context.topics.join(", ")}. Platforms: ${context.platforms.join(", ")}.` }],
          structuredContent: { saved: true, workspaceId: setCtxWs.id, role: context.role, topics: context.topics, platforms: context.platforms },
        };
      }

      case "quillby_get_context": {
        const activeStorage = await resolveStorage();
        if (!await activeStorage.contextExists()) {
          return { content: [{ type: "text" as const, text: "No context saved for this workspace yet. Start by setting up Quillby for it." }], structuredContent: { error: "no_context" } };
        }
        const ctxData = (await activeStorage.loadContext())!;
        const getCtxWs = await activeStorage.getCurrentWorkspace();
        return {
          content: [{ type: "text" as const, text: JSON.stringify({ workspace: getCtxWs, context: ctxData }, null, 2) }],
          structuredContent: { workspace: getCtxWs, context: ctxData },
        };
      }

      case "quillby_add_feeds": {
        const { urls } = args as { urls: string[] };
        const result = await storage.appendSources(urls);
        const totalAfterAdd = (await storage.loadSources()).length;
        return {
          content: [{ type: "text" as const, text: `Added ${result.added} feed(s). Skipped ${result.skipped} duplicate(s). Total: ${totalAfterAdd}. Quillby is ready to open or refresh the workspace Briefing.` }],
          structuredContent: { added: result.added, skipped: result.skipped, total: totalAfterAdd },
        };
      }

      case "quillby_discover_feeds": {
        const ctxExists = await storage.contextExists();
        const ctx = ctxExists ? await storage.loadContext() : null;
        const { topics: topicOverride, locale = "en-US", country = "US" } = args as { topics?: string[]; locale?: string; country?: string };
        const topics: string[] = topicOverride?.length ? topicOverride : (ctx?.topics ?? []);
        if (topics.length === 0) {
          return { content: [{ type: "text" as const, text: "No topics are saved for this workspace yet. Update the Quillby setup first." }], structuredContent: { error: "no_topics" } };
        }
        const googleUrls = getGoogleNewsFeeds(topics, locale, country);
        const mediumUrls = getMediumTagFeeds(topics);
        const feedlyUrls = await getFeedlyFeeds(topics, 3);
        const samplingAvailable = !!(server.server.getClientCapabilities()?.sampling);
        let samplingUrls: string[] = [];
        if (samplingAvailable) {
          const samplingPrompt = `The user is a content creator covering these topics: ${topics.join(", ")}.

Suggest niche content sources that broad news feeds would miss. For each suggestion:
- Reddit communities relevant to these topics: use the format reddit://r/<subreddit> (e.g. reddit://r/smallbusiness, reddit://r/medicine, reddit://r/farming, reddit://r/law)
- Niche industry association blogs, trade publication RSS feeds, or specialist Substack feeds: use standard https:// URLs

Pick communities and publications that match the industry, not tech/startup defaults. A clothing boutique owner needs fashion/retail communities. A health professional needs medical/wellness sources. A lawyer needs legal industry feeds.

Return ONLY a JSON array of strings. 10 items max. No explanation.`;
          const raw = await sample(server, samplingPrompt, 600);
          if (raw) {
            try {
              const match = raw.match(/\[.*\]/s);
              if (match) {
                const parsed = JSON.parse(match[0]) as unknown[];
                samplingUrls = parsed.filter(
                  (u): u is string =>
                    typeof u === "string" &&
                    (u.startsWith("http") || u.startsWith("reddit://"))
                );
              }
            } catch {
              // ignore parse errors
            }
          }
        }
        const allUrls = [...new Set([...googleUrls, ...mediumUrls, ...feedlyUrls, ...samplingUrls])];
        const result = await storage.appendSources(allUrls);
        const discoverResult = {
          topics,
          googleNewsFeeds: googleUrls.length,
          mediumTagFeeds: mediumUrls.length,
          feedlyFeeds: feedlyUrls.length,
          samplingFeeds: samplingUrls.length,
          added: result.added,
          skipped: result.skipped,
          totalFeeds: (await storage.loadSources()).length,
        };
        return {
          content: [{ type: "text" as const, text: JSON.stringify(discoverResult, null, 2) }],
          structuredContent: discoverResult,
        };
      }

      case "quillby_list_feeds": {
        const activeStorage = await resolveStorage();
        const sources = await activeStorage.loadSources();
        const listFeedsResult = { count: sources.length, feeds: sources };
        return {
          content: [{ type: "text" as const, text: sources.length ? JSON.stringify(listFeedsResult, null, 2) : "No feeds configured. Use quillby_add_feeds." }],
          structuredContent: listFeedsResult,
        };
      }

      case "quillby_fetch_articles": {
        const { sources: overrideSources, slim } = args as { sources?: string[]; slim?: boolean };
        const sources = overrideSources?.length ? overrideSources : await storage.loadSources();
        if (sources.length === 0) {
          return { content: [{ type: "text" as const, text: "No RSS sources configured. Use quillby_discover_feeds to add curated feeds, or quillby_add_feeds with manual URLs." }], structuredContent: { error: "no_sources" } };
        }
        const ctxExistsFetch = await storage.contextExists();
        const ctx = ctxExistsFetch ? await storage.loadContext() : null;
        const topics: string[] = ctx?.topics ?? [];
        const { articles, seenUrls } = await fetchArticles(sources, await storage.getSeenUrls(), log, slim ?? false);
        await storage.saveSeenUrls(seenUrls);
        const scored = topics.length > 0 ? preScoreArticles(articles, topics) : articles.map((a) => ({ ...a, _preScore: 0 }));
        const output = slim
          ? scored.map((item: { enrichedContent?: unknown; [k: string]: unknown }) => {
              const rest = { ...item };
              delete rest.enrichedContent;
              return rest;
            })
          : scored;
        const fetchResult = { feedsChecked: sources.length, articleCount: articles.length, slim: slim ?? false, articles: output };
        return {
          content: [{ type: "text" as const, text: JSON.stringify(fetchResult, null, 2) }],
          structuredContent: fetchResult as unknown as Record<string, unknown>,
        };
      }

      case "quillby_read_article": {
        const { url, title = "" } = args as { url: string; title?: string };
        const content = await enrichArticle(url, title);
        if (!content) {
          return { content: [{ type: "text" as const, text: "Could not retrieve article content (paywalled or fetch failed)." }], structuredContent: { content: null, error: "fetch_failed" } };
        }
        return { content: [{ type: "text" as const, text: content }], structuredContent: { content } };
      }

      case "quillby_open_briefing": {
        const activeStorage = await resolveStorage();
        const [workspace, hasBriefing] = await Promise.all([
          activeStorage.getCurrentWorkspace(),
          activeStorage.latestHarvestExists(),
        ]);
        if (!hasBriefing) {
          return {
            content: [{ type: "text" as const, text: `No Briefing saved yet for workspace "${workspace.name}". Run quillby_daily_brief to generate one.` }],
            structuredContent: { error: "no_briefing", workspace: workspace.name, workspaceId: workspace.id },
          };
        }
        const [bundle, ctx] = await Promise.all([
          activeStorage.loadLatestHarvest(),
          activeStorage.loadContext(),
        ]);
        const curation = bundle.curationState ?? {};
        const sorted = [...bundle.cards].sort((a, b) => (b.relevanceScore ?? 0) - (a.relevanceScore ?? 0));

        const mapCard = (c: typeof sorted[0]) => ({
          id: c.id,
          score: c.relevanceScore,
          title: c.title,
          source: c.source,
          thesis: c.thesis,
          topAngle: c.angleOptions?.[0] ?? null,
          topHook: c.hookOptions?.[0] ?? null,
          trendTags: c.trendTags,
          curationStatus: curation[String(c.id)] ?? null,
        });

        const shortlisted = sorted.filter((c) => curation[String(c.id)] === "shortlisted").map(mapCard);
        const approved = sorted.filter((c) => curation[String(c.id)] === "approved").map(mapCard);
        const skipped = sorted.filter((c) => curation[String(c.id)] === "skipped").map(mapCard);
        const uncurated = sorted.filter((c) => !curation[String(c.id)]).map(mapCard);

        const briefing = {
          workspace: workspace.name,
          workspaceId: workspace.id,
          generatedAt: bundle.generatedAt,
          totalCards: bundle.cards.length,
          profile: ctx ? { role: ctx.role, industry: ctx.industry, topics: ctx.topics } : null,
          curationSummary: {
            shortlisted: shortlisted.length,
            approved: approved.length,
            skipped: skipped.length,
            uncurated: uncurated.length,
          },
          shortlisted,
          approved,
          skipped,
          uncurated,
        };
        return {
          content: [{ type: "text" as const, text: JSON.stringify(briefing, null, 2) }],
          structuredContent: briefing as unknown as Record<string, unknown>,
        };
      }

      case "quillby_save_cards": {
        const activeStorage = await resolveStorage();
        const { cards: rawCards } = args as { cards: unknown[] };
        const cards = rawCards.map((c) => CardInputSchema.parse(c));
        if (cards.length === 0) {
          return { content: [{ type: "text" as const, text: "No cards provided." }], structuredContent: { saved: 0 } };
        }
        const outputDir = await activeStorage.saveHarvestOutput(cards, new Set());
        return { content: [{ type: "text" as const, text: `Saved ${cards.length} card(s) to ${outputDir}.` }], structuredContent: { saved: cards.length, outputDir } };
      }

      case "quillby_list_cards": {
        const activeStorage = await resolveStorage();
        if (!await activeStorage.latestHarvestExists()) {
          return { content: [{ type: "text" as const, text: "No harvest found. Fetch articles and save cards first." }], structuredContent: { error: "no_harvest" } };
        }
        const { limit, minScore } = args as { limit?: number; minScore?: number };
        const bundle = await activeStorage.loadLatestHarvest();
        let cards = bundle.cards;
        if (minScore != null) {
          cards = cards.filter((c) => (c.relevanceScore ?? 0) >= minScore);
        }
        if (limit) cards = cards.slice(0, limit);
        const listCardsResult = { generatedAt: bundle.generatedAt, total: bundle.cards.length, showing: cards.length, cards: cards.map((c) => ({ id: c.id, title: c.title, source: c.source, relevanceScore: c.relevanceScore, thesis: c.thesis, trendTags: c.trendTags })) };
        return {
          content: [{ type: "text" as const, text: JSON.stringify(listCardsResult, null, 2) }],
          structuredContent: listCardsResult as unknown as Record<string, unknown>,
        };
      }

      case "quillby_analyze_articles": {
        const { topN: rawTopN } = args as { topN?: number };
        const topN = rawTopN ?? 15;
        if (!await storage.contextExists()) {
          return { content: [{ type: "text" as const, text: "No context saved for this workspace yet. Set up Quillby first." }], structuredContent: { error: "no_context" } };
        }
        const ctx = (await storage.loadContext())!;
        const sources = await storage.loadSources();
        if (sources.length === 0) {
          return { content: [{ type: "text" as const, text: "No RSS sources configured. Use quillby_discover_feeds first." }], structuredContent: { error: "no_sources" } };
        }
        const samplingAvailable = !!(server.server.getClientCapabilities()?.sampling);
        if (!samplingAvailable) {
          return { content: [{ type: "text" as const, text: "This Quillby feature needs Sampling support from the host client. Open Quillby in a Sampling-capable Claude client to generate the Briefing." }], structuredContent: { error: "sampling_unavailable" } };
        }
        const { articles, seenUrls } = await fetchArticles(sources, await storage.getSeenUrls(), log, true);
        await storage.saveSeenUrls(seenUrls);
        if (articles.length === 0) {
          return { content: [{ type: "text" as const, text: "No new articles found. All items have been seen before." }], structuredContent: { error: "no_new_articles" } };
        }
        log(`Scoring ${articles.length} headlines semantically...`);
        const headlineList = articles
          .map((a, i) => `${i}: ${a.title} — ${a.snippet ?? ""}`)
          .join("\n");
        const scorePrompt = `You are scoring news headlines for a ${ctx.role} in ${
          ctx.industry ?? "their industry"
        }.

User topics: ${ctx.topics.join(", ")}
Audience: ${ctx.audienceDescription ?? "general"}
Goals: ${ctx.contentGoals.join(", ")}
Avoid: ${ctx.excludeTopics?.length ? ctx.excludeTopics.join(", ") : "nothing specified"}

Headlines (index: title — snippet):
${headlineList}

Return ONLY a JSON array of integers — the indices of the top ${topN} most relevant headlines, ordered best first. No explanation.`;
        const scoreRaw = await sample(server, scorePrompt, 400);
        let topIndices: number[] = [];
        if (scoreRaw) {
          try {
            const m = scoreRaw.match(/\[[\s\S]*\]/);
            if (m) {
              const parsed = JSON.parse(m[0]) as unknown[];
              topIndices = parsed
                .filter((x): x is number => typeof x === "number" && x >= 0 && x < articles.length)
                .slice(0, topN);
            }
          } catch { /* fall through to keyword fallback */ }
        }
        if (topIndices.length === 0) {
          topIndices = preScoreArticles(articles, ctx.topics)
            .slice(0, topN)
            .map((a) => articles.findIndex((s) => s.link === a.link))
            .filter((i) => i >= 0);
        }
        const topArticles = topIndices.map((i) => articles[i]).filter(Boolean);
        const enriched: { title: string; url: string; snippet: string; content: string | null }[] = [];
        for (const article of topArticles) {
          const content = await enrichArticle(article.link, article.title ?? "");
          enriched.push({ title: article.title ?? "", url: article.link, snippet: article.snippet ?? "", content });
        }
        const articleBlobs = enriched.map((a, i) =>
          `## Article ${i + 1}: ${a.title}\nURL: ${a.url}\n\n${a.content ?? a.snippet}`
        ).join("\n\n---\n\n");
        const typedMemoryAnalyze = await storage.loadTypedMemory();
        const analysisPrompt = `You are an expert content strategist. Analyze these articles for a ${ctx.role} in ${ctx.industry ?? "their industry"}.

${contextToPromptText(ctx, typedMemoryAnalyze)}

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
        const raw = await sample(server, analysisPrompt, 2000);
        if (!raw) {
          return { content: [{ type: "text" as const, text: "Sampling returned no result. Try again or use quillby_fetch_articles + quillby_save_cards manually." }], structuredContent: { error: "sampling_failed" } };
        }
        let cards: unknown[];
        try {
          const match = raw.match(/\[.*\]/s);
          if (!match) throw new Error("No JSON array in response");
          cards = JSON.parse(match[0]) as unknown[];
        } catch {
          return { content: [{ type: "text" as const, text: `Sampling returned malformed JSON. Raw response:\n${raw}` }], structuredContent: { error: "malformed_json", raw } };
        }
        const parsed = cards.map((c) => CardInputSchema.parse(c));
        const outputDir = await storage.saveHarvestOutput(parsed, seenUrls);
        const analyzeResult = { analyzed: parsed.length, outputDir, cards: parsed.map((c) => ({ title: c.title, relevanceScore: c.relevanceScore, thesis: c.thesis })) };
        return {
          content: [{ type: "text" as const, text: JSON.stringify(analyzeResult, null, 2) }],
          structuredContent: analyzeResult as unknown as Record<string, unknown>,
        };
      }

      case "quillby_daily_brief": {
        const { topN: rawTopN } = args as { topN?: number };
        const topN = rawTopN ?? 10;
        if (!await storage.contextExists()) {
          return { content: [{ type: "text" as const, text: "No context saved for this workspace yet. Set up Quillby first." }], structuredContent: { error: "no_context" } };
        }
        const ctx = (await storage.loadContext())!;
        const sources = await storage.loadSources();
        if (sources.length === 0) {
          return { content: [{ type: "text" as const, text: "No RSS sources configured. Use quillby_discover_feeds first." }], structuredContent: { error: "no_sources" } };
        }
        const samplingAvailable = !!(server.server.getClientCapabilities()?.sampling);
        if (!samplingAvailable) {
          return { content: [{ type: "text" as const, text: "quillby_daily_brief requires Sampling support from the host client. Use quillby_fetch_articles + quillby_analyze_articles in a Sampling-capable client." }], structuredContent: { error: "sampling_unavailable" } };
        }

        // Pass 1: headlines only — fast, no content fetching
        log(`Daily brief: fetching headlines from ${sources.length} feeds...`);
        const { articles: slimArticles, seenUrls } = await fetchArticles(sources, await storage.getSeenUrls(), log, true);
        await storage.saveSeenUrls(seenUrls);
        if (slimArticles.length === 0) {
          return { content: [{ type: "text" as const, text: "No new articles found. All items have been seen before." }], structuredContent: { error: "no_new_articles" } };
        }

        // Pass 1b: Sampling-based semantic scoring (not keyword matching)
        log(`Scoring ${slimArticles.length} headlines semantically via Sampling...`);
        const headlineList = slimArticles
          .map((a, i) => `${i}: ${a.title} — ${a.snippet ?? ""}`)
          .join("\n");
        const scorePrompt = `You are scoring news headlines for a ${ctx.role} in ${
          ctx.industry ?? "their industry"
        }.

User topics: ${ctx.topics.join(", ")}
Audience: ${ctx.audienceDescription ?? "general"}
Goals: ${ctx.contentGoals.join(", ")}
Avoid: ${ctx.excludeTopics?.length ? ctx.excludeTopics.join(", ") : "nothing specified"}

Headlines (index: title — snippet):
${headlineList}

Return ONLY a JSON array of integers — the indices of the top ${topN} most relevant headlines, ordered best first. No explanation.`;

        const scoreRaw = await sample(server, scorePrompt, 400);
        let topIndices: number[] = [];
        if (scoreRaw) {
          try {
            const match = scoreRaw.match(/\[[\s\S]*\]/);
            if (match) {
              const parsed = JSON.parse(match[0]) as unknown[];
              topIndices = parsed
                .filter((x): x is number => typeof x === "number" && x >= 0 && x < slimArticles.length)
                .slice(0, topN);
            }
          } catch {
            // fall back to keyword pre-scoring
          }
        }
        if (topIndices.length === 0) {
          const keywordScored = preScoreArticles(slimArticles, ctx.topics);
          topIndices = keywordScored
            .slice(0, topN)
            .map((a) => slimArticles.findIndex((s) => s.link === a.link))
            .filter((i) => i >= 0);
        }

        const topSlim = topIndices.map((i) => slimArticles[i]).filter(Boolean);

        // Pass 2: deep-read only the selected articles
        log(`Deep-reading ${topSlim.length} selected articles...`);
        const enriched: { title: string; source: string; link: string; snippet: string; content: string | null }[] = [];
        for (const article of topSlim) {
          const content = await enrichArticle(article.link, article.title ?? "");
          enriched.push({
            title: article.title ?? "",
            source: article.source ?? article.link,
            link: article.link,
            snippet: article.snippet ?? "",
            content,
          });
        }

        // Pass 3: Sampling generates full cards in one call
        log("Generating content cards via Sampling...");
        const typedMemory3 = await storage.loadTypedMemory();
        const voiceBlock3 = typedMemory3.voiceExamples.length
          ? `\n\nVoice examples — match this style, amplify the strongest quirks:\n${typedMemory3.voiceExamples.map((e, i) => `[${i + 1}]\n${e}`).join("\n\n")}`
          : `\n\nVoice: ${ctx.voice ?? "direct and authentic"}`;
        const articleBlobs = enriched
          .map((a, i) => `## Article ${i + 1}: ${a.title}\nURL: ${a.link}\n\n${a.content ?? a.snippet}`)
          .join("\n\n---\n\n");
        const cardPrompt = `You are a content strategist. Analyze these articles for a ${ctx.role} in ${
          ctx.industry ?? "their industry"
        }.

${contextToPromptText(ctx, typedMemory3)}${voiceBlock3}

${articleBlobs}

For each article produce a JSON object with these exact fields:
- title (string)
- source (string — domain of URL)
- link (string — article URL exactly as provided above)
- thesis (string — one sharp sentence: the single most important takeaway)
- relevanceScore (number 0-10)
- relevanceReason (string — one sentence why this is useful for the user)
- keyInsights (array of 2-3 specific facts or data points from the article)
- angleOptions (array of 3 distinct post angles matching the user voice and platforms)
- hookOptions (array of 3 opening lines — specific, no filler openers, no rhetorical questions that give away the answer)
- trendTags (array of 3-5 short tags)
- transposabilityHint (string — how to make this universal beyond just the news hook)

Return ONLY a valid JSON array of these objects, no prose.`;

        const cardRaw = await sample(server, cardPrompt, 4000);
        if (!cardRaw) {
          return { content: [{ type: "text" as const, text: "Sampling returned no result for card generation. Try again." }], structuredContent: { error: "sampling_failed" } };
        }
        let rawBriefCards: unknown[];
        try {
          const match = cardRaw.match(/\[[\s\S]*\]/);
          if (!match) throw new Error("No JSON array in response");
          rawBriefCards = JSON.parse(match[0]) as unknown[];
        } catch {
          return { content: [{ type: "text" as const, text: `Card generation returned malformed JSON.\nRaw:\n${cardRaw}` }], structuredContent: { error: "malformed_json", raw: cardRaw } };
        }

        const briefCards = rawBriefCards.map((c) => CardInputSchema.parse(c));
        await storage.saveHarvestOutput(briefCards, seenUrls);
        const savedBundle = await storage.loadLatestHarvest();
        const briefResult = {
          date: new Date().toISOString().split("T")[0],
          feedsChecked: sources.length,
          headlinesSeen: slimArticles.length,
          deepRead: enriched.length,
          cardsGenerated: savedBundle.cards.length,
          brief: savedBundle.cards
            .sort((a, b) => (b.relevanceScore ?? 0) - (a.relevanceScore ?? 0))
            .map((c) => ({
              id: c.id,
              score: c.relevanceScore,
              title: c.title,
              thesis: c.thesis,
              topAngle: c.angleOptions?.[0] ?? null,
              topHook: c.hookOptions?.[0] ?? null,
              trendTags: c.trendTags,
            })),
        };
        return {
          content: [{ type: "text" as const, text: JSON.stringify(briefResult, null, 2) }],
          structuredContent: briefResult as unknown as Record<string, unknown>,
        };
      }

      case "quillby_get_card": {
        const activeStorage = await resolveStorage();
        if (!await activeStorage.latestHarvestExists()) {
          return { content: [{ type: "text" as const, text: "No harvest found." }], structuredContent: { error: "no_harvest" } };
        }
        const { cardId } = args as { cardId: number };
        const bundle = await activeStorage.loadLatestHarvest();
        const card = bundle.cards.find((c) => c.id === cardId);
        if (!card) {
          return { content: [{ type: "text" as const, text: `Card #${cardId} not found. Available: ${bundle.cards.map((c) => c.id).join(", ")}.` }], structuredContent: { error: "not_found", cardId } };
        }
        return { content: [{ type: "text" as const, text: JSON.stringify(card, null, 2) }], structuredContent: card as unknown as Record<string, unknown> };
      }

      case "quillby_save_draft": {
        const activeStorage = await resolveStorage();
        const { content, platform, cardId, addToVoiceExamples } = args as { content: string; platform: string; cardId?: number; addToVoiceExamples?: boolean };
        const filePath = await activeStorage.saveDraft(content, platform, cardId);
        if (addToVoiceExamples) await activeStorage.appendTypedMemory("voiceExamples", [content], 10);
        const savedMsg = addToVoiceExamples
          ? `Draft saved to ${filePath}. Added to voice memory.`
          : `Draft saved to ${filePath}.`;
        return { content: [{ type: "text" as const, text: savedMsg }], structuredContent: { saved: true, platform, filePath, voiceExampleAdded: addToVoiceExamples ?? false } };
      }

      case "quillby_list_drafts": {
        const activeStorage = await resolveStorage();
        const drafts = await activeStorage.listDrafts();
        const listDraftsResult = { count: drafts.length, drafts };
        return {
          content: [{ type: "text" as const, text: drafts.length ? JSON.stringify(listDraftsResult, null, 2) : "No saved drafts for this workspace yet." }],
          structuredContent: listDraftsResult as unknown as Record<string, unknown>,
        };
      }

      case "quillby_curate_card": {
        const activeStorage = await resolveStorage();
        const { cardId: curateId, action } = args as { cardId: number; action: "shortlist" | "approve" | "skip" | "clear" };
        if (!await activeStorage.latestHarvestExists()) {
          return { content: [{ type: "text" as const, text: "No harvest found. Save cards first." }], structuredContent: { error: "no_harvest" } };
        }
        const curateBundle = await activeStorage.loadLatestHarvest();
        const curateCard = curateBundle.cards.find((c) => c.id === curateId);
        if (!curateCard) {
          return { content: [{ type: "text" as const, text: `Card #${curateId} not found. Available: ${curateBundle.cards.map((c) => c.id).join(", ")}.` }], structuredContent: { error: "not_found", cardId: curateId } };
        }
        const statusMap: Record<"shortlist" | "approve" | "skip", "shortlisted" | "approved" | "skipped"> = {
          shortlist: "shortlisted",
          approve: "approved",
          skip: "skipped",
        };
        const key = String(curateId);
        if (action === "clear") {
          const cleared = { ...(curateBundle.curationState ?? {}) };
          delete cleared[key];
          await activeStorage.saveCurationState(cleared as Record<string, "shortlisted" | "approved" | "skipped">);
        } else {
          await activeStorage.saveCurationState({ [key]: statusMap[action] });
        }
        const newStatus = action === "clear" ? "cleared" : statusMap[action];
        return {
          content: [{ type: "text" as const, text: `Card #${curateId} "${curateCard.title}" — status set to ${newStatus}.` }],
          structuredContent: { cardId: curateId, title: curateCard.title, status: newStatus },
        };
      }

      case "quillby_generate_post": {
        const { cardId: genCardId, platform: genPlatform, angle } = args as { cardId: number; platform: string; angle?: string };
        if (!await storage.latestHarvestExists()) {
          return { content: [{ type: "text" as const, text: "No Briefing is available for this workspace yet. Refresh Quillby first." }], structuredContent: { error: "no_harvest" } };
        }
        if (!await storage.contextExists()) {
          return { content: [{ type: "text" as const, text: "No context saved for this workspace yet. Set up Quillby first." }], structuredContent: { error: "no_context" } };
        }
        const genSamplingAvailable = !!(server.server.getClientCapabilities()?.sampling);
        if (!genSamplingAvailable) {
          return { content: [{ type: "text" as const, text: "Sampling not available. Write the post yourself and use quillby_save_draft to persist it." }], structuredContent: { error: "sampling_unavailable" } };
        }
        const genBundle = await storage.loadLatestHarvest();
        const genCard = genBundle.cards.find((c) => c.id === genCardId);
        if (!genCard) {
          return { content: [{ type: "text" as const, text: `Card #${genCardId} not found. Available: ${genBundle.cards.map((c) => c.id).join(", ")}.` }], structuredContent: { error: "not_found", cardId: genCardId } };
        }
        const genCtx = (await storage.loadContext())!;
        const typedMemoryGen = await storage.loadTypedMemory();
        const guide = PLATFORM_GUIDES[genPlatform];
        if (!guide) {
          return { content: [{ type: "text" as const, text: `Unknown platform: "${genPlatform}". Available: ${Object.keys(PLATFORM_GUIDES).join(", ")}.` }], structuredContent: { error: "unknown_platform", platform: genPlatform } };
        }
        const chosenAngle = angle ?? genCard.angleOptions?.[0] ?? genCard.thesis;
        const genVoiceBlock = typedMemoryGen.voiceExamples.length
          ? `Voice examples — read these carefully. Match the register, rhythm, and vocabulary exactly. Oversteer on the strongest quirks:\n${typedMemoryGen.voiceExamples.map((e, i) => `[${i + 1}]\n${e}`).join("\n\n")}`
          : `Voice description: ${genCtx.voice ?? "direct and authentic"}`;
        const generatePrompt = `You are writing a ${genPlatform} post for ${
          genCtx.name ?? "a content creator"
        } — a ${genCtx.role} in ${genCtx.industry ?? "their industry"}.

## User profile
${contextToPromptText(genCtx, typedMemoryGen)
  .split("\n")
  .map((line) => `- ${line}`)
  .join("\n")}

## ${genVoiceBlock}

## Source card
Title: ${genCard.title}
Thesis: ${genCard.thesis}
Angle to use: ${chosenAngle}
Key insights: ${genCard.keyInsights?.join(" | ") ?? ""}
Trend tags: ${genCard.trendTags?.join(", ") ?? ""}
Transposability hint: ${genCard.transposabilityHint ?? ""}
Hook options (pick the best or write a stronger one): ${genCard.hookOptions?.join(" | ") ?? ""}

## Platform guide
${guide}

## Absolute rules — any violation produces an unusable draft
- NEVER use: "It's not X, it's Y" contrasts, em-dash clusters (1 max per post), bullet lists masquerading as prose
- NEVER use these words: "game-changer", "transformative", "innovative", "powerful", "exciting", "impactful", "leverage", "unlock", "dive into"
- NEVER use filler openers: "In today's world", "In an era of", "Let's talk about", "Here's the thing:", "The truth is:"
- NEVER use rhetorical question openers that give away the answer
- NEVER use motivational closings: "Remember: X matters", "Don't forget to X"
- NEVER smooth out the rough edges — the rough edges are the voice
- Write the post only. No intro sentence, no commentary, no "Here is the post:".`;
        log(`Generating ${genPlatform} post for card #${genCardId}...`);
        const draft = await sample(server, generatePrompt, 2000);
        if (!draft) {
          return { content: [{ type: "text" as const, text: "Sampling returned no result. Try again." }], structuredContent: { error: "sampling_failed" } };
        }
        const draftPath = await storage.saveDraft(draft.trim(), genPlatform, genCardId);
        const generateResult = { platform: genPlatform, cardId: genCardId, angle: chosenAngle, savedTo: draftPath, draft: draft.trim() };
        return {
          content: [{ type: "text" as const, text: JSON.stringify(generateResult, null, 2) }],
          structuredContent: generateResult,
        };
      }

      case "quillby_remember": {
        const activeStorage = await resolveStorage();
        const { entries, memoryType = "voice_examples" } = args as {
          entries: string[];
          memoryType?: MemoryTypeInput;
        };
        const resolvedType = MEMORY_TYPES[memoryType];
        await activeStorage.appendTypedMemory(
          resolvedType,
          entries,
          resolvedType === "voiceExamples" ? 10 : undefined
        );
        const remWs = await activeStorage.getCurrentWorkspace();
        return {
          content: [{ type: "text" as const, text: `Added ${entries.length} item(s) to ${memoryType} in workspace "${remWs.name}".` }],
          structuredContent: { added: entries.length, memoryType, workspaceId: remWs.id },
        };
      }

      case "quillby_get_memory": {
        const activeStorage = await resolveStorage();
        const { memoryType } = args as { memoryType?: MemoryTypeInput };
        const [typedMemoryGet, getMemWs] = await Promise.all([activeStorage.loadTypedMemory(), activeStorage.getCurrentWorkspace()]);
        if (!memoryType) {
          return {
            content: [{ type: "text" as const, text: JSON.stringify({ workspace: getMemWs, memory: typedMemoryGet }, null, 2) }],
            structuredContent: { workspace: getMemWs, memory: typedMemoryGet },
          };
        }
        const resolvedType = MEMORY_TYPES[memoryType];
        return {
          content: [{ type: "text" as const, text: JSON.stringify({ workspace: getMemWs, memoryType, entries: typedMemoryGet[resolvedType] }, null, 2) }],
          structuredContent: { workspace: getMemWs, memoryType, entries: typedMemoryGet[resolvedType] },
        };
      }

      default:
        return { content: [{ type: "text" as const, text: `Unknown tool: ${name}` }], isError: true, structuredContent: { error: "unknown_tool", toolName: name } };
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { content: [{ type: "text" as const, text: `Error: ${message}` }], isError: true, structuredContent: { error: message } };
  }
}

async function readResource(uri: string, storage: WorkspaceStorage) {
  switch (uri) {
    case "quillby://workspace/current": {
      const text = JSON.stringify(await storage.getCurrentWorkspace(), null, 2);
      return { contents: [{ uri, mimeType: "application/json", text }] };
    }
    case "quillby://context": {
      const text = await storage.contextExists()
        ? JSON.stringify(await storage.loadContext(), null, 2)
        : JSON.stringify({ error: "No context saved for this workspace yet. Set up Quillby first." });
      return { contents: [{ uri, mimeType: "application/json", text }] };
    }
    case "quillby://memory": {
      const text = JSON.stringify(await storage.loadTypedMemory(), null, 2);
      return { contents: [{ uri, mimeType: "application/json", text }] };
    }
    case "quillby://harvest/latest": {
      const text = await storage.latestHarvestExists()
        ? JSON.stringify(await storage.loadLatestHarvest(), null, 2)
        : JSON.stringify({ error: "No Briefing has been generated for this workspace yet." });
      return { contents: [{ uri, mimeType: "application/json", text }] };
    }
    case "quillby://feeds": {
      const sources = await storage.loadSources();
      return { contents: [{ uri, mimeType: "text/plain", text: sources.length ? sources.join("\n") : "# No feeds configured." }] };
    }
    default:
      throw new Error(`Unknown resource: ${uri}`);
  }
}

async function getPrompt(name: string, storage: WorkspaceStorage, args?: Record<string, string>) {
  void args;
  switch (name) {
    case "quillby_onboarding": {
      const exists = await storage.contextExists();
      const existing = exists ? await storage.loadContext() : null;
      const typedMemory = await storage.loadTypedMemory();
      const currentWorkspace = await storage.getCurrentWorkspace();
      return {
        description: "Quillby onboarding",
        messages: [
          {
            role: "user" as const,
            content: {
              type: "text" as const,
              text: exists
                ? `I have a saved profile in workspace "${currentWorkspace.name}":\n\n${contextToPromptText(existing!, typedMemory)}\n\nUpdate it?`
                : "Set up Quillby for my content workflow.",
            },
          },
          {
            role: "assistant" as const,
            content: {
              type: "text" as const,
              text: exists
                ? "I can see your profile. Tell me what to change and I will call quillby_set_context."
                : ONBOARDING_PROMPT,
            },
          },
        ],
      };
    }

    case "quillby_session_start": {
      const workspace = await storage.getCurrentWorkspace();
      const hasContext = await storage.contextExists();
      const hasFeeds = (await storage.loadSources()).length > 0;
      const hasBriefing = await storage.latestHarvestExists();
      const sessionText = `## Quillby Session Start

Workspace: ${workspace.name} (${workspace.id})

Open Quillby as a Claude-native editorial workspace, not as a menu of tools.

Behavior contract:
- Treat the user's first Quillby-related message as intent to open Quillby.
- Keep tool names invisible unless the user is explicitly debugging.
- Prefer native Claude Artifacts over long chat replies.
- Reuse or update an existing Quillby artifact in the current conversation when it already matches the active workspace.
- For requests like "Open Quillby", "Open my daily brief", or "Show me my briefing", prefer quillby_open_briefing over quillby_daily_brief.
- Do not improvise a manual tool-by-tool fallback in chat.
- Do not narrate tool execution with phrases like "Let me...", "I'll fetch...", or "I'll work around this manually."

Session flow:
1. Inspect the active workspace state.
2. If no profile exists yet, guide setup conversationally, save it, and make sure sources are configured.
3. If a profile and saved brief already exist, call quillby_open_briefing immediately so the user gets a stable Briefing UI without waiting.
4. Refresh the Briefing only when it is stale, missing, or the user explicitly asks for a fresh run.
5. If there is no saved Briefing and Sampling is unavailable, explain that Quillby cannot generate a fresh Briefing in this client and stop. Do not simulate the pipeline manually.
6. Let the user move naturally from Briefing to Story, Draft, or Voice System through plain-language requests.

Current workspace state:
- Profile saved: ${hasContext ? "yes" : "no"}
- Feeds configured: ${hasFeeds ? "yes" : "no"}
- Briefing available: ${hasBriefing ? "yes" : "no"}

User-facing expectations:
- The user should be able to say things like "Open Quillby", "What's worth writing about today?", "Draft the second one for LinkedIn", or "Show me my Voice System".
- Do not answer with a command list.
- Do not ask the user to memorize tool names.`;

      return {
        description: "Quillby session start",
        messages: [
          { role: "user" as const, content: { type: "text" as const, text: "Open Quillby for this workspace." } },
          { role: "assistant" as const, content: { type: "text" as const, text: sessionText } },
        ],
      };
    }

    case "quillby_briefing": {
      const workspace = await storage.getCurrentWorkspace();
      const briefingText = `## Quillby Briefing Artifact

Use the Briefing as Quillby's default opening artifact.

Artifact rules:
- Create or update a native Claude Artifact called "Briefing".
- If a matching Briefing artifact for workspace "${workspace.name}" is already active in this conversation, update it instead of creating a duplicate.
- Keep the interaction natural. The artifact is the surface; chat is the control layer.

What the Briefing should show:
- active workspace
- editorial focus and audience
- source freshness
- strongest current opportunities
- whether drafts or memory need attention
- clear next actions the user can ask for in plain language

How to drive it:
- Use Quillby's saved workspace state and latest harvest data.
- For "open" intents, use quillby_open_briefing first so the UI appears immediately from cached local state.
- Present top opportunities as editorial decisions, not raw database rows.
- When the user asks to go deeper, transition into a Story artifact or produce a Draft directly.
- If Briefing generation is not possible in the current host, explain the capability gap plainly and stop instead of listing workaround steps or simulating the pipeline manually.

Tone rules:
- No emojis.
- No progress narration.
- No operator language such as "Let me", "Now I'll", or "I'm going to fetch".
- Speak as Quillby opening an editorial surface, not as an assistant running commands.`;

      return {
        description: "Quillby Briefing artifact",
        messages: [
          { role: "user" as const, content: { type: "text" as const, text: "Show me the Quillby Briefing." } },
          { role: "assistant" as const, content: { type: "text" as const, text: briefingText } },
        ],
      };
    }

    case "quillby_story": {
      const storyText = `## Quillby Story Artifact

Open a Story artifact when the user chooses one opportunity from the Briefing or asks for detail on a specific idea.

Artifact rules:
- Create or update a native Claude Artifact called "Story".
- Reuse the active Story artifact when the user is iterating on the same item.
- Keep tool details hidden; the user should feel like they are exploring one editorial opportunity, not querying a database.

What the Story artifact should show:
- source and why it matters now
- thesis
- relevance to the workspace
- best angles and hooks
- what would make a strong draft

How to move forward:
- If the user asks to write, transition directly into a Draft.
- If the user asks why it ranked highly, explain the editorial reasoning in natural language.
- If the user asks to save a learning, update the Voice System memory behind the scenes.`;

      return {
        description: "Quillby Story artifact",
        messages: [
          { role: "user" as const, content: { type: "text" as const, text: "Open the strongest Quillby story." } },
          { role: "assistant" as const, content: { type: "text" as const, text: storyText } },
        ],
      };
    }

    case "quillby_voice_system": {
      const voiceSystemText = `## Quillby Voice System Artifact

Open the Voice System artifact when the user asks how Quillby writes, what it has learned, or wants to adjust voice memory.

Artifact rules:
- Create or update a native Claude Artifact called "Voice System".
- Reuse the active Voice System artifact when the user is editing rules or reviewing examples.
- Keep the artifact editorial and practical, not diagnostic.

What the Voice System should show:
- workspace role and audience
- current voice summary
- approved voice examples
- style rules
- banned phrasing
- audience insights
- campaign context when present

How to use it:
- When the user says "remember this", save it in the right memory bucket behind the scenes.
- When the user asks why a draft feels wrong, compare the draft against the Voice System and explain the mismatch clearly.
- When the user improves a rule, update the artifact so it stays current in the conversation.`;

      return {
        description: "Quillby Voice System artifact",
        messages: [
          { role: "user" as const, content: { type: "text" as const, text: "Show me the Quillby Voice System." } },
          { role: "assistant" as const, content: { type: "text" as const, text: voiceSystemText } },
        ],
      };
    }

    case "quillby_projects_playbook": {
      const playbook = `## Quillby + Claude Projects + Artifacts

1. Create one Quillby workspace per Claude Project, client, brand, or campaign.
2. Keep structured profile, feeds, typed memory, harvests, and drafts in Quillby.
3. Keep long background documents inside Claude Project knowledge.
4. Let Claude render Quillby's working surfaces as native Artifacts:
   - Briefing for the daily opening view
   - Story for one ranked opportunity
   - Voice System for editorial memory and rules
5. Use memory buckets deliberately:
   - voice_examples for approved writing samples
   - style_rules for positive editorial constraints
   - do_not_say for banned phrasing
   - audience_insights for what readers care about
   - campaign_context for temporary initiative-specific context
   - source_preferences for preferred publications or communities`;
      return {
        description: "Quillby Projects playbook",
        messages: [
          { role: "user" as const, content: { type: "text" as const, text: "How should I use Quillby with Claude Projects?" } },
          { role: "assistant" as const, content: { type: "text" as const, text: playbook } },
        ],
      };
    }

    default:
      throw new Error(`Unknown prompt: ${name}`);
  }
}

function registerMcpHandlers(server: McpServer, storage: WorkspaceStorage): void {
  for (const tool of TOOLS) {
    server.registerTool(tool.name, {
      description: tool.description,
      annotations: tool.annotations,
      _meta: (tool as Tool & { _meta?: Record<string, unknown> })._meta,
    }, (args: unknown) => handleToolCall(server, storage, tool.name, (args ?? {}) as Record<string, unknown>));
  }

  for (const resource of RESOURCES) {
    server.registerResource(resource.name, resource.uri, {
      description: resource.description,
      mimeType: resource.mimeType,
    }, async () => readResource(resource.uri, storage));
  }

  for (const prompt of PROMPTS) {
    server.registerPrompt(prompt.name, {
      description: prompt.description,
    }, (args) => getPrompt(prompt.name, storage, args as Record<string, string> | undefined));
  }
}

// ---------------------------------------------------------------------------
// Scheduled autonomous harvest
// ---------------------------------------------------------------------------

async function runScheduledHarvest(): Promise<void> {
  const tag = "[quillby-schedule]";
  if (!await storage.contextExists()) {
    process.stderr.write(`${tag} No profile saved — skipping.\n`);
    return;
  }
  const ctx = (await storage.loadContext())!;
  const sources = await storage.loadSources();
  if (sources.length === 0) {
    process.stderr.write(`${tag} No feeds configured — skipping.\n`);
    return;
  }
  const topN = parseInt(process.env.Quillby_SCHEDULE_TOP_N ?? "15", 10);
  process.stderr.write(`${tag} Fetching articles from ${sources.length} feeds...\n`);
  try {
    const { articles, seenUrls } = await fetchArticles(
      sources,
      await storage.getSeenUrls(),
      (msg) => process.stderr.write(`${tag} ${msg}\n`),
      true,
    );
    await storage.saveSeenUrls(seenUrls);
    if (articles.length === 0) {
      process.stderr.write(`${tag} No new articles.\n`);
      return;
    }
    const top = preScoreArticles(articles, ctx.topics).slice(0, topN);
    const cards = top.map((a) =>
      CardInputSchema.parse({
        title: a.title ?? "Untitled",
        source: (() => { try { return new URL(a.link).hostname; } catch { return a.link; } })(),
        link: a.link,
        thesis: a.snippet ?? a.title ?? "",
        trendTags: [],
      })
    );
    const outputDir = await storage.saveHarvestOutput(cards, seenUrls);
    process.stderr.write(`${tag} Done. ${cards.length} card(s) saved to ${outputDir}.\n`);
  } catch (err) {
    process.stderr.write(`${tag} Error: ${err instanceof Error ? err.message : String(err)}\n`);
  }
}

function scheduleDaily(timeStr: string, fn: () => Promise<void>): void {
  const parts = timeStr.split(":");
  const hour = parseInt(parts[0] ?? "", 10);
  const minute = parseInt(parts[1] ?? "0", 10);
  if (isNaN(hour) || isNaN(minute) || hour < 0 || hour > 23 || minute < 0 || minute > 59) {
    process.stderr.write(`[quillby-schedule] Invalid Quillby_SCHEDULE "${timeStr}" — expected HH:MM. Scheduling disabled.\n`);
    return;
  }
  const msUntilNext = (): number => {
    const now = new Date();
    const next = new Date(now);
    next.setHours(hour, minute, 0, 0);
    if (next.getTime() <= now.getTime()) next.setDate(next.getDate() + 1);
    return next.getTime() - now.getTime();
  };
  const tick = (): void => {
    const delay = msUntilNext();
    process.stderr.write(`[quillby-schedule] Next harvest at ${timeStr} (in ${Math.round(delay / 60000)} min).\n`);
    setTimeout(async () => { await fn(); tick(); }, delay).unref();
  };
  tick();
}

// ---------------------------------------------------------------------------

const TRANSPORT_MODE = process.env.Quillby_TRANSPORT ?? "stdio";

// ---------------------------------------------------------------------------
// Structured logger — used only in HTTP mode so it does not pollute stdio MCP.
// Emits newline-delimited JSON to stderr.
// ---------------------------------------------------------------------------

function slog(level: "info" | "warn" | "error", msg: string, extra?: Record<string, unknown>): void {
  process.stderr.write(JSON.stringify({ ts: new Date().toISOString(), level, msg, ...extra }) + "\n");
}

const HTTP_BODY_LIMIT = 1 * 1024 * 1024; // 1 MiB

if (TRANSPORT_MODE === "http") {
  // Stateful HTTP mode: each client session gets its own transport instance.
  // A single shared Server handles all sessions via per-request transports.
  const PORT = parseInt(process.env.PORT ?? "3000", 10);
  const HOST = process.env.QUILLBY_HTTP_HOST ?? "0.0.0.0";
  const BASE_URL = process.env.QUILLBY_BASE_URL ?? `http://localhost:${PORT}`;

  // Map of sessionId → transport, so we can route GET/DELETE back to the right session.
  const sessions = new Map<string, {
    transport: StreamableHTTPServerTransport;
    server: McpServer;
    userId: string;
  }>();

  const toHeaders = (headers: http.IncomingHttpHeaders) => {
    const result = new Headers();
    for (const [key, value] of Object.entries(headers)) {
      if (Array.isArray(value)) {
        for (const entry of value) {
          result.append(key, entry);
        }
      } else if (value !== undefined) {
        result.set(key, value);
      }
    }
    return result;
  };

  const readJsonBody = async <T>(req: http.IncomingMessage): Promise<T> => {
    const chunks: Buffer[] = [];
    let totalBytes = 0;
    for await (const chunk of req) {
      totalBytes += (chunk as Buffer).length;
      if (totalBytes > HTTP_BODY_LIMIT) {
        throw new Error("Payload too large");
      }
      chunks.push(chunk as Buffer);
    }
    return JSON.parse(Buffer.concat(chunks).toString("utf-8")) as T;
  };

  const resolveAppAuth = async (req: http.IncomingMessage): Promise<{ userId: string; mode: "session" | "apiKey" } | null> => {
    try {
      const session = await auth.api.getSession({
        headers: toHeaders(req.headers),
      });
      if (session?.user?.id) {
        return { userId: session.user.id, mode: "session" };
      }
    } catch {
      // Fall back to API key auth below.
    }

    const authHeader = req.headers.authorization ?? "";
    const bearerMatch = authHeader.match(/^Bearer (.+)$/i);
    if (!bearerMatch) return null;

    const verification = await verifyApiKey(bearerMatch[1]);
    if (!verification.valid) return null;

    return {
      userId: verification.key?.referenceId ?? "unknown",
      mode: "apiKey",
    };
  };

  const mapCurationToAppStatus = (status?: "shortlisted" | "approved" | "skipped"): "pending" | "approved" | "rejected" | "flagged" => {
    switch (status) {
      case "approved":
        return "approved";
      case "shortlisted":
        return "flagged";
      case "skipped":
        return "rejected";
      default:
        return "pending";
    }
  };

  const mapAppStatusToCurationAction = (status: "approved" | "rejected" | "flagged"): "approve" | "skip" | "shortlist" => {
    switch (status) {
      case "approved":
        return "approve";
      case "flagged":
        return "shortlist";
      case "rejected":
      default:
        return "skip";
    }
  };

  interface VerifiedApiKey {
    valid: boolean;
    key?: {
      referenceId?: string | null;
    } | null;
  }

  interface ListedApiKey {
    id: string;
    name?: string | null;
    prefix?: string | null;
    start?: string | null;
    enabled?: boolean | null;
    createdAt?: Date | string | number | null;
    expiresAt?: Date | string | number | null;
    rateLimitMax?: number | null;
    rateLimitTimeWindow?: number | null;
  }

  const verifyApiKey = (key: string): Promise<VerifiedApiKey> =>
    (auth.api as unknown as {
      verifyApiKey(input: { body: { key: string } }): Promise<VerifiedApiKey>;
    }).verifyApiKey({ body: { key } });

  const listApiKeys = (userId: string): Promise<ListedApiKey[]> =>
    (auth.api as unknown as {
      listApiKeys(input: { body: { userId: string } }): Promise<ListedApiKey[]>;
    }).listApiKeys({ body: { userId } });

  const createApiKey = (userId: string, name: string, rateLimitMax: number) =>
    (auth.api as unknown as {
      createApiKey(input: {
        body: {
          userId: string;
          name: string;
          prefix: string;
          rateLimitEnabled: boolean;
          rateLimitTimeWindow: number;
          rateLimitMax: number;
        };
      }): Promise<{ id: string; key: string }>;
    }).createApiKey({
      body: {
        userId,
        name,
        prefix: "qb",
        rateLimitEnabled: true,
        rateLimitTimeWindow: 60_000,
        rateLimitMax,
      },
    });

  const deleteApiKey = (keyId: string): Promise<void> =>
    (auth.api as unknown as {
      deleteApiKey(input: { body: { keyId: string } }): Promise<void>;
    }).deleteApiKey({ body: { keyId } });

  const serializeApiKey = (key: ListedApiKey) => ({
    id: key.id,
    name: key.name ?? "Unnamed key",
    prefix: key.prefix ?? null,
    start: key.start ?? null,
    enabled: key.enabled ?? true,
    createdAt: key.createdAt ? new Date(key.createdAt).toISOString() : undefined,
    expiresAt: key.expiresAt ? new Date(key.expiresAt).toISOString() : null,
    rateLimitMax: key.rateLimitMax ?? null,
    rateLimitTimeWindow: key.rateLimitTimeWindow ?? null,
  });

  const httpServer = http.createServer(async (req, res) => {
    const start = Date.now();
    const url = new URL(req.url ?? "/", BASE_URL);

    const finish = (status: number) =>
      slog("info", "request", { method: req.method, path: url.pathname, status, ms: Date.now() - start });

    // ------------------------------------------------------------------
    // CORS — allow browser-based MCP App to connect from any origin
    // ------------------------------------------------------------------
    const allowedOrigin = process.env.QUILLBY_CORS_ORIGIN ?? "*";
    const requestOrigin = req.headers.origin;
    const corsOrigin = allowedOrigin === "*" && requestOrigin ? requestOrigin : allowedOrigin;
    res.setHeader("Access-Control-Allow-Origin", corsOrigin);
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, Mcp-Session-Id, Last-Event-ID");
    res.setHeader("Access-Control-Expose-Headers", "Mcp-Session-Id");
    res.setHeader("Access-Control-Allow-Credentials", "true");

    if (req.method === "OPTIONS") {
      res.writeHead(204).end();
      return;
    }

    try {
      // ------------------------------------------------------------------
      // Health check — unauthenticated, fast
      // ------------------------------------------------------------------
      if (url.pathname === "/health" && req.method === "GET") {
        const body = JSON.stringify({ status: "ok", version: "1.0.0", uptime: Math.floor(process.uptime()), sessions: sessions.size });
        res.writeHead(200, { "Content-Type": "application/json" }).end(body);
        finish(200);
        return;
      }

      // ------------------------------------------------------------------
      // A2A agent card — unauthenticated, discovery
      // ------------------------------------------------------------------
      if (url.pathname === "/.well-known/agent.json" && req.method === "GET") {
        const agentCard = {
          name: "Quillby",
          description: "Guided Research & Insight Synthesis Tool — RSS content intelligence MCP server. Fetches, scores, and structures articles into content cards for social media posts.",
          url: `${BASE_URL}/mcp`,
          version: "1.0.0",
          capabilities: {
            streaming: true,
            pushNotifications: false,
            stateTransitionHistory: false,
          },
          authentication: {
            schemes: ["Bearer"],
          },
          defaultInputModes: ["application/json"],
          defaultOutputModes: ["application/json"],
          skills: [
            {
              id: "content_harvest",
              name: "Content Harvest",
              description: "Open Quillby's daily editorial Briefing from the active workspace and ranked source coverage.",
              tags: ["rss", "content", "feeds", "articles"],
              examples: ["Open Quillby", "What's worth writing about today?"],
            },
            {
              id: "post_generation",
              name: "Post Generation",
              description: "Generate platform-specific social media posts from content cards using the user voice profile.",
              tags: ["linkedin", "twitter", "blog", "newsletter"],
              examples: ["Generate a LinkedIn post from card #3"],
            },
            {
              id: "feed_management",
              name: "Feed Management",
              description: "Discover, add, and list RSS feed sources.",
              tags: ["rss", "feeds", "discovery"],
              examples: ["Discover feeds for AI topics", "Add a new RSS feed"],
            },
          ],
        };
        res.writeHead(200, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }).end(JSON.stringify(agentCard, null, 2));
        finish(200);
        return;
      }

      // ------------------------------------------------------------------
      // better-auth route handler — sign-up, sign-in, key management
      // Mounted before /mcp so auth requests never hit the MCP auth gate.
      // ------------------------------------------------------------------
      if (url.pathname.startsWith("/api/auth")) {
        await toNodeHandler(auth)(req, res);
        finish(res.statusCode ?? 200);
        return;
      }

      if (url.pathname.startsWith("/api/app")) {
        const authState = await resolveAppAuth(req);
        if (!authState) {
          res.writeHead(401).end(JSON.stringify({ error: "Unauthorized" }));
          finish(401);
          return;
        }

        const storage = getHostedUserStorage(authState.userId);
        const workspaceId = url.searchParams.get("workspaceId") ?? undefined;
        const activeStorage = workspaceId ? await storage.withWorkspace(workspaceId) : storage;

        if (url.pathname === "/api/app/workspaces" && req.method === "GET") {
          const currentWorkspaceId = await storage.getCurrentWorkspaceId();
          const workspaces = (await storage.listWorkspaces()).map((workspace) => ({
            id: workspace.id,
            name: workspace.name,
            createdAt: workspace.createdAt,
            isActive: workspace.id === currentWorkspaceId,
          }));
          res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({ currentWorkspaceId, workspaces }));
          finish(200);
          return;
        }

        if (url.pathname === "/api/app/workspaces/select" && req.method === "POST") {
          const body = await readJsonBody<{ workspaceId?: string }>(req);
          if (!body.workspaceId) {
            res.writeHead(400).end(JSON.stringify({ error: "workspaceId is required" }));
            finish(400);
            return;
          }
          const workspace = await storage.setCurrentWorkspace(body.workspaceId);
          res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify(workspace));
          finish(200);
          return;
        }

        if (url.pathname === "/api/app/cards" && req.method === "GET") {
          if (!await activeStorage.latestHarvestExists()) {
            res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({ cards: [] }));
            finish(200);
            return;
          }

          const requestedStatus = url.searchParams.get("status");
          const bundle = await activeStorage.loadLatestHarvest();
          const curation = bundle.curationState ?? {};
          const currentWorkspace = workspaceId ? null : await activeStorage.getCurrentWorkspace();
          const cards = bundle.cards
            .map((card) => ({
              id: String(card.id),
              title: card.title,
              source: card.source,
              url: card.link,
              score: card.relevanceScore,
              summary: card.thesis,
              curationStatus: mapCurationToAppStatus(curation[String(card.id)]),
              createdAt: bundle.generatedAt,
              workspaceId: workspaceId ?? currentWorkspace?.id,
            }))
            .filter((card) => !requestedStatus || requestedStatus === "all" || card.curationStatus === requestedStatus)
            .sort((a, b) => (b.score ?? 0) - (a.score ?? 0));

          res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({ cards }));
          finish(200);
          return;
        }

        if (url.pathname === "/api/app/cards/curate" && req.method === "POST") {
          const body = await readJsonBody<{ cardId?: string; status?: "approved" | "rejected" | "flagged"; workspaceId?: string }>(req);
          if (!body.cardId || !body.status) {
            res.writeHead(400).end(JSON.stringify({ error: "cardId and status are required" }));
            finish(400);
            return;
          }
          const targetStorage = body.workspaceId ? await storage.withWorkspace(body.workspaceId) : storage;
          if (!await targetStorage.latestHarvestExists()) {
            res.writeHead(404).end(JSON.stringify({ error: "No harvest found for this workspace" }));
            finish(404);
            return;
          }
          const bundle = await targetStorage.loadLatestHarvest();
          const cardId = Number(body.cardId);
          const card = bundle.cards.find((entry) => entry.id === cardId);
          if (!card) {
            res.writeHead(404).end(JSON.stringify({ error: "Card not found" }));
            finish(404);
            return;
          }

          const action = mapAppStatusToCurationAction(body.status);
          const statusMap: Record<"shortlist" | "approve" | "skip", "shortlisted" | "approved" | "skipped"> = {
            shortlist: "shortlisted",
            approve: "approved",
            skip: "skipped",
          };
          await targetStorage.saveCurationState({ [String(cardId)]: statusMap[action] });
          res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({
            cardId: String(cardId),
            status: body.status,
            title: card.title,
          }));
          finish(200);
          return;
        }

        if (url.pathname === "/api/app/drafts" && req.method === "GET") {
          const drafts = await activeStorage.listDrafts();
          res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({ drafts }));
          finish(200);
          return;
        }

        if (url.pathname === "/api/app/plan" && req.method === "GET") {
          const plan = await storage.getPlan();
          const mode = getDeploymentMode();
          const limits = getPlanLimits(plan);
          const billingPortalUrl = getBillingPortalUrl();
          res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({
            plan,
            mode,
            planEnforcementEnabled: isPlanEnforcementEnabled(),
            limits,
            billingPortalUrl,
          }));
          finish(200);
          return;
        }

        if (url.pathname === "/api/app/api-keys" && req.method === "GET") {
          const keys = await listApiKeys(authState.userId);
          res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({
            keys: keys.map(serializeApiKey),
          }));
          finish(200);
          return;
        }

        if (url.pathname === "/api/app/api-keys" && req.method === "POST") {
          const body = await readJsonBody<{ name?: string; rateLimitMax?: number }>(req);
          const keyName = body.name?.trim();
          if (!keyName) {
            res.writeHead(400).end(JSON.stringify({ error: "name is required" }));
            finish(400);
            return;
          }

          const rateLimitMax = typeof body.rateLimitMax === "number" && Number.isFinite(body.rateLimitMax)
            ? Math.max(1, Math.floor(body.rateLimitMax))
            : parseInt(process.env.QUILLBY_RATE_LIMIT ?? "60", 10);

          const result = await createApiKey(authState.userId, keyName, rateLimitMax);
          const keys = await listApiKeys(authState.userId);
          const meta = keys.find((entry) => entry.id === result.id);

          res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({
            key: result.key,
            meta: serializeApiKey(meta ?? { id: result.id, name: keyName, rateLimitMax, rateLimitTimeWindow: 60_000 }),
          }));
          finish(200);
          return;
        }

        if (url.pathname === "/api/app/api-keys" && req.method === "DELETE") {
          const body = await readJsonBody<{ keyId?: string }>(req);
          if (!body.keyId) {
            res.writeHead(400).end(JSON.stringify({ error: "keyId is required" }));
            finish(400);
            return;
          }
          await deleteApiKey(body.keyId);
          res.writeHead(204).end();
          finish(204);
          return;
        }

        res.writeHead(404).end(JSON.stringify({ error: "Not found" }));
        finish(404);
        return;
      }

      // ------------------------------------------------------------------
      // Cloud billing lifecycle endpoints (upgrade/downgrade/manage)
      // Requires Bearer API key; disabled outside cloud mode.
      // ------------------------------------------------------------------
      if (url.pathname.startsWith("/api/billing/") && req.method === "GET") {
        if (!isCloudMode()) {
          res.writeHead(404).end("Not found");
          finish(404);
          return;
        }
        const authHeader = req.headers.authorization ?? "";
        const bearerMatch = authHeader.match(/^Bearer (.+)$/i);
        if (!bearerMatch) {
          res.writeHead(401, { "WWW-Authenticate": 'Bearer realm="quillby-mcp"' }).end("Unauthorized");
          finish(401);
          return;
        }
        const verification = await verifyApiKey(bearerMatch[1]);
        if (!verification.valid) {
          res.writeHead(401, { "WWW-Authenticate": 'Bearer realm="quillby-mcp"' }).end("Unauthorized");
          finish(401);
          return;
        }
        const userId = verification.key?.referenceId ?? "unknown";
        const userStorage = getHostedUserStorage(userId);
        const plan = await userStorage.getPlan();

        const action = url.pathname.endsWith("/upgrade")
          ? "upgrade"
          : url.pathname.endsWith("/downgrade")
            ? "downgrade"
            : url.pathname.endsWith("/portal")
              ? "manage"
              : null;
        if (!action) {
          res.writeHead(404).end("Not found");
          finish(404);
          return;
        }

        const target = getBillingActionUrl(action, plan, userId);
        if (!target) {
          res.writeHead(501).end("Billing action not configured");
          finish(501);
          return;
        }
        res.writeHead(302, { Location: target }).end();
        finish(302);
        return;
      }

      // ------------------------------------------------------------------
      // Stripe webhook (cloud only) — syncs subscription status to plan.
      // ------------------------------------------------------------------
      if (url.pathname === "/api/billing/stripe/webhook" && req.method === "POST") {
        if (!isCloudMode()) {
          res.writeHead(404).end("Not found");
          finish(404);
          return;
        }
        const signature = req.headers["stripe-signature"];
        if (typeof signature !== "string") {
          res.writeHead(400).end("Missing stripe-signature header");
          finish(400);
          return;
        }

        const chunks: Buffer[] = [];
        let totalBytes = 0;
        for await (const chunk of req) {
          totalBytes += (chunk as Buffer).length;
          if (totalBytes > HTTP_BODY_LIMIT) {
            res.writeHead(413).end("Payload too large");
            finish(413);
            return;
          }
          chunks.push(chunk as Buffer);
        }
        const rawBody = Buffer.concat(chunks).toString("utf-8");
        if (!verifyStripeWebhookSignature(rawBody, signature)) {
          res.writeHead(400).end("Invalid webhook signature");
          finish(400);
          return;
        }

        let event: unknown;
        try {
          event = JSON.parse(rawBody);
        } catch {
          res.writeHead(400).end("Invalid JSON");
          finish(400);
          return;
        }

        const result = await applyStripeWebhookEvent(db, event as Record<string, unknown>);
        res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({ received: true, ...result }));
        finish(200);
        return;
      }

      if (url.pathname !== "/mcp") {
        res.writeHead(404).end("Not found");
        finish(404);
        return;
      }

      // ------------------------------------------------------------------
      // API key validation via better-auth
      // ------------------------------------------------------------------
      const authHeader = req.headers.authorization ?? "";
      const bearerMatch = authHeader.match(/^Bearer (.+)$/i);
      if (!bearerMatch) {
        res.writeHead(401, { "WWW-Authenticate": 'Bearer realm="quillby-mcp"' }).end("Unauthorized");
        finish(401);
        return;
      }

      const verification = await verifyApiKey(bearerMatch[1]);
      if (!verification.valid) {
        res.writeHead(401, { "WWW-Authenticate": 'Bearer realm="quillby-mcp"' }).end("Unauthorized");
        finish(401);
        return;
      }

      const userId: string = verification.key?.referenceId ?? "unknown";

      // ------------------------------------------------------------------
      // Route GET/DELETE to existing session transport
      // ------------------------------------------------------------------
      if (req.method === "GET" || req.method === "DELETE") {
        const sessionId = req.headers["mcp-session-id"] as string | undefined;
        if (!sessionId || !sessions.has(sessionId)) {
          res.writeHead(400).end("Missing or unknown mcp-session-id");
          finish(400);
          return;
        }
        const session = sessions.get(sessionId)!;
        if (session.userId !== userId) {
          res.writeHead(403).end("Forbidden");
          finish(403);
          return;
        }
        await session.transport.handleRequest(req, res);
        finish(200);
        return;
      }

      // ------------------------------------------------------------------
      // POST — new or existing session
      // ------------------------------------------------------------------
      if (req.method === "POST") {
        // Read body with size limit
        const chunks: Buffer[] = [];
        let totalBytes = 0;
        for await (const chunk of req) {
          totalBytes += (chunk as Buffer).length;
          if (totalBytes > HTTP_BODY_LIMIT) {
            res.writeHead(413).end("Payload too large");
            finish(413);
            return;
          }
          chunks.push(chunk as Buffer);
        }
        const body = Buffer.concat(chunks).toString("utf-8");
        let parsedBody: unknown;
        try { parsedBody = JSON.parse(body); } catch { parsedBody = undefined; }

        const sessionId = req.headers["mcp-session-id"] as string | undefined;

        if (sessionId && sessions.has(sessionId)) {
          const session = sessions.get(sessionId)!;
          if (session.userId !== userId) {
            res.writeHead(403).end("Forbidden");
            finish(403);
            return;
          }
          await session.transport.handleRequest(req, res, parsedBody);
          finish(200);
          return;
        }

        // New session
        const sessionServer = createMcpServer();
        const userStorage = getHostedUserStorage(userId);
        registerMcpHandlers(sessionServer, userStorage);

        const transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => randomUUID(),
        });
        const sid = transport.sessionId ?? randomUUID();
        sessions.set(sid, { transport, server: sessionServer, userId });
        slog("info", "session_open", { sessionId: sid, userId, sessions: sessions.size });

        transport.onclose = () => {
          if (transport.sessionId) {
            const session = sessions.get(transport.sessionId);
            sessions.delete(transport.sessionId);
            session?.server.close().catch(() => {});
            slog("info", "session_close", { sessionId: transport.sessionId, sessions: sessions.size });
          }
        };

        await sessionServer.connect(transport);
        await transport.handleRequest(req, res, parsedBody);
        finish(200);
        return;
      }

      res.writeHead(405).end("Method not allowed");
      finish(405);
    } catch (err) {
      slog("error", "unhandled_error", { error: err instanceof Error ? err.message : String(err) });
      if (!res.headersSent) res.writeHead(500).end("Internal server error");
      finish(500);
    }
  });

  // ------------------------------------------------------------------
  // Graceful shutdown
  // ------------------------------------------------------------------
  const shutdown = (signal: string) => {
    slog("info", "shutdown", { signal });
    httpServer.close(() => {
      slog("info", "shutdown_complete");
      process.exit(0);
    });
    // Force exit after 10 s if connections are not drained
    setTimeout(() => {
      slog("warn", "shutdown_forced");
      process.exit(1);
    }, 10_000).unref();
  };
  process.once("SIGTERM", () => shutdown("SIGTERM"));
  process.once("SIGINT", () => shutdown("SIGINT"));

  httpServer.listen(PORT, HOST, () => {
    slog("info", "listening", { host: HOST, port: PORT, url: `http://${HOST}:${PORT}/mcp` });
  });
} else {
  // Default: stdio (local MCP clients — Claude Desktop, VS Code, Cursor)
  const server = createMcpServer();
  registerMcpHandlers(server, storage);
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

// Scheduled autonomous harvest — fires daily at Quillby_SCHEDULE (HH:MM local time).
// Runs regardless of transport mode but works best as an HTTP daemon.
// In stdio mode it only fires while an MCP client has the server open.
const Quillby_SCHEDULE = process.env.Quillby_SCHEDULE;
if (Quillby_SCHEDULE) {
  scheduleDaily(Quillby_SCHEDULE, runScheduledHarvest);
}
