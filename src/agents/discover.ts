import * as fs from "fs";
import * as path from "path";
import { CONFIG, readTextFile } from "../config.js";

const SOURCES_FILE = path.join(process.cwd(), CONFIG.FILES.SOURCES);

/**
 * Load current RSS sources from file. Returns empty array if file missing.
 */
export function loadSources(): string[] {
  try {
    return readTextFile(CONFIG.FILES.SOURCES)
      .split("\n")
      .map((s) => s.trim())
      .filter((s) => s && !s.startsWith("#"));
  } catch {
    return [];
  }
}

/**
 * Append new feed URLs to the sources file, deduplicating against existing entries.
 */
export function appendSources(newUrls: string[]): { added: number; skipped: number } {
  const existing = new Set(loadSources());
  const toAdd = newUrls.filter((u) => u.trim() && !existing.has(u.trim()));

  if (toAdd.length === 0) return { added: 0, skipped: newUrls.length };

  const header = !fs.existsSync(SOURCES_FILE)
    ? "# GRIST RSS Sources\n\n"
    : "";

  fs.appendFileSync(SOURCES_FILE, header + toAdd.join("\n") + "\n");

  return { added: toAdd.length, skipped: newUrls.length - toAdd.length };
}

/**
 * Replace the entire sources file with a new list.
 */
export function replaceSources(urls: string[]): void {
  const unique = [...new Set(urls.map((u) => u.trim()).filter(Boolean))];
  fs.writeFileSync(SOURCES_FILE, "# GRIST RSS Sources\n\n" + unique.join("\n") + "\n");
}

