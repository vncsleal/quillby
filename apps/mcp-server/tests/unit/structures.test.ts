/**
 * Unit tests for src/output/structures.ts
 *
 * All tests run in a temporary directory to keep the real project tree clean.
 * beforeEach creates a temp dir and chdir into it; afterEach restores cwd.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import {
  saveHarvestOutput,
  loadLatestHarvest,
  latestHarvestExists,
} from "../../src/output/structures.js";
import { CardInputSchema, type CardInput } from "../../src/types.js";
import { getWorkspacePaths } from "../../src/workspaces.js";

// ─── Fixtures ──────────────────────────────────────────────────────────────────

function makeCard(overrides: Partial<CardInput> = {}): CardInput {
  return CardInputSchema.parse({
    title: "Test Article",
    source: "example.com",
    link: "https://example.com/article",
    thesis: "A test thesis.",
    relevanceScore: 7,
    relevanceReason: "Relevant to AI",
    keyInsights: ["Insight one", "Insight two"],
    trendTags: ["ai", "llm"],
    takeOptions: ["Take A"],
    angleOptions: ["Angle A", "Angle B"],
    hookOptions: ["Hook A"],
    transposabilityHint: "Works for startups.",
    ...overrides,
  });
}

// ─── Temp-dir isolation ────────────────────────────────────────────────────────

let tempDir: string;
let originalCwd: string;

beforeEach(() => {
  originalCwd = process.cwd();
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "quillby-test-"));
  process.env.QUILLBY_HOME = tempDir;
  process.chdir(tempDir);
});

afterEach(() => {
  delete process.env.QUILLBY_HOME;
  process.chdir(originalCwd);
  fs.rmSync(tempDir, { recursive: true, force: true });
});

// ─── latestHarvestExists ────────────────────────────────────────────────────────

describe("latestHarvestExists", () => {
  it("returns false when no harvest has been saved", () => {
    expect(latestHarvestExists()).toBe(false);
  });

  it("returns true after saveHarvestOutput is called", () => {
    saveHarvestOutput([makeCard()], new Set());
    expect(latestHarvestExists()).toBe(true);
  });
});

// ─── saveHarvestOutput ─────────────────────────────────────────────────────────

describe("saveHarvestOutput", () => {
  it("creates a timestamped output directory", () => {
    const outputDir = saveHarvestOutput([makeCard()], new Set());
    expect(fs.existsSync(outputDir)).toBe(true);
    expect(outputDir).toMatch(/output[/\\]\d{4}-\d{2}-\d{2}/);
  });

  it("writes structures.json inside the output dir", () => {
    const outputDir = saveHarvestOutput([makeCard()], new Set());
    const jsonPath = path.join(outputDir, "structures.json");
    expect(fs.existsSync(jsonPath)).toBe(true);
  });

  it("writes structures.md inside the output dir", () => {
    const outputDir = saveHarvestOutput([makeCard()], new Set());
    const mdPath = path.join(outputDir, "structures.md");
    expect(fs.existsSync(mdPath)).toBe(true);
  });

  it("writes a valid HarvestBundle JSON with correct card count", () => {
    const cards = [makeCard({ title: "Card A" }), makeCard({ title: "Card B" })];
    const outputDir = saveHarvestOutput(cards, new Set());
    const bundle = JSON.parse(
      fs.readFileSync(path.join(outputDir, "structures.json"), "utf-8"),
    );
    expect(bundle.cards).toHaveLength(2);
    expect(bundle.cards[0].title).toBe("Card A");
    expect(bundle.cards[1].title).toBe("Card B");
  });

  it("assigns sequential 1-based IDs to cards", () => {
    const outputDir = saveHarvestOutput(
      [makeCard(), makeCard(), makeCard()],
      new Set(),
    );
    const bundle = JSON.parse(
      fs.readFileSync(path.join(outputDir, "structures.json"), "utf-8"),
    );
    expect(bundle.cards.map((c: { id: number }) => c.id)).toEqual([1, 2, 3]);
  });

  it("writes the latest harvest pointer file", () => {
    saveHarvestOutput([makeCard()], new Set());
    const pointer = getWorkspacePaths("default").latestHarvestPointer;
    expect(fs.existsSync(pointer)).toBe(true);
    const pointerValue = fs.readFileSync(pointer, "utf-8").trim();
    expect(pointerValue).toMatch(/structures\.json$/);
  });

  it("handles an empty card array", () => {
    const outputDir = saveHarvestOutput([], new Set());
    const bundle = JSON.parse(
      fs.readFileSync(path.join(outputDir, "structures.json"), "utf-8"),
    );
    expect(bundle.cards).toHaveLength(0);
  });

  it("structures.md includes card titles", () => {
    const outputDir = saveHarvestOutput(
      [makeCard({ title: "Unique Title XYZ" })],
      new Set(),
    );
    const md = fs.readFileSync(path.join(outputDir, "structures.md"), "utf-8");
    expect(md).toContain("Unique Title XYZ");
  });
});

// ─── loadLatestHarvest ──────────────────────────────────────────────────────────

describe("loadLatestHarvest", () => {
  it("throws if no harvest has been saved", () => {
    expect(() => loadLatestHarvest()).toThrow(/No harvest found/);
  });

  it("returns a valid HarvestBundle after saveHarvestOutput", () => {
    const cards = [makeCard({ title: "Loaded Card" })];
    saveHarvestOutput(cards, new Set());

    const bundle = loadLatestHarvest();
    expect(bundle.cards).toHaveLength(1);
    expect(bundle.cards[0].title).toBe("Loaded Card");
    expect(bundle.generatedAt).toBeTruthy();
    expect(bundle.dateLabel).toBeTruthy();
  });

  it("round-trips all card fields through JSON", () => {
    const original = makeCard({
      title: "Round-trip Card",
      keyInsights: ["A", "B"],
      trendTags: ["x", "y"],
      thesis: "Detailed thesis here.",
    });
    saveHarvestOutput([original], new Set());
    const bundle = loadLatestHarvest();
    const card = bundle.cards[0];
    expect(card.title).toBe("Round-trip Card");
    expect(card.keyInsights).toEqual(["A", "B"]);
    expect(card.trendTags).toEqual(["x", "y"]);
  });

  it("throws with clear message when pointer points to missing file", () => {
    saveHarvestOutput([makeCard()], new Set());
    // Corrupt the pointer
    fs.writeFileSync(getWorkspacePaths("default").latestHarvestPointer, "/nonexistent/path.json");
    expect(() => loadLatestHarvest()).toThrow(/invalid|Re-run/i);
  });
});
