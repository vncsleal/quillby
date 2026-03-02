import * as fs from "fs";
import * as path from "path";

export interface CostEntry {
  stage: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  cost: number;
  timestamp: number;
}

interface CostLog {
  entries: CostEntry[];
  totalCost: number;
  timestamp: string;
}

let costEntries: CostEntry[] = [];
export const EMBEDDING_INPUT_COST_PER_TOKEN = 0.00000002;

const MODEL_PRICING: Record<string, { input: number; output: number }> = {
  "gpt-5.2": { input: 0.0003, output: 0.0012 }, // $0.30 / $1.20 per 1M
  "gpt-5-mini": { input: 0.00003, output: 0.00012 }, // $0.03 / $0.12 per 1M
  "gpt-4-turbo": { input: 0.00001, output: 0.00003 }, // $0.01 / $0.03 per 1M
  "gpt-4o": { input: 0.0000025, output: 0.00001 }, // $0.0025 / $0.01 per 1M
  "gpt-4o-mini": { input: 0.00000015, output: 0.0000006 }, // $0.00015 / $0.0006 per 1M
  "o3": { input: 0.002, output: 0.008 }, // $2 / $8 per 1M (reasoning model)
  "text-embedding-3-small": { input: EMBEDDING_INPUT_COST_PER_TOKEN, output: 0 }, // $0.02 per 1M
};

export function recordCost(
  stage: string,
  model: string,
  inputTokens: number,
  outputTokens: number,
  customCost?: number
) {
  const pricing = MODEL_PRICING[model];
  if (!pricing && !customCost) {
    console.warn(`Unknown model pricing: ${model}`);
    return;
  }

  const cost = customCost ?? inputTokens * pricing.input + outputTokens * pricing.output;

  costEntries.push({
    stage: stage || "unknown",
    model,
    inputTokens,
    outputTokens,
    cost,
    timestamp: Date.now(),
  });
}

export function recordEmbeddingCost(cost: number) {
  costEntries.push({
    stage: "cache",
    model: "text-embedding-3-small",
    inputTokens: 0,
    outputTokens: 0,
    cost,
    timestamp: Date.now(),
  });
}

export function getCostStats(): {
  total: number;
  byStage: Record<string, number>;
  byModel: Record<string, number>;
  entries: CostEntry[];
} {
  const total = costEntries.reduce((sum, e) => sum + e.cost, 0);

  const byStage = costEntries.reduce(
    (acc, e) => {
      acc[e.stage] = (acc[e.stage] || 0) + e.cost;
      return acc;
    },
    {} as Record<string, number>
  );

  const byModel = costEntries.reduce(
    (acc, e) => {
      acc[e.model] = (acc[e.model] || 0) + e.cost;
      return acc;
    },
    {} as Record<string, number>
  );

  return {
    total,
    byStage,
    byModel,
    entries: costEntries,
  };
}

export function logCostsToFile(date: string) {
  const stats = getCostStats();

  const costLog: CostLog = {
    entries: stats.entries,
    totalCost: stats.total,
    timestamp: new Date().toISOString(),
  };

  const costDir = path.join(process.cwd(), "costs");
  if (!fs.existsSync(costDir)) {
    fs.mkdirSync(costDir, { recursive: true });
  }

  const filename = `costs_${date.replace(/\s+/g, "_").toLowerCase()}_${Date.now()}.json`;
  const filepath = path.join(costDir, filename);

  fs.writeFileSync(filepath, JSON.stringify(costLog, null, 2));

  return {
    path: filepath,
    total: stats.total,
    byStage: stats.byStage,
  };
}

export function resetCosts() {
  costEntries = [];
}
