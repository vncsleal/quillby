import * as fs from "fs";
import * as path from "path";
import * as readline from "readline";
import { CONFIG } from "./config";
import { callLLM, hasOpenAIKey, selectModel } from "./llm";
import { fetchURL, extractTextFromHTML } from "./extractors/content";
import { getCostStats } from "./costs";
import * as cli from "./cli";

type PromptEntry = {
  name: string;
  filePath: string;
};

// ─── Path helpers ────────────────────────────────────────────────────────────

function resolveWorkspacePath(relativePath: string): string {
  const candidates = [
    path.join(process.cwd(), relativePath),
    path.join(process.cwd(), "rss-filter", relativePath),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return candidates[0];
}

function localPromptPath(baseRelativePath: string): string {
  return baseRelativePath.replace(/\.txt$/, ".local.txt");
}

function getPromptEntries(): PromptEntry[] {
  return [
    { name: "librarian",    filePath: CONFIG.FILES.PROMPTS.LIBRARIAN },
    { name: "researcher",   filePath: CONFIG.FILES.PROMPTS.RESEARCHER },
    { name: "editor",       filePath: CONFIG.FILES.PROMPTS.EDITOR },
    { name: "copywriter",   filePath: CONFIG.FILES.PROMPTS.COPYWRITER },
    { name: "ghostwriter",  filePath: CONFIG.FILES.PROMPTS.GHOSTWRITER },
    { name: "trend-spotter",filePath: CONFIG.FILES.PROMPTS.TREND_SPOTTER },
  ];
}

// ─── Readline helpers ─────────────────────────────────────────────────────────

function createRL(): readline.Interface {
  return readline.createInterface({ input: process.stdin, output: process.stdout });
}

function ask(rl: readline.Interface, question: string): Promise<string> {
  return new Promise((resolve) => rl.question(`\n  ${question}\n  > `, (a) => resolve(a.trim())));
}

function confirm(rl: readline.Interface, question: string): Promise<boolean> {
  return new Promise((resolve) =>
    rl.question(`\n  ${question} (y/n) `, (a) => resolve(a.trim().toLowerCase() === "y"))
  );
}

// ─── Writing sample fetching ──────────────────────────────────────────────────

async function fetchWritingSamples(urls: string[]): Promise<string> {
  const samples: string[] = [];
  for (const url of urls) {
    if (!url) continue;
    cli.startSpinner(`Fetching ${url}`);
    try {
      const html = await fetchURL(url.trim());
      const text = extractTextFromHTML(html).slice(0, 3000);
      if (text.length > 200) samples.push(`--- Sample from ${url} ---\n${text}`);
    } catch {
      // silent — writing samples are best-effort
    } finally {
      cli.stopSpinner();
    }
  }
  return samples.join("\n\n");
}

// ─── LLM: build context.md ───────────────────────────────────────────────────

async function generateContextMd(answers: Record<string, string>, writingSamples: string): Promise<string> {
  const systemPrompt = [
    "You generate a detailed identity and voice context file for a content pipeline.",
    "The file is used to personalize AI agents that filter news, research articles, and draft content.",
    "Output must be plain markdown — no fences, no preamble.",
    "Be extremely specific about voice patterns. Generic descriptions are useless.",
    "VOICE ONLY — Oversteer on tone, writing style, signature phrases, and banned constructions: the model regresses to the mean, so push hard here.",
    "Extract exact recurring phrases, sentence length patterns, structural habits, and things the user never does.",
    "If writing samples are provided, they are the ground truth for voice — prioritize them over self-description.",
    "FACTUAL AREAS — Be strictly literal. Do NOT infer, extrapolate, or pad.",
    "Stack I Use Daily must list ONLY tools the user actually stated — no aspirational additions, no adjacent tools.",
    "Content Themes must reflect ONLY what the user said they read or skip — do not supplement with related topics.",
  ].join("\n");

  const userMessage = [
    "Build a comprehensive context.md for this user.",
    "",
    "USER ANSWERS:",
    Object.entries(answers).map(([q, a]) => `${q}: ${a}`).join("\n"),
    "",
    writingSamples ? `WRITING SAMPLES (ground truth for voice):\n${writingSamples}` : "No writing samples provided.",
    "",
    "REQUIRED SECTIONS:",
    "# Identity & Voice",
    "## Who I Am (name, role, location, philosophy in 1-2 sentences)",
    "## Core Beliefs (3-5 bullet points — specific, opinionated)",
    "## What I've Built (first-hand experience only — systems, tools, products)",
    "## Stack I Use Daily (concrete, no aspirational tools)",
    "## Content Themes (what always gets attention, what gets skipped — be specific)",
    "## Writing Style (platform-specific: sentence length, rhythm, vocabulary, recurring patterns, banned constructions)",
    "## Signature Patterns (exact phrases and structural habits extracted from writing samples)",
    "## BANNED (specific words and constructions to never use — the more specific the better)",
    "",
    "Output only the markdown content.",
  ].join("\n");

  const response = await callLLM({
    systemPrompt,
    userMessage,
    model: selectModel("advanced"),
    temperature: 0.3,
    stage: "init",
  });

  return response.content.trim();
}

// ─── LLM: generate RSS seed list ─────────────────────────────────────────────

async function generateRssSeed(stack: string, topics: string): Promise<string> {
  const systemPrompt = [
    "You suggest RSS feed URLs for a developer based on their stack and content interests.",
    "Return only a plain text list: one URL per line, real and working feeds only.",
    "Add a short inline comment after each URL: # what it covers",
    "No preamble, no markdown headers, no fences.",
    "Aim for 10-14 feeds. Quality over quantity.",
  ].join("\n");

  const userMessage = `Stack: ${stack}\n\nTopics of interest: ${topics}\n\nSuggest RSS feeds.`;

  const response = await callLLM({
    systemPrompt,
    userMessage,
    model: selectModel("standard"),
    temperature: 0.3,
    stage: "init",
  });

  return response.content.trim();
}

// ─── LLM: personalize a single prompt ────────────────────────────────────────

async function personalizePrompt(name: string, basePrompt: string, context: string): Promise<string> {
  const systemPrompt = [
    "You personalize LLM system prompts for one specific user.",
    "Return plain text only — no markdown fences.",
    "Preserve ALL output contracts, JSON field names, and enum literals exactly as-is.",
    "Keep all technical constraints intact.",
    "Aggressively incorporate the user's voice patterns, banned words, signature phrases, and sentence rhythms.",
    "VOICE ONLY — Oversteer on tone and writing style: push hard, the model will self-moderate.",
    "The goal is that output sounds like this specific person wrote it — they may be a developer, designer, lawyer, engineer, or anything else.",
    "FACTUAL AREAS — Be strictly literal. Do NOT add, infer, or upgrade stack, topics, or interests beyond what the context explicitly states.",
    "Any 'boost' or 'add-on' signal examples in the base prompt are PLACEHOLDERS. Replace them entirely with examples derived from the user's actual stack and content themes.",
    "If the user's domain has nothing to do with the placeholder examples (e.g. they are not a developer), remove those sections or rewrite them to fit their actual domain.",
  ].join("\n");

  const userMessage = [
    `PROMPT NAME: ${name}`,
    "",
    "USER CONTEXT:",
    context,
    "",
    "BASE PROMPT:",
    basePrompt,
    "",
    "Rewrite this prompt to deeply match the user's voice and interests.",
    "Only output the final prompt text.",
  ].join("\n");

  const response = await callLLM({
    systemPrompt,
    userMessage,
    model: selectModel("advanced"),
    temperature: 0.4,
    stage: "init",
  });

  return response.content.trim();
}

// ─── Fallback: copy templates ─────────────────────────────────────────────────

function copyTemplate(targetRelative: string, exampleRelative: string): "created" | "skipped" {
  const targetPath = resolveWorkspacePath(targetRelative);
  const examplePath = resolveWorkspacePath(exampleRelative);
  if (!fs.existsSync(examplePath)) return "skipped";
  if (fs.existsSync(targetPath)) return "skipped";
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  fs.copyFileSync(examplePath, targetPath);
  return "created";
}

// ─── Main ─────────────────────────────────────────────────────────────────────

export async function runInit(_flags: Record<string, string>) {
  const contextPath = resolveWorkspacePath(CONFIG.FILES.CONTEXT);
  const sourcesPath = resolveWorkspacePath(CONFIG.FILES.SOURCES);
  const alreadyInitialized = fs.existsSync(contextPath);

  // ── No API key: fallback path ───────────────────────────────────────────────
  if (!hasOpenAIKey()) {
    cli.printStageStart("No OpenAI key found — copying templates");
    const ctxStatus = copyTemplate(CONFIG.FILES.CONTEXT, "config/context.example.md");
    const srcStatus = copyTemplate(CONFIG.FILES.SOURCES, "config/rss_sources.example.txt");
    cli.printResult("context.md", ctxStatus === "created" ? 1 : 0, 1, ctxStatus);
    cli.printResult("rss_sources.txt", srcStatus === "created" ? 1 : 0, 1, srcStatus);
    console.log("");
    cli.printMessage("Next steps:", "info");
    cli.printMessage("1. Fill in config/context.md with your identity, stack, and writing style", "muted");
    cli.printMessage("2. Add your RSS feeds to config/rss_sources.txt", "muted");
    cli.printMessage("3. Set OPENAI_API_KEY in .env and re-run `npm run init` for AI personalization", "muted");
    return;
  }

  // ── AI path ─────────────────────────────────────────────────────────────────
  let rlClosed = false;
  const rl = createRL();

  try {
    // Re-run detection
    if (alreadyInitialized) {
      cli.printMessage("context.md already exists.", "muted");
      const redo = await confirm(rl, "Re-run personalization with current context.md? (skips interview)");
      if (redo) {
        rl.close(); rlClosed = true;
        await personalizeAllPrompts(contextPath, 0, false);
        return;
      }
      const reinterview = await confirm(rl, "Start fresh interview and rebuild context.md?");
      if (!reinterview) {
        cli.printMessage("Nothing changed.", "muted");
        rl.close(); rlClosed = true;
        return;
      }
    }

    cli.printStageStart("Interview");
    cli.printMessage("The more specific your answers, the less your content will sound like everyone else's.", "muted");
    cli.printMessage("Writing samples are the highest-value input — paste URLs if you have them.", "muted");

    // Phase 1 — Structured questions
    const name      = await ask(rl, "Your name and what you build (one sentence):");
    const stack     = await ask(rl, "Your daily stack — what you actually ship with (not aspirational):");
    const alwaysRead = await ask(rl, "Topics you always read — be specific (e.g. 'incident retrospectives, LLM pipelines, A/B testing infra'):");
    const alwaysSkip = await ask(rl, "Topics you always skip (e.g. 'funding rounds, beginner tutorials, hype without technical depth'):");
    const tone      = await ask(rl, "Your writing tone in one sentence (how would a colleague describe how you write?):");

    // Phase 2 — Writing samples
    cli.printMessage("\n  Writing samples: paste 1-3 URLs to things you've written.", "info");
    cli.printMessage("  Blog posts, LinkedIn, GitHub READMEs — anything in your voice.", "muted");
    cli.printMessage("  Press Enter to skip if you have nothing ready.", "muted");
    const url1 = await ask(rl, "URL 1 (or Enter to skip):");
    const url2 = url1 ? await ask(rl, "URL 2 (or Enter to skip):") : "";
    const url3 = url2 ? await ask(rl, "URL 3 (or Enter to skip):") : "";

    rl.close(); rlClosed = true;

    const sampleUrls = [url1, url2, url3].filter(Boolean);
    let writingSamples = "";

    if (sampleUrls.length > 0) {
      cli.printStageStart("Fetching writing samples");
      writingSamples = await fetchWritingSamples(sampleUrls);
      cli.printResult("Samples fetched", writingSamples.length > 0 ? sampleUrls.length : 0, sampleUrls.length);
    }

    // Phase 3 — Generate context.md
    cli.printStageStart("Building context.md");
    cli.startSpinner("Generating your identity and voice profile...");

    const answers = { name, stack, "always-read": alwaysRead, "always-skip": alwaysSkip, tone };
    const contextMd = await generateContextMd(answers, writingSamples);
    cli.stopSpinner();

    // Preview
    cli.printSection("context.md preview");
    const preview = contextMd.slice(0, 800) + (contextMd.length > 800 ? "\n\n  … (truncated)" : "");
    preview.split("\n").forEach((line) => cli.printMessage(line, "muted"));
    console.log("");

    // Write context.md
    fs.mkdirSync(path.dirname(contextPath), { recursive: true });
    fs.writeFileSync(contextPath, contextMd + "\n");
    cli.printResult("context.md written", 1, 1);

    // Phase 4 — RSS seed
    cli.printStageStart("Generating RSS starter list");
    cli.startSpinner("Suggesting feeds based on your stack and interests...");
    const rssSeedText = await generateRssSeed(stack, alwaysRead);
    cli.stopSpinner();

    let rssSeedWritten = false;
    if (rssSeedText && !fs.existsSync(sourcesPath)) {
      fs.mkdirSync(path.dirname(sourcesPath), { recursive: true });
      fs.writeFileSync(sourcesPath, rssSeedText + "\n");
      rssSeedWritten = true;
      cli.printResult("rss_sources.txt written", 1, 1, "starter list — edit to add your own");
    } else {
      cli.printMessage("rss_sources.txt already exists — skipped", "muted");
    }

    // Phase 5 — Personalize prompts
    await personalizeAllPrompts(contextPath, sampleUrls.length, rssSeedWritten);

  } finally {
    if (!rlClosed) { rl.close(); rlClosed = true; }
  }
}

async function personalizeAllPrompts(
  contextPath: string,
  writingSamplesCount = 0,
  rssSeed = false,
) {
  cli.printStageStart("Personalizing agents");
  cli.printMessage("Oversteering on voice — the model moderates itself.", "muted");

  const contextText = fs.existsSync(contextPath) ? fs.readFileSync(contextPath, "utf-8") : "";
  const promptEntries = getPromptEntries();
  let personalized = 0;
  let failed = 0;
  const start = Date.now();

  for (const entry of promptEntries) {
    const basePath = resolveWorkspacePath(entry.filePath);
    const localPath = resolveWorkspacePath(localPromptPath(entry.filePath));

    if (!fs.existsSync(basePath)) {
      cli.printMessage(`Skipped ${entry.name} — base prompt not found`, "muted");
      continue;
    }

    cli.startSpinner(`Personalizing ${entry.name}...`);
    const basePrompt = fs.readFileSync(basePath, "utf-8");

    try {
      const personalized_prompt = await personalizePrompt(entry.name, basePrompt, contextText);
      fs.mkdirSync(path.dirname(localPath), { recursive: true });
      fs.writeFileSync(localPath, personalized_prompt + "\n");
      personalized++;
      cli.stopSpinner();
      cli.printMessage(`${entry.name}.local.txt`, "success");
    } catch {
      cli.stopSpinner();
      failed++;
      cli.printMessage(`${entry.name} — failed, using base prompt`, "muted");
      fs.writeFileSync(localPath, fs.readFileSync(basePath, "utf-8"));
    }
  }

  const duration = ((Date.now() - start) / 1000).toFixed(1) + "s";
  const costStats = getCostStats();

  cli.printInitCompletion({
    agentsPersonalized: personalized,
    agentsTotal: promptEntries.length,
    failed,
    writingSamples: writingSamplesCount,
    rssSeed,
    duration,
    cost: costStats.total,
  });

  cli.printMessage("Run `npm run harvest` to start.", "success");
}
