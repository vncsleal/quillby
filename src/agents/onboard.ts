import { getCurrentWorkspace } from "../workspaces.js";
import type { UserContext, TypedMemory } from "../types.js";

/**
 * Render the user context as a concise text block for LLM prompts.
 */
export function contextToPromptText(ctx: UserContext, typedMemory?: TypedMemory): string {
  const lines = [
    `Workspace: ${getCurrentWorkspace().name}`,
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

  if (!typedMemory) return lines;

  const blocks = [
    typedMemory.voiceExamples.length
      ? `\n\nVoice examples:\n${typedMemory.voiceExamples.map((e, i) => `[${i + 1}] ${e}`).join("\n\n")}`
      : "",
    typedMemory.styleRules.length
      ? `\n\nStyle rules:\n${typedMemory.styleRules.map((e, i) => `[${i + 1}] ${e}`).join("\n")}`
      : "",
    typedMemory.audienceInsights.length
      ? `\n\nAudience insights:\n${typedMemory.audienceInsights.map((e, i) => `[${i + 1}] ${e}`).join("\n")}`
      : "",
    typedMemory.doNotSay.length
      ? `\n\nDo not say:\n${typedMemory.doNotSay.map((e, i) => `[${i + 1}] ${e}`).join("\n")}`
      : "",
    typedMemory.campaignContext.length
      ? `\n\nCampaign context:\n${typedMemory.campaignContext.map((e, i) => `[${i + 1}] ${e}`).join("\n")}`
      : "",
    typedMemory.sourcePreferences.length
      ? `\n\nSource preferences:\n${typedMemory.sourcePreferences.map((e, i) => `[${i + 1}] ${e}`).join("\n")}`
      : "",
  ].join("");

  return lines + blocks;
}

export const ONBOARDING_PROMPT = `You are helping a new Quillby user set up the content intelligence profile for their current Quillby workspace.

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
Once you have their answers, call the \`quillby_set_context\` tool with the structured data for the current workspace. After saving, let them know the workspace profile is ready and suggest:
- Running \`quillby_add_feeds\` to add relevant RSS sources.
- Using \`quillby_remember\` to add example posts that define their voice — these accumulate in workspace memory and improve every post Quillby generates there.`;
