import * as fs from "fs";
import * as path from "path";
import { ensureDir } from "@quillby/config";
import {
  HarvestBundleSchema,
  CardInputSchema,
  type HarvestBundle,
  type StructureCard,
  type CardInput,
  type CurationStatus,
} from "@quillby/core";
import { getCurrentWorkspaceId, getWorkspacePaths, type DraftSummary } from "@quillby/workspace";

function createTimestampedOutputDir(workspaceId: string): string {
  const paths = getWorkspacePaths(workspaceId);
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, -5);
  const outputDir = path.join(paths.outputDir, timestamp);
  ensureDir(outputDir);

  const latestLink = path.join(paths.outputDir, "latest");
  try {
    if (fs.existsSync(latestLink)) fs.unlinkSync(latestLink);
    fs.symlinkSync(timestamp, latestLink);
  } catch {
    // Non-critical on filesystems that do not support symlinks.
  }

  return outputDir;
}

export function saveHarvestOutput(rawCards: CardInput[], _seenUrls?: Set<string>, workspaceId?: string): string {
  const wsId = workspaceId ?? getCurrentWorkspaceId();
  const paths = getWorkspacePaths(wsId);
  const outputDir = createTimestampedOutputDir(wsId);
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
    curationState: {},
  };

  fs.writeFileSync(path.join(outputDir, "structures.json"), JSON.stringify(bundle, null, 2));

  const markdown = buildMarkdown(cards, dateLabel);
  fs.writeFileSync(path.join(outputDir, "structures.md"), markdown + "\n");

  ensureDir(paths.cacheDir);
  fs.writeFileSync(paths.latestHarvestPointer, path.join(outputDir, "structures.json"));

  return outputDir;
}

function buildMarkdown(cards: StructureCard[], dateLabel: string): string {
  return [
    `# Quillby Harvest — ${dateLabel}`,
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

export function loadLatestHarvest(workspaceId?: string): HarvestBundle {
  const paths = getWorkspacePaths(workspaceId ?? getCurrentWorkspaceId());
  if (!fs.existsSync(paths.latestHarvestPointer)) {
    throw new Error(
      "No harvest found. Run quillby_fetch_articles then quillby_save_cards first."
    );
  }

  const bundlePath = fs.readFileSync(paths.latestHarvestPointer, "utf-8").trim();
  if (!bundlePath || !fs.existsSync(bundlePath)) {
    throw new Error("Latest harvest pointer is invalid. Re-run quillby_fetch_articles.");
  }

  const raw = JSON.parse(fs.readFileSync(bundlePath, "utf-8"));
  return HarvestBundleSchema.parse(raw);
}

export function latestHarvestExists(workspaceId?: string): boolean {
  const paths = getWorkspacePaths(workspaceId ?? getCurrentWorkspaceId());
  if (!fs.existsSync(paths.latestHarvestPointer)) return false;
  const bundlePath = fs.readFileSync(paths.latestHarvestPointer, "utf-8").trim();
  return Boolean(bundlePath) && fs.existsSync(bundlePath);
}

export function saveDraft(
  content: string,
  platform: string,
  cardId?: number,
  workspaceId?: string
): string {
  const paths = getWorkspacePaths(workspaceId ?? getCurrentWorkspaceId());
  const bundlePath = fs.existsSync(paths.latestHarvestPointer)
    ? fs.readFileSync(paths.latestHarvestPointer, "utf-8").trim()
    : null;

  const outputDir = bundlePath ? path.dirname(bundlePath) : paths.outputDir;
  ensureDir(outputDir);
  const suffix = cardId != null ? `_card${cardId}` : "";
  const filePath = path.join(outputDir, `${platform.toLowerCase()}${suffix}.md`);
  fs.writeFileSync(filePath, content + "\n");
  return filePath;
}

export function saveCurationState(
  state: Record<string, CurationStatus>,
  workspaceId?: string
): void {
  const paths = getWorkspacePaths(workspaceId ?? getCurrentWorkspaceId());
  if (!fs.existsSync(paths.latestHarvestPointer)) {
    throw new Error("No harvest found. Save cards first before curating.");
  }
  const bundlePath = fs.readFileSync(paths.latestHarvestPointer, "utf-8").trim();
  if (!bundlePath || !fs.existsSync(bundlePath)) {
    throw new Error("Latest harvest pointer is invalid.");
  }
  const raw = JSON.parse(fs.readFileSync(bundlePath, "utf-8"));
  const bundle: HarvestBundle = HarvestBundleSchema.parse(raw);
  const merged = { ...bundle.curationState, ...state };
  const updated = { ...bundle, curationState: merged };
  fs.writeFileSync(bundlePath, JSON.stringify(updated, null, 2));
}

export function listLocalDrafts(workspaceId?: string): DraftSummary[] {
  const paths = getWorkspacePaths(workspaceId ?? getCurrentWorkspaceId());
  const bundlePath = fs.existsSync(paths.latestHarvestPointer)
    ? fs.readFileSync(paths.latestHarvestPointer, "utf-8").trim()
    : null;
  const searchDirs: string[] = [];
  if (bundlePath && fs.existsSync(bundlePath)) searchDirs.push(path.dirname(bundlePath));
  if (fs.existsSync(paths.outputDir)) searchDirs.push(paths.outputDir);

  const seen = new Set<string>();
  const drafts: DraftSummary[] = [];

  for (const dir of searchDirs) {
    if (!fs.existsSync(dir)) continue;
    for (const file of fs.readdirSync(dir)) {
      if (!file.endsWith(".md") || file === "structures.md") continue;
      const filePath = path.join(dir, file);
      if (seen.has(filePath)) continue;
      seen.add(filePath);
      const stat = fs.statSync(filePath);
      const cardMatch = file.match(/_card(\d+)\.md$/);
      const cardId = cardMatch ? parseInt(cardMatch[1], 10) : undefined;
      const platform = file.replace(/_card\d+\.md$/, "").replace(/\.md$/, "");
      const content = fs.readFileSync(filePath, "utf-8");
      drafts.push({
        id: filePath,
        platform,
        cardId,
        createdAt: stat.mtime.toISOString(),
        preview: content.slice(0, 200).replace(/\n+/g, " ").trim(),
      });
    }
  }

  drafts.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return drafts;
}
