import "dotenv/config";
import { CONFIG, readTextFile } from "./config";
import { fetchFeeds, getSeenUrls, saveSeenUrls } from "./extractors/rss";
import { librarian } from "./agents/librarian";
import { researcher } from "./agents/researcher";
import { editor } from "./agents/editor";
import { copywriter } from "./agents/copywriter";
import { trendSpotter } from "./agents/trend-spotter";
import {
  buildStructureCards,
  loadLatestHarvest,
  saveComposeOutput,
  saveHarvestOutput,
} from "./output/structures";
import { callLLM, getCallStats, selectModel } from "./llm";
import { getCostStats, logCostsToFile } from "./costs";
import type { StructureCard } from "./types";
import * as cli from "./cli";
import { runInit } from "./init";

type Command = "harvest" | "compose" | "board" | "help" | "init";

type ParsedArgs = {
  command: Command;
  flags: Record<string, string>;
};

function parseArgs(argv: string[]): ParsedArgs {
  const commandToken = argv[0] && !argv[0].startsWith("--") ? argv[0] : "harvest";
  const command: Command =
    commandToken === "compose"
      ? "compose"
      : commandToken === "board"
        ? "board"
        : commandToken === "init"
          ? "init"
        : commandToken === "help"
          ? "help"
          : "harvest";

  const rawFlags = commandToken === command ? argv.slice(1) : argv;
  const flags: Record<string, string> = {};

  for (let i = 0; i < rawFlags.length; i++) {
    const token = rawFlags[i];
    if (!token.startsWith("--")) continue;

    const key = token.slice(2);
    const next = rawFlags[i + 1];
    if (!next || next.startsWith("--")) {
      flags[key] = "true";
      continue;
    }

    flags[key] = next;
    i++;
  }

  return { command, flags };
}

function printHelp() {
  console.log("");
  console.log("  GRIST Commands");
  console.log("  --------------");
  console.log("  npm run harvest");
  console.log("    Scan feeds and build structure cards");
  console.log("");
  console.log("  npm run board");
  console.log("    Show latest structure cards (id, title, top take)");
  console.log("");
  console.log("  npm run compose -- --card 1 --platform LinkedIn");
  console.log("    Generate one draft from a selected card");
  console.log("");
  console.log("  npm run init");
  console.log("    Create local private config/prompt files");
  console.log("");
  console.log("  Optional init flags:");
  console.log("    --ai                 personalize local prompts with AI");
  console.log("    --copy               copy defaults only (no AI)");
  console.log("    --overwrite          replace existing local files");
  console.log("");
  console.log("  Optional compose flags:");
  console.log("    --take <index|text>      pick or override take");
  console.log("    --insight <index|text>   pick or override insight");
  console.log("    --angle <index|text>     pick or override angle");
  console.log("    --wireframe <index|text> pick or override wireframe seed");
  console.log("");
  console.log("  Typical flow:");
  console.log("    npm run harvest -> npm run board -> npm run compose -- --card 1 --platform LinkedIn");
  console.log("");
}

function runBoard() {
  const bundle = loadLatestHarvest();
  const cards = bundle.structures;

  cli.printStageStart("Structure Board");
  cli.printMessage(`Loaded ${cards.length} cards from latest harvest`, "muted");

  cards.forEach((card: StructureCard) => {
    const topTake = card.takeOptions[0] ?? card.thesis;
    const topInsight = card.insightOptions[0] ?? card.thesis;
    console.log("");
    console.log(`  [${card.id}] ${card.title}`);
    console.log(`      take: ${topTake}`);
    console.log(`      insight: ${topInsight}`);
  });

  console.log("");
  cli.printMessage("Compose from a card:", "muted");
  cli.printMessage("npm run compose -- --card <id> --platform LinkedIn", "muted");
}

function selectOption(options: string[], selector: string | undefined, fallback: string): string {
  if (!options.length) return fallback;
  if (!selector) return options[0];

  const asIndex = Number(selector);
  if (!Number.isNaN(asIndex)) {
    const index = asIndex - 1;
    if (index >= 0 && index < options.length) {
      return options[index];
    }
  }

  return selector;
}

async function runHarvest(date: string) {
  const context = readTextFile(CONFIG.FILES.CONTEXT);
  const sources = readTextFile(CONFIG.FILES.SOURCES)
    .split("\n")
    .map((source) => source.trim())
    .filter((source) => source && !source.startsWith("#"));

  const items = await fetchFeeds(sources);
  if (items.length === 0) {
    cli.printMessage("No new items. All caught up.", "success");
    return;
  }

  const filtered = await librarian(items, context);
  if (filtered.length === 0) {
    cli.printMessage("Nothing passed quality filter.", "success");
    return;
  }

  const researched = await researcher(filtered, context);

  let trends: Awaited<ReturnType<typeof trendSpotter>> = [];
  let concepts: Awaited<ReturnType<typeof editor>> = [];

  if (researched.length > 0) {
    cli.printMessage("Running parallel enrichment...", "muted");
    const [trendsResult, conceptsResult] = await Promise.allSettled([
      trendSpotter(researched, context),
      editor(researched, context),
    ]);

    trends = trendsResult.status === "fulfilled" ? trendsResult.value : [];
    concepts = conceptsResult.status === "fulfilled" ? conceptsResult.value : [];

    if (trendsResult.status === "rejected") {
      cli.printMessage("Trend analysis timed out and was skipped.", "muted");
    }
    if (conceptsResult.status === "rejected") {
      throw conceptsResult.reason;
    }
  }

  let wireframes: string[] = [];
  if (concepts.length > 0) {
    wireframes = await copywriter(concepts, researched, context);
  }

  const structures = buildStructureCards(concepts, researched, wireframes, trends);
  const outputDir = saveHarvestOutput(structures, trends, researched, date);

  const seen = getSeenUrls();
  items.forEach((item) => seen.add(item.link));
  saveSeenUrls(seen);

  const costStats = getCostStats();
  logCostsToFile(date);

  const stats = getCallStats();
  cli.printCompletion({
    feeds: sources.length,
    raw: items.length,
    selected: filtered.length,
    researched: researched.length,
    trends: trends.length,
    concepts: structures.length,
    drafts: 0,
    calls: stats.total,
    failed: stats.failed,
    duration: "harvest",
    cost: costStats.total,
    outputDir,
  });

  cli.printMessage("Next: npm run compose -- --card 1 --platform LinkedIn", "muted");
}

async function runCompose(date: string, flags: Record<string, string>) {
  const context = readTextFile(CONFIG.FILES.CONTEXT);
  const bundle = loadLatestHarvest();

  const cardId = Number(flags.card || "1");
  const card = bundle.structures.find((entry) => entry.id === cardId);
  if (!card) {
    throw new Error(`Card ${cardId} not found. Available cards: 1..${bundle.structures.length}`);
  }

  const platform = flags.platform || "LinkedIn";
  const selectedTake = selectOption(card.takeOptions, flags.take, card.thesis);
  const selectedInsight = selectOption(card.insightOptions, flags.insight, card.thesis);
  const selectedAngle = selectOption(card.angleOptions, flags.angle, card.transposabilityHint);
  const selectedWireframe = selectOption(card.wireframeOptions, flags.wireframe, "");

  const systemPrompt = [
    "You are writing a single practical social post draft.",
    "Keep it grounded, anti-hype, and builder-oriented.",
    "Use only provided references and context.",
    "Do not claim first-hand experience that is not explicitly in context.",
    "Return plain markdown only.",
  ].join("\n");

  const userMessage = [
    `CONTEXT:\n${context}`,
    `\nTARGET PLATFORM:\n${platform}`,
    `\nSTRUCTURE CARD:\n${JSON.stringify(card, null, 2)}`,
    `\nSELECTED TAKE:\n${selectedTake}`,
    `\nSELECTED INSIGHT:\n${selectedInsight}`,
    `\nSELECTED ANGLE:\n${selectedAngle}`,
    selectedWireframe ? `\nWIREFRAME SEED:\n${selectedWireframe}` : "",
    "\nINSTRUCTIONS:\nWrite one draft for the selected platform. Keep it concise, with clear thesis, practical insight, and one concrete next-step.",
  ]
    .filter(Boolean)
    .join("\n");

  const response = await callLLM({
    systemPrompt,
    userMessage,
    model: selectModel("advanced"),
    temperature: CONFIG.LLM.TEMPERATURE_CREATIVE,
    stage: "compose",
  });

  const outputDir = saveComposeOutput(response.content, {
    platform,
    cardId,
    selectedTake,
    selectedInsight,
  });

  const costStats = getCostStats();
  logCostsToFile(date);

  const stats = getCallStats();
  cli.printCompletion({
    feeds: 0,
    raw: 0,
    selected: 0,
    researched: bundle.items.length,
    trends: bundle.trends.length,
    concepts: bundle.structures.length,
    drafts: 1,
    calls: stats.total,
    failed: stats.failed,
    duration: "compose",
    cost: costStats.total,
    outputDir,
  });
}

async function main() {
  const parsed = parseArgs(process.argv.slice(2));
  const date = new Date().toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });

  cli.printHeader("GRIST", `${parsed.command.toUpperCase()} — ${date}`);

  if (parsed.command === "help") {
    printHelp();
    return;
  }

  if (parsed.command === "board") {
    runBoard();
    return;
  }

  if (parsed.command === "compose") {
    await runCompose(date, parsed.flags);
    return;
  }

  if (parsed.command === "init") {
    await runInit(parsed.flags);
    return;
  }

  await runHarvest(date);
}

main().catch((err: Error) => {
  cli.printError(`Pipeline failed: ${err.message}`);
  process.exit(1);
});
