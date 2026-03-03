import * as fs from "fs";
import * as path from "path";
import { CONFIG } from "../config";
import type { ContentConcept, ResearchedItem, StructureCard, Trend } from "../types";

interface HarvestBundle {
  generatedAt: string;
  dateLabel: string;
  structures: StructureCard[];
  trends: Trend[];
  items: ResearchedItem[];
}

const CACHE_DIR = path.join(process.cwd(), ".cache");
const LATEST_HARVEST_POINTER = path.join(CACHE_DIR, "latest_harvest_path.txt");

function ensureDir(dirPath: string) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

function createTimestampedOutputDir() {
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, -5);
  const outputDir = path.join(CONFIG.FILES.OUTPUT_DIR, timestamp);
  ensureDir(outputDir);

  const latestLink = path.join(CONFIG.FILES.OUTPUT_DIR, "latest");
  try {
    if (fs.existsSync(latestLink)) {
      fs.unlinkSync(latestLink);
    }
    fs.symlinkSync(timestamp, latestLink);
  } catch {
    // Ignore symlink errors
  }

  return outputDir;
}

export function buildStructureCards(
  concepts: ContentConcept[],
  items: ResearchedItem[],
  wireframes: string[],
  trends: Trend[]
): StructureCard[] {
  const byItem = new Map<number, Array<{ concept: ContentConcept; wireframe?: string }>>();

  concepts.forEach((concept, index) => {
    const bucket = byItem.get(concept.item_id) ?? [];
    bucket.push({ concept, wireframe: wireframes[index] });
    byItem.set(concept.item_id, bucket);
  });

  const cards: StructureCard[] = [];

  for (const [itemId, entries] of byItem.entries()) {
    const item = items[itemId];
    if (!item) continue;

    const takeOptions = [...new Set(entries.map((entry) => entry.concept.take).filter(Boolean))];
    const angleOptions = [...new Set(entries.map((entry) => entry.concept.angle).filter(Boolean))];
    const hookOptions = [...new Set(entries.map((entry) => entry.concept.hook).filter(Boolean))];
    const wireframeOptions = entries.map((entry) => entry.wireframe).filter(Boolean) as string[];

    const insightOptions = (item.research?.insights ?? [])
      .map((insight) => `${insight.insight} — ${insight.why_it_matters}`)
      .filter(Boolean);

    const trendTags = trends
      .filter((trend) => trend.articles.includes(itemId))
      .map((trend) => trend.theme);

    const references = [
      item.link,
      ...(item.research?.quotes ?? []).slice(0, 3),
    ];

    cards.push({
      id: cards.length + 1,
      itemId,
      title: item.title,
      source: item.source,
      link: item.link,
      thesis: item.research?.thesis ?? item.reason,
      insightOptions,
      takeOptions,
      angleOptions,
      hookOptions,
      wireframeOptions,
      trendTags,
      references,
      transposabilityHint:
        item.research?.connections?.counter_argument ||
        "Reframe this through another adjacent domain without changing the core facts.",
    });
  }

  return cards;
}

export function saveHarvestOutput(
  structures: StructureCard[],
  trends: Trend[],
  items: ResearchedItem[],
  dateLabel: string
): string {
  const outputDir = createTimestampedOutputDir();

  const bundle: HarvestBundle = {
    generatedAt: new Date().toISOString(),
    dateLabel,
    structures,
    trends,
    items,
  };

  fs.writeFileSync(path.join(outputDir, "structures.json"), JSON.stringify(bundle, null, 2));

  const overview = [
    `# GRIST Harvest — ${dateLabel}`,
    "",
    "## Summary",
    `- Structures: ${structures.length}`,
    `- Trends: ${trends.length}`,
    `- Researched Articles: ${items.length}`,
    "",
    "## How to compose",
    "- Run: `npm run compose -- --card 1 --platform LinkedIn`",
    "- Optional: `--take 2` or `--insight 3`",
    "",
  ].join("\n");

  fs.writeFileSync(path.join(outputDir, "overview.md"), overview);

  const structuresMarkdown = [
    `# Structure Cards — ${dateLabel}`,
    "",
    ...structures.flatMap((card) => {
      const lines = [
        `## Card ${card.id}: ${card.title}`,
        `- Source: ${card.source}`,
        `- Link: ${card.link}`,
        `- Thesis: ${card.thesis}`,
        `- Trend tags: ${card.trendTags.join(", ") || "none"}`,
        "",
        "### Insight options",
        ...(card.insightOptions.length
          ? card.insightOptions.map((insight, index) => `${index + 1}. ${insight}`)
          : ["1. (No insights extracted)"]),
        "",
        "### Take options",
        ...(card.takeOptions.length
          ? card.takeOptions.map((take, index) => `${index + 1}. ${take}`)
          : ["1. (No takes generated)"]),
        "",
        "### Angle options",
        ...(card.angleOptions.length
          ? card.angleOptions.map((angle, index) => `${index + 1}. ${angle}`)
          : ["1. (No angles generated)"]),
        "",
        "### Reference pack",
        ...card.references.map((ref) => `- ${ref}`),
        "",
        `### Transposability hint`,
        card.transposabilityHint,
        "",
        "---",
        "",
      ];
      return lines;
    }),
  ].join("\n");

  fs.writeFileSync(path.join(outputDir, "structures.md"), structuresMarkdown);

  ensureDir(CACHE_DIR);
  fs.writeFileSync(LATEST_HARVEST_POINTER, path.join(outputDir, "structures.json"));

  return outputDir;
}

export function loadLatestHarvest(): HarvestBundle {
  if (!fs.existsSync(LATEST_HARVEST_POINTER)) {
    throw new Error("No harvest found. Run `npm run harvest` first.");
  }

  const bundlePath = fs.readFileSync(LATEST_HARVEST_POINTER, "utf-8").trim();
  if (!bundlePath || !fs.existsSync(bundlePath)) {
    throw new Error("Latest harvest pointer is invalid. Run `npm run harvest` again.");
  }

  return JSON.parse(fs.readFileSync(bundlePath, "utf-8")) as HarvestBundle;
}

export function saveComposeOutput(
  draft: string,
  metadata: {
    platform: string;
    cardId: number;
    selectedTake: string;
    selectedInsight: string;
  }
): string {
  const outputDir = createTimestampedOutputDir();

  const content = [
    `# GRIST Compose`,
    "",
    `- Platform: ${metadata.platform}`,
    `- Card: ${metadata.cardId}`,
    `- Take: ${metadata.selectedTake}`,
    `- Insight: ${metadata.selectedInsight}`,
    "",
    "---",
    "",
    draft,
    "",
  ].join("\n");

  fs.writeFileSync(path.join(outputDir, "draft.md"), content);
  return outputDir;
}
