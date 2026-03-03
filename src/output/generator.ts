import * as fs from "fs";
import * as path from "path";
import { CONFIG } from "../config";
import type { ResearchedItem, ContentConcept, Trend } from "../types";
import * as cli from "../cli";

export function generateOutput(
  wireframes: string[],
  drafts: string[],
  trends: Trend[],
  concepts: ContentConcept[],
  items: ResearchedItem[],
  date: string
): string {
  // Create timestamped output directory
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, -5);
  const outputDir = path.join(CONFIG.FILES.OUTPUT_DIR, timestamp);

  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  // Update "latest" symlink
  const latestLink = path.join(CONFIG.FILES.OUTPUT_DIR, "latest");
  try {
    if (fs.existsSync(latestLink)) {
      fs.unlinkSync(latestLink);
    }
    fs.symlinkSync(timestamp, latestLink);
  } catch {
    // Silently fail if symlinks aren't supported
  }

  // Main overview
  const overview = [
    `# GRIST Output — ${date}`,
    ``,
    `## Summary`,
    `- **Articles analyzed**: ${items.length}`,
    `- **Concepts generated**: ${concepts.length}`,
    `- **Wireframes**: ${wireframes.length}`,
    `- **Ready drafts**: ${drafts.length}`,
    `- **Trends spotted**: ${trends.length}`,
    ``,
    `## Platforms`,
    ...["X", "LinkedIn", "Blog"].map((p) => {
      const count = concepts.filter((c) => c.platform === p).length;
      return `- **${p}**: ${count} pieces`;
    }),
    ``,
    `---`,
    ``,
  ].join("\n");

  // Trends section
  let trendsSection = "";
  if (trends.length > 0) {
    trendsSection = [
      `## 📈 Trend Report`,
      ``,
      ...trends.map((t, i) => [
        `### Trend ${i + 1}: ${t.theme}`,
        `**Signal**: ${t.signal_strength} | **Articles**: ${t.articles.length}`,
        ``,
        `${t.narrative}`,
        ``,
        `**Tension**: ${t.tension}`,
        ``,
        `**Content Opportunities:**`,
        `- **X Thread**: ${t.content_opportunities.x_thread}`,
        `- **LinkedIn**: ${t.content_opportunities.linkedin}`,
        `- **Blog**: ${t.content_opportunities.blog}`,
        ``,
      ].join("\n")),
      `---`,
      ``,
    ].join("\n");
  }

  // Source digest
  const sourceDigest = [
    `## 📚 Source Digest`,
    ``,
    ...items.map((it, i) => [
      `### ${i + 1}. ${it.title}`,
      `**Source**: ${it.source} | **Score**: ${it.score}/10`,
      `**Link**: ${it.link}`,
      it.research?.thesis ? `**Thesis**: ${it.research.thesis}` : "",
      it.reason ? `**Why selected**: ${it.reason}` : "",
      ``,
    ].filter(Boolean).join("\n")),
    `---`,
    ``,
  ].join("\n");

  const fullOutput = [overview, trendsSection, sourceDigest].join("\n");
  fs.writeFileSync(path.join(outputDir, "overview.md"), fullOutput);

  // Wireframes
  if (wireframes.length > 0) {
    const wireframeOutput = `# 🏗️ Post Wireframes — ${date}\n\n` + wireframes.filter(Boolean).join("\n\n---\n\n");
    fs.writeFileSync(path.join(outputDir, "wireframes.md"), wireframeOutput);
  }

  // Drafts
  if (drafts.length > 0) {
    const draftsOutput = `# ✍️ Ready Drafts — ${date}\n\n` + drafts.filter(Boolean).join("\n\n---\n\n");
    fs.writeFileSync(path.join(outputDir, "drafts.md"), draftsOutput);
  }

  // Platform-specific files
  for (const platform of ["X", "LinkedIn", "Blog"]) {
    const platformConcepts = concepts
      .map((c, i) => ({ concept: c, wireframe: wireframes[i], draft: drafts[i] }))
      .filter((entry) => entry.concept.platform === platform);

    if (platformConcepts.length > 0) {
      const platformOutput = [
        `# ${platform} Content — ${date}`,
        ``,
        ...platformConcepts.map((entry, i) => {
          const parts = [
            `## ${i + 1}. ${entry.concept.take?.slice(0, 80) || "Untitled"}`,
            `**Format**: ${entry.concept.format || "Post"} | **Temperature**: ${entry.concept.temperature || "Warm"}`,
            ``,
          ];
          if (entry.draft) parts.push(`### Draft\n${entry.draft}`, ``);
          else if (entry.wireframe) parts.push(`### Wireframe\n${entry.wireframe}`, ``);
          parts.push(`---`, ``);
          return parts.join("\n");
        }),
      ].join("\n");
      fs.writeFileSync(path.join(outputDir, `${platform.toLowerCase()}.md`), platformOutput);
    }
  }

  cli.printMessage(`Output saved to ${timestamp}`, "success");
  cli.printMessage(`overview.md`);
  if (wireframes.length > 0) cli.printMessage(`wireframes.md`);
  if (drafts.length > 0) cli.printMessage(`drafts.md`);
  for (const platform of ["X", "LinkedIn", "Blog"]) {
    const count = concepts.filter((c) => c.platform === platform).length;
    if (count > 0) cli.printMessage(`${platform.toLowerCase()}.md`);
  }

  return outputDir;
}
