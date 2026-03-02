import * as fs from "fs";
import * as path from "path";
import { CONFIG } from "./config";
import { callLLM, hasOpenAIKey, selectModel } from "./llm";
import * as cli from "./cli";

type InitOptions = {
  useAI: boolean;
  overwrite: boolean;
};

type PromptEntry = {
  name: string;
  filePath: string;
};

function resolveWorkspacePath(relativePath: string): string {
  const candidates = [
    path.join(process.cwd(), relativePath),
    path.join(process.cwd(), "rss-filter", relativePath),
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  return candidates[0];
}

function ensureFileFromExample(targetRelative: string, exampleRelative: string, overwrite: boolean): "created" | "skipped" {
  const targetPath = resolveWorkspacePath(targetRelative);
  const examplePath = resolveWorkspacePath(exampleRelative);

  if (!fs.existsSync(examplePath)) {
    return "skipped";
  }

  if (fs.existsSync(targetPath) && !overwrite) {
    return "skipped";
  }

  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  fs.copyFileSync(examplePath, targetPath);
  return "created";
}

function getPromptEntries(): PromptEntry[] {
  return [
    { name: "librarian", filePath: CONFIG.FILES.PROMPTS.LIBRARIAN },
    { name: "researcher", filePath: CONFIG.FILES.PROMPTS.RESEARCHER },
    { name: "editor", filePath: CONFIG.FILES.PROMPTS.EDITOR },
    { name: "copywriter", filePath: CONFIG.FILES.PROMPTS.COPYWRITER },
    { name: "ghostwriter", filePath: CONFIG.FILES.PROMPTS.GHOSTWRITER },
    { name: "trend-spotter", filePath: CONFIG.FILES.PROMPTS.TREND_SPOTTER },
  ];
}

function localPromptPath(baseRelativePath: string): string {
  return baseRelativePath.replace(/\.txt$/, ".local.txt");
}

async function personalizePromptWithAI(promptName: string, basePrompt: string, context: string): Promise<string> {
  const systemPrompt = [
    "You personalize LLM system prompts for one specific user.",
    "Return plain text only (no markdown fences).",
    "Preserve required output contracts and schema keys exactly as-is.",
    "Do not change enum literals or JSON field names.",
    "Keep technical constraints and safety rules intact.",
  ].join("\n");

  const userMessage = [
    `PROMPT NAME: ${promptName}`,
    "",
    "USER CONTEXT:",
    context,
    "",
    "BASE PROMPT:",
    basePrompt,
    "",
    "TASK:",
    "Rewrite this prompt to better match the user context while preserving all strict contracts.",
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

export async function runInit(flags: Record<string, string>) {
  cli.printStageStart("Init project");

  const options: InitOptions = {
    useAI: flags.ai === "true" || (!flags.copy && hasOpenAIKey()),
    overwrite: flags.overwrite === "true",
  };

  const contextStatus = ensureFileFromExample(
    CONFIG.FILES.CONTEXT,
    "config/context.example.md",
    options.overwrite
  );
  const sourcesStatus = ensureFileFromExample(
    CONFIG.FILES.SOURCES,
    "config/rss_sources.example.txt",
    options.overwrite
  );

  cli.printResult("Context template", contextStatus === "created" ? 1 : 0, 1, contextStatus);
  cli.printResult("Sources template", sourcesStatus === "created" ? 1 : 0, 1, sourcesStatus);

  const contextPath = resolveWorkspacePath(CONFIG.FILES.CONTEXT);
  const contextText = fs.existsSync(contextPath) ? fs.readFileSync(contextPath, "utf-8") : "";
  const promptEntries = getPromptEntries();

  let created = 0;
  let skipped = 0;
  let personalized = 0;

  for (const entry of promptEntries) {
    const basePath = resolveWorkspacePath(entry.filePath);
    const localPath = resolveWorkspacePath(localPromptPath(entry.filePath));

    if (!fs.existsSync(basePath)) {
      skipped++;
      cli.printMessage(`Skipped ${entry.name}: base prompt not found`, "muted");
      continue;
    }

    if (fs.existsSync(localPath) && !options.overwrite) {
      skipped++;
      cli.printMessage(`Kept ${entry.name}.local.txt (already exists)`, "muted");
      continue;
    }

    const basePrompt = fs.readFileSync(basePath, "utf-8");
    let finalPrompt = basePrompt;

    if (options.useAI) {
      try {
        finalPrompt = await personalizePromptWithAI(entry.name, basePrompt, contextText || "No context provided yet.");
        personalized++;
      } catch {
        finalPrompt = basePrompt;
      }
    }

    fs.mkdirSync(path.dirname(localPath), { recursive: true });
    fs.writeFileSync(localPath, `${finalPrompt.trim()}\n`);
    created++;
    cli.printMessage(`Created ${path.basename(localPath)}`, "success");
  }

  cli.printResult("Local prompt overrides", created, promptEntries.length, `${personalized} personalized, ${skipped} skipped`);

  if (!options.useAI) {
    cli.printMessage("Tip: run `npm run init -- --ai --overwrite` to regenerate local prompts with AI.", "muted");
  }
}
