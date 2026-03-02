import { callLLM, parseJSON, selectModel } from "../llm";
import { CONFIG, readTextFile } from "../config";
import type { RssItem, EnrichedItem } from "../types";
import * as cli from "../cli";

export async function librarian(items: RssItem[], context: string): Promise<EnrichedItem[]> {
  cli.printStageStart("Filtering items for quality");

  const prompt = readTextFile(CONFIG.FILES.PROMPTS.LIBRARIAN);

  // Process in batches with parallel workers
  const BATCH_SIZE = Math.max(40, CONFIG.LLM.BATCH_SIZE);
  const allSelected: EnrichedItem[] = [];
  const totalBatches = Math.ceil(items.length / BATCH_SIZE);

  for (let i = 0; i < items.length; i += BATCH_SIZE) {
    const batchNum = Math.floor(i / BATCH_SIZE) + 1;
    // No spinner for batch operations - silent processing

    const batch = items.slice(i, i + BATCH_SIZE);

    const batchInput = batch.map((it, idx) => ({
      id: i + idx,
      title: it.title,
      snippet: it.snippet.slice(0, 300),
      source: it.source,
    }));

    let response;
    try {
      response = await callLLM({
        systemPrompt: prompt,
        userMessage: `CONTEXT:\n${context}\n\nITEMS:\n${JSON.stringify(batchInput)}`,
        jsonMode: true,
        temperature: CONFIG.LLM.TEMPERATURE_ANALYTICAL,
        model: selectModel("fast"),
        stage: "librarian",
      });
    } catch {
      continue; // Skip this batch on timeout
    }

    try {
      const parsed = parseJSON<{ selected: Array<{ id: number; score: number; reason?: string }> }>(response.content);

      for (const sel of parsed.selected || []) {
        const item = items[sel.id];
        if (item && sel.score >= CONFIG.PIPELINE.MIN_LIBRARIAN_SCORE) {
          allSelected.push({
            ...item,
            content: item.snippet,
            score: sel.score,
            reason: sel.reason || "",
          });
        }
      }
    } catch (err) {
      // silently skip
    }
  }

  allSelected.sort((a, b) => b.score - a.score);
  const limited = allSelected.slice(0, CONFIG.PIPELINE.MAX_ITEMS_TO_RESEARCH);

  cli.printResult("Selected", limited.length, allSelected.length, "passed quality");
  cli.printSelection(
    limited.map((item) => `[${item.score}/10] ${item.title}`),
    5
  );

  return limited;
}
