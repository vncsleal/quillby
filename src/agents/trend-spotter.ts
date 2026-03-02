import { callLLM, parseJSON } from "../llm";
import { CONFIG, readTextFile } from "../config";
import type { ResearchedItem, Trend } from "../types";
import * as cli from "../cli";

export async function trendSpotter(items: ResearchedItem[], context: string): Promise<Trend[]> {
  if (items.length < 3) return [];

  cli.printStageStart("Analyzing patterns and trends");

  const prompt = readTextFile(CONFIG.FILES.PROMPTS.TREND_SPOTTER);

  const trendInput = items.map((it, idx) => ({
    id: idx,
    title: it.title,
    source: it.source,
    thesis: it.research?.thesis || "",
    insights: it.research?.insights?.map((i) => i.insight) || [],
    connections: it.research?.connections || {},
  }));

  cli.startSpinner("Identifying patterns");
  let response;
  try {
    response = await callLLM({
      systemPrompt: prompt,
      userMessage: `CONTEXT:\n${context}\n\nENRICHED ITEMS:\n${JSON.stringify(trendInput)}`,
      jsonMode: true,
      temperature: CONFIG.LLM.TEMPERATURE_CREATIVE,
      stage: "trend-spotter",
    });
  } catch {
    return [];
  } finally {
    cli.stopSpinner();
  }

  try {
    const parsed = parseJSON<{ trends: Trend[] }>(response.content);
    const trends = parsed.trends || [];

    if (trends.length > 0) {
      cli.printResult("Identified", trends.length, undefined, "patterns");
      cli.printSelection(
        trends.map((t) => `[${t.signal_strength}] ${t.theme}`),
        3
      );
    }

    return trends;
  } catch (err) {
    return [];
  }
}
