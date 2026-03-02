import { callLLM, parseJSON, selectModel } from "../llm";
import { CONFIG, readTextFile } from "../config";
import { enrichArticle } from "../extractors/content";
import { findSimilarCached, cacheArticle, getEmbeddingWithCost } from "../cache";
import { recordEmbeddingCost } from "../costs";
import type { EnrichedItem, ResearchedItem, Research } from "../types";
import * as cli from "../cli";

export async function researcher(items: EnrichedItem[], context: string): Promise<ResearchedItem[]> {
  cli.printStageStart("Enriching articles with research");

  // Phase 1: Fetch full content
  cli.printMessage("Fetching full content", "muted");
  const fetchConcurrency = Math.max(1, CONFIG.RSS.CONCURRENCY);
  for (let i = 0; i < items.length; i += fetchConcurrency) {
    const batch = items.slice(i, i + fetchConcurrency);
    const contents = await Promise.all(
      batch.map((item) => enrichArticle(item.link, item.title))
    );

    contents.forEach((content, idx) => {
      batch[idx].content = content || batch[idx].snippet;
    });

    cli.printProgress(i + batch.length, items.length);
  }
  cli.printProgressDone();

  // Phase 1.5: Check cache for similar articles
  cli.printMessage("Checking content cache", "muted");
  const cachedResults: Map<number, ResearchedItem> = new Map();

  for (let i = 0; i < items.length; i++) {
    const item = items[i];

    try {
      const cached = await findSimilarCached(item.link, item.title);
      if (cached) {
        cachedResults.set(i, {
          ...item,
          research: cached.research,
        });
        cli.printProgress(i + 1, items.length);
      }
    } catch {
      // Silently skip cache check on error
    }
  }
  cli.printProgressDone();

  // Phase 2: Analyze with LLM (using advanced model for deep reasoning)
  cli.printMessage("Running AI analysis", "muted");
  const prompt = readTextFile(CONFIG.FILES.PROMPTS.RESEARCHER);

  const results: ResearchedItem[] = [];

  for (let i = 0; i < items.length; i++) {
    const item = items[i];

    // Return cached result if available
    if (cachedResults.has(i)) {
      const cached = cachedResults.get(i)!;
      results.push(cached);
      cli.printProgress(i + 1, items.length);
      continue;
    }

    let response;
    try {
      response = await callLLM({
        systemPrompt: prompt,
        userMessage: `CONTEXT:\n${context}\n\nARTICLE:\nTitle: ${item.title}\nSource: ${item.source}\nLink: ${item.link}\nContent:\n${item.content.slice(0, CONFIG.ENRICHMENT.MAX_CONTENT_LENGTH)}`,
        jsonMode: true,
        temperature: CONFIG.LLM.TEMPERATURE_ANALYTICAL,
        model: selectModel("advanced"), // Use advanced model for deep article analysis
        stage: "researcher",
      });
    } catch {
      cli.printProgress(i + 1, items.length);
      continue; // Skip this item on timeout
    }

    try {
      const research = parseJSON<Research>(response.content);
      const researchedItem: ResearchedItem = {
        ...item,
        research,
      };
      results.push(researchedItem);

      // Cache the article for future runs
      try {
        const { embedding, cost } = await getEmbeddingWithCost(item.title);
        recordEmbeddingCost(cost);
        cacheArticle(item.link, item.title, embedding, research);
      } catch {
        // Silently skip caching on error
      }

      cli.printProgress(i + 1, items.length);
    } catch (err) {
      // silently skip
    }
  }

  cli.printProgressDone();
  cli.printResult("Analyzed", results.length, items.length, "articles");

  return results;
}
