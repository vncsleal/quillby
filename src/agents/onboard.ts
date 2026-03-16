import * as fs from "fs";
import * as path from "path";
import { CONFIG, ensureDir } from "../config.js";
import { UserContextSchema, type UserContext } from "../types.js";

const CONTEXT_FILE = path.join(process.cwd(), CONFIG.FILES.CONTEXT);

export function contextExists(): boolean {
  return fs.existsSync(CONTEXT_FILE);
}

export function loadContext(): UserContext | null {
  if (!fs.existsSync(CONTEXT_FILE)) return null;
  try {
    const raw = JSON.parse(fs.readFileSync(CONTEXT_FILE, "utf-8"));
    return UserContextSchema.parse(raw);
  } catch {
    return null;
  }
}

export function saveContext(ctx: UserContext): void {
  ensureDir(path.dirname(CONTEXT_FILE));
  const validated = UserContextSchema.parse(ctx);
  fs.writeFileSync(CONTEXT_FILE, JSON.stringify(validated, null, 2));
}

/**
 * Render the user context as a concise text block for LLM system prompts.
 */
export function contextToPromptText(ctx: UserContext): string {
  const lines = [
    ctx.name ? `Name: ${ctx.name}` : null,
    `Role: ${ctx.role}`,
    `Industry: ${ctx.industry}`,
    `Topics: ${ctx.topics.join(", ")}`,
    `Voice: ${ctx.voice}`,
    `Audience: ${ctx.audienceDescription}`,
    `Goals: ${ctx.contentGoals.join(", ")}`,
    ctx.excludeTopics?.length ? `Avoid: ${ctx.excludeTopics.join(", ")}` : null,
    `Platforms: ${ctx.platforms.join(", ")}`,
  ]
    .filter(Boolean)
    .join("\n");

  const examples =
    ctx.voiceExamples?.length
      ? `\n\nVoice examples:\n${ctx.voiceExamples.map((e, i) => `[${i + 1}] ${e}`).join("\n\n")}`
      : "";

  return lines + examples;
}

/** The onboarding prompt text — used as an MCP prompt. */
export const ONBOARDING_PROMPT = `You are helping a new GRIST user set up their content intelligence profile.

Ask the following questions conversationally — you don't need to number them or ask them all at once. Use natural follow-up based on their answers.

Questions to cover:
1. What is your name and professional role?
2. What industry or niche are you in?
3. What topics are you most passionate about writing on? (aim for 3–8 topics)
4. How would you describe your writing voice and style? (e.g., "direct, no-fluff, analytical" or "warm, story-driven, practitioner-focused")
5. Who is your target audience?
6. What are your content goals? (e.g., thought leadership, personal brand, lead generation, community building)
7. Are there any topics you want to avoid in your content?
8. Which platforms do you publish on? (LinkedIn, X/Twitter, blog, newsletter, Medium, etc.)
9. Can you share 1–3 example posts or pieces of writing that represent your voice well?

Once you have their answers, call the \`grist_set_context\` tool with the structured data. After saving, let them know their profile is ready and suggest running \`grist_add_feeds\` to add relevant RSS sources.`;
