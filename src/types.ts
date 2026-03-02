import { z } from "zod";

// ─── SCHEMAS ──────────────────────────────────────────────────────────────

export const RssItemSchema = z.object({
  id: z.string(),
  source: z.string(),
  title: z.string(),
  link: z.string().url(),
  snippet: z.string(),
  publishedAt: z.string().optional(),
});

export const EnrichedItemSchema = RssItemSchema.extend({
  content: z.string(),
  score: z.number().min(0).max(10),
  reason: z.string(),
});

export const InsightSchema = z.object({
  insight: z.string(),
  why_it_matters: z.string(),
  novelty: z.string(),
});

export const ResearchSchema = z.object({
  thesis: z.string(),
  insights: z.array(InsightSchema),
  production_relevance: z.object({
    application: z.string(),
    tradeoffs: z.string(),
    hidden_cost: z.string(),
  }),
  connections: z.object({
    tech_stack: z.array(z.string()),
    adjacent_topics: z.array(z.string()),
    counter_argument: z.string(),
  }),
  quotes: z.array(z.string()),
  content_potential: z.object({
    score: z.number().min(0).max(10),
    best_format: z.string(),
    angle: z.string(),
  }),
});

export const ResearchedItemSchema = EnrichedItemSchema.extend({
  research: ResearchSchema,
});

export const ContentConceptSchema = z.object({
  item_id: z.number(),
  platform: z.enum(["X", "LinkedIn", "Blog"]),
  temperature: z.enum(["Hot", "Warm", "Cold"]),
  format: z.string(),
  take: z.string(),
  hook: z.string(),
  angle: z.string(),
  visual_suggestion: z.string(),
  content_pair: z.string().optional(),
});

export const TrendSchema = z.object({
  theme: z.string(),
  articles: z.array(z.number()),
  signal_strength: z.enum(["Strong", "Moderate", "Emerging"]),
  narrative: z.string(),
  tension: z.string(),
  content_opportunities: z.object({
    x_thread: z.string(),
    linkedin: z.string(),
    blog: z.string(),
  }),
});

// ─── TYPES ────────────────────────────────────────────────────────────────

export type RssItem = z.infer<typeof RssItemSchema>;
export type EnrichedItem = z.infer<typeof EnrichedItemSchema>;
export type Insight = z.infer<typeof InsightSchema>;
export type Research = z.infer<typeof ResearchSchema>;
export type ResearchedItem = z.infer<typeof ResearchedItemSchema>;
export type ContentConcept = z.infer<typeof ContentConceptSchema>;
export type Trend = z.infer<typeof TrendSchema>;

// ─── TOOL DEFINITIONS ─────────────────────────────────────────────────────

export interface Tool {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: {
      type: "object";
      properties: Record<string, unknown>;
      required: string[];
    };
  };
}

export interface ToolCall {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string;
  };
}

// ─── OUTPUT TYPES ────────────────────────────────────────────────────────

export interface OutputMetadata {
  stage: string;
  timestamp: string;
  processed: number;
  quality_score?: number;
  llm_calls: number;
  duration_ms: number;
  costs?: {
    estimated_usd: number;
    breakdown: Record<string, number>;
  };
}

export interface PipelineOutput {
  wireframes: string[];
  drafts: string[];
  concepts: ContentConcept[];
  trends: Trend[];
  items: ResearchedItem[];
  metadata: OutputMetadata;
}

export interface StructureCard {
  id: number;
  itemId: number;
  title: string;
  source: string;
  link: string;
  thesis: string;
  insightOptions: string[];
  takeOptions: string[];
  angleOptions: string[];
  hookOptions: string[];
  wireframeOptions: string[];
  trendTags: string[];
  references: string[];
  transposabilityHint: string;
}
