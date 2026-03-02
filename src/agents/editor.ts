import { callLLM, parseJSON } from "../llm";
import { CONFIG, readTextFile } from "../config";
import type { ResearchedItem, ContentConcept } from "../types";
import * as cli from "../cli";

export async function editor(items: ResearchedItem[], context: string): Promise<ContentConcept[]> {
  cli.printStageStart("Generating content concepts");

  const prompt = readTextFile(CONFIG.FILES.PROMPTS.EDITOR);

  const EDITOR_BATCH = 3;
  const allConcepts: ContentConcept[] = [];
  const totalBatches = Math.ceil(items.length / EDITOR_BATCH);
  let failedBatches = 0;

  for (let i = 0; i < items.length; i += EDITOR_BATCH) {
    const batch = items.slice(i, i + EDITOR_BATCH);

    const editorInput = batch.map((it, idx) => ({
      id: i + idx,
      title: it.title,
      source: it.source,
      snippet: it.content.slice(0, 220),
      score: it.score,
      reason: it.reason,
      thesis: it.research?.thesis || "",
      key_insights: it.research?.insights?.slice(0, 2).map((ins: any) => ins.insight) || [],
      best_format: it.research?.content_potential?.best_format || "",
      best_angle: it.research?.content_potential?.angle || "",
    }));

    let response;
    try {
      response = await callLLM({
        systemPrompt: prompt,
        userMessage: `CONTEXT:\n${context}\n\nSELECTED ITEMS:\n${JSON.stringify(editorInput)}`,
        jsonMode: true,
        temperature: CONFIG.LLM.TEMPERATURE_CREATIVE,
        stage: "editor",
      });
    } catch {
      failedBatches++;
      continue; // Skip this batch on timeout
    }

    try {
      const parsed = parseJSON<{ concepts: ContentConcept[] }>(response.content);
      if (parsed.concepts) {
        allConcepts.push(...parsed.concepts);
      }
    } catch (err) {
      // silently skip
    }
  }

  if (allConcepts.length === 0 && items.length > 0) {
    const fallbackConcepts = buildFallbackConcepts(items);
    const limitedFallback = fallbackConcepts.slice(0, CONFIG.PIPELINE.MAX_CONCEPTS_TO_WRITE);
    cli.printMessage(
      `Editor fallback activated (${failedBatches}/${totalBatches} failed batches).`,
      "muted"
    );
    cli.printResult("Generated", limitedFallback.length, items.length, "fallback concepts");
    return limitedFallback;
  }

  const limitedConcepts = allConcepts.slice(0, CONFIG.PIPELINE.MAX_CONCEPTS_TO_WRITE);
  const platforms = new Set(limitedConcepts.map((c) => c.platform));
  cli.printResult("Generated", limitedConcepts.length, items.length, `${platforms.size} platforms`);

  return limitedConcepts;
}

function buildFallbackConcepts(items: ResearchedItem[]): ContentConcept[] {
  const concepts: ContentConcept[] = [];

  for (let idx = 0; idx < items.length; idx++) {
    const item = items[idx];
    const thesis = item.research?.thesis || item.title;
    const angle = item.research?.content_potential?.angle || item.reason || "Practical implementation";

    concepts.push({
      item_id: idx,
      platform: "LinkedIn",
      temperature: "Warm",
      format: "Practical insight",
      take: thesis.slice(0, 240),
      hook: `O insight mais útil desse tema: ${item.title}`.slice(0, 220),
      angle: angle.slice(0, 200),
      visual_suggestion: "Carrossel com problema → decisão → resultado",
      content_pair: "Expandir para blog com exemplos de implementação",
    });

    if (concepts.length >= CONFIG.PIPELINE.MAX_CONCEPTS_TO_WRITE) {
      break;
    }
  }

  return concepts;
}
