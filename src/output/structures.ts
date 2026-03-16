import * as fs from "fs";
import * as path from "path";
import { CONFIG, ensureDir } from "../config.js";
import { HarvestBundleSchema, CardInputSchema, type HarvestBundle, type StructureCard, type CardInput } from "../types.js";
import { saveSeenUrls } from "../extractors/rss.js";

const CACHE_DIR = ".cache";
const LATEST_HARVEST_POINTER = path.join(CACHE_DIR, "latest_harvest_path.txt");

function createTimestampedOutputDir(): string {
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, -5);
  const outputDir = path.join(CONFIG.FILES.OUTPUT_DIR, timestamp);
  ensureDir(outputDir);

  const latestLink = path.join(CONFIG.FILES.OUTPUT_DIR, "latest");
  try {
    if (fs.existsSync(latestLink)) fs.unlinkSync(latestLink);
    fs.symlinkSync(timestamp, latestLink);
  } catch {
    // Non-critical on filesystems that do not support symlinks.
  }

  return outputDir;
}

export function saveHarvestOutput(rawCards: CardInput[], seenUrls: Set<string>): string {
  // Only persist if the caller actually passed URLs — calling with new Set()
  // would silently wipe the cache. Seen URLs should be saved by the fetch step.
  if (seenUrls.size > 0) saveSeenUrls(seenUrls);

  const outputDir = createTimestampedOutputDir();
  const dateLabel = new Date().toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });

  // Assign IDs and default references — host provides all other fields.
  const cards: StructureCard[] = rawCards.map((raw, index) => ({
    ...CardInputSchema.parse(raw),
    id: index + 1,
    references: [],
  }));

  const bundle: HarvestBundle = {
    generatedAt: new Date().toISOString(),
    dateLabel,
    cards,
  };

  fs.writeFileSync(path.join(outputDir, "structures.json"), JSON.stringify(bundle, null, 2));

  const markdown = buildMarkdown(cards, dateLabel);
  fs.writeFileSync(path.join(outputDir, "structures.md"), markdown + "\n");

  ensureDir(CACHE_DIR);
  fs.writeFileSync(LATEST_HARVEST_POINTER, path.join(outputDir, "structures.json"));

  return outputDir;
}

function buildMarkdown(cards: StructureCard[], dateLabel: string): string {
  return [
    `# GRIST Harvest — ${dateLabel}`,
    "",
    `> ${cards.length} structure card${cards.length === 1 ? "" : "s"}, sorted by relevance`,
    "",
    ...cards.flatMap((card) => [
      `## Card ${card.id}: ${card.title}`,
      `- **Relevance:** ${card.relevanceScore}/10 — ${card.relevanceReason}`,
      `- **Source:** ${card.source}`,
      `- **Link:** ${card.link}`,
      `- **Thesis:** ${card.thesis}`,
      "",
      "### Key Insights",
      ...(card.keyInsights.length
        ? card.keyInsights.map((v, i) => `${i + 1}. ${v}`)
        : ["_(none)_"]),
      "",
      "### Takes",
      ...(card.takeOptions.length
        ? card.takeOptions.map((v, i) => `${i + 1}. ${v}`)
        : ["_(none)_"]),
      "",
      "### Angles",
      ...(card.angleOptions.length
        ? card.angleOptions.map((v, i) => `${i + 1}. ${v}`)
        : ["_(none)_"]),
      "",
      "### Hooks",
      ...(card.hookOptions.length
        ? card.hookOptions.map((v, i) => `${i + 1}. ${v}`)
        : ["_(none)_"]),
      ...(card.transposabilityHint
        ? ["", "### Transposability", card.transposabilityHint]
        : []),
      "",
      "---",
      "",
    ]),
  ].join("\n");
}

export function loadLatestHarvest(): HarvestBundle {
  if (!fs.existsSync(LATEST_HARVEST_POINTER)) {
    throw new Error(
      "No harvest found. Run grist_fetch_articles then grist_save_cards first."
    );
  }

  const bundlePath = fs.readFileSync(LATEST_HARVEST_POINTER, "utf-8").trim();
  if (!bundlePath || !fs.existsSync(bundlePath)) {
    throw new Error("Latest harvest pointer is invalid. Re-run grist_fetch_articles.");
  }

  const raw = JSON.parse(fs.readFileSync(bundlePath, "utf-8"));
  return HarvestBundleSchema.parse(raw);
}

export function latestHarvestExists(): boolean {
  if (!fs.existsSync(LATEST_HARVEST_POINTER)) return false;
  const bundlePath = fs.readFileSync(LATEST_HARVEST_POINTER, "utf-8").trim();
  return Boolean(bundlePath) && fs.existsSync(bundlePath);
}

export function saveDraft(
  content: string,
  platform: string,
  cardId?: number
): string {
  const bundlePath = fs.existsSync(LATEST_HARVEST_POINTER)
    ? fs.readFileSync(LATEST_HARVEST_POINTER, "utf-8").trim()
    : null;

  const outputDir = bundlePath ? path.dirname(bundlePath) : CONFIG.FILES.OUTPUT_DIR;
  ensureDir(outputDir);
  const suffix = cardId != null ? `_card${cardId}` : "";
  const filePath = path.join(outputDir, `${platform.toLowerCase()}${suffix}.md`);
  fs.writeFileSync(filePath, content + "\n");
  return filePath;
}
