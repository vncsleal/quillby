import { callLLM } from "../llm";
import { CONFIG, readTextFile } from "../config";
import type { ResearchedItem, ContentConcept } from "../types";
import * as cli from "../cli";

const WORKER_POOL_SIZE = 3; // Process 3 items in parallel

async function processWithWorkerPool<T, R>(
  items: T[],
  processor: (item: T, index: number) => Promise<R>,
  stageName: string
): Promise<(R | null)[]> {
  const results: (R | null)[] = new Array(items.length).fill(null);
  const queue = items.map((item, index) => ({ item, index }));

  let processing = 0;
  let queueIndex = 0;

  const worker = async () => {
    while (queueIndex < queue.length) {
      const current = queue[queueIndex++];
      try {
        results[current.index] = await processor(current.item, current.index);
      } catch {
        results[current.index] = null;
      }
      cli.printProgress(queueIndex, items.length);
    }
  };

  // Start worker pool
  const workers = [];
  for (let i = 0; i < Math.min(WORKER_POOL_SIZE, items.length); i++) {
    workers.push(worker());
  }

  await Promise.all(workers);
  return results;
}

export async function copywriter(
  concepts: ContentConcept[],
  items: ResearchedItem[],
  context: string
): Promise<string[]> {
  cli.printStageStart("Building wireframes");

  const prompt = readTextFile(CONFIG.FILES.PROMPTS.COPYWRITER);

  const results = await processWithWorkerPool(
    concepts,
    async (concept, i) => {
      const item = items[concept.item_id];
      if (!item) return null;

      const response = await callLLM({
        systemPrompt: prompt,
        userMessage: [
          `CONTEXT:\n${context}`,
          `\nCONCEPT:\n${JSON.stringify(concept)}`,
          `\nSOURCE:\nTitle: ${item.title}\nLink: ${item.link}\nContent: ${item.content.slice(0, 1500)}`,
          item.research
            ? `\nRESEARCH:\nThesis: ${item.research.thesis}\nKey Insights: ${JSON.stringify(item.research.insights?.slice(0, 3))}\nQuotes: ${JSON.stringify(item.research.quotes)}`
            : "",
        ].join("\n"),
        temperature: CONFIG.LLM.TEMPERATURE_CREATIVE,
        stage: "copywriter",
      });

      return response.content;
    },
    "wireframes"
  );

  const wireframes = results.filter((w) => w !== null) as string[];

  cli.printProgressDone();
  cli.printResult("Built", wireframes.length, concepts.length, "wireframes");
  return wireframes;
}

export async function ghostwriter(
  wireframes: string[],
  concepts: ContentConcept[],
  items: ResearchedItem[],
  context: string
): Promise<string[]> {
  cli.printStageStart("Writing publish-ready drafts");

  const prompt = readTextFile(CONFIG.FILES.PROMPTS.GHOSTWRITER);

  const itemsToProcess = wireframes.map((wireframe, idx) => ({
    wireframe,
    concept: concepts[idx],
    item: concepts[idx] ? items[concepts[idx].item_id] : null,
    index: idx,
  }));

  const results = await processWithWorkerPool(
    itemsToProcess,
    async (data) => {
      const response = await callLLM({
        systemPrompt: prompt,
        userMessage: [
          `CONTEXT:\n${context}`,
          `\nWIREFRAME:\n${data.wireframe}`,
          data.item?.research ? `\nRESEARCH:\n${JSON.stringify(data.item.research)}` : "",
        ].join("\n"),
        temperature: CONFIG.LLM.TEMPERATURE_CREATIVE,
        stage: "ghostwriter",
      });

      return response.content;
    },
    "drafts"
  );

  const drafts = results.filter((d) => d !== null) as string[];

  cli.printProgressDone();
  cli.printResult("Written", drafts.length, wireframes.length, "drafts");
  return drafts;
}
