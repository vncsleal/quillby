/**
 * Unit tests for preScoreArticles (src/agents/harvest.ts)
 *
 * This is a pure function — no network calls, no filesystem I/O.
 */
import { describe, it, expect } from "vitest";
import { preScoreArticles } from "../../src/agents/harvest.js";

// ─── Fixture ───────────────────────────────────────────────────────────────────

type MinArticle = { title: string; snippet: string; link: string };

function makeArticle(title: string, snippet = ""): MinArticle {
  return { title, snippet, link: `https://example.com/${encodeURIComponent(title)}` };
}

// ─── Tests ─────────────────────────────────────────────────────────────────────

describe("preScoreArticles", () => {
  it("returns all articles with _preScore: 0 when topics are empty", () => {
    const articles = [makeArticle("AI agents are here"), makeArticle("Pasta carbonara recipe")];
    const scored = preScoreArticles(articles, []);
    expect(scored).toHaveLength(2);
    expect(scored.every((a) => a._preScore === 0)).toBe(true);
  });

  it("returns all articles when topics are all empty strings", () => {
    const articles = [makeArticle("Some article")];
    const scored = preScoreArticles(articles, ["", "  "]);
    expect(scored).toHaveLength(1);
    expect(scored[0]._preScore).toBe(0);
  });

  it("scores an article higher when its title contains a topic keyword", () => {
    const articles = [
      makeArticle("OpenAI releases new LLM framework"),
      makeArticle("Best pasta recipes"),
    ];
    const scored = preScoreArticles(articles, ["LLM"]);
    const llmArticle = scored.find((a) => a.title.includes("LLM"))!;
    const pastaArticle = scored.find((a) => a.title.includes("pasta"))!;
    expect(llmArticle._preScore).toBeGreaterThan(pastaArticle._preScore);
  });

  it("accumulates score for multiple matching keywords", () => {
    const articles = [
      makeArticle("AI and LLM agents are transforming dev tools"),
      makeArticle("AI summary"),
    ];
    const scored = preScoreArticles(articles, ["AI", "LLM", "agents"]);
    const highScored = scored.find((a) => a.title.includes("transforming"))!;
    const lowScored = scored.find((a) => a.title === "AI summary")!;
    expect(highScored._preScore).toBe(3); // AI + LLM + agents
    expect(lowScored._preScore).toBe(1); // AI only
  });

  it("matches keywords in the snippet as well as the title", () => {
    const articles = [
      { title: "Weekly roundup", snippet: "Covers LLM advancements", link: "https://x.com/1" },
      { title: "Weekly roundup", snippet: "Nothing relevant", link: "https://x.com/2" },
    ];
    const scored = preScoreArticles(articles, ["llm"]);
    const snippetMatch = scored.find((a) => a.snippet.includes("LLM"))!;
    const noMatch = scored.find((a) => a.snippet === "Nothing relevant")!;
    expect(snippetMatch._preScore).toBe(1);
    expect(noMatch._preScore).toBe(0);
  });

  it("is case-insensitive for both topics and article text", () => {
    const articles = [makeArticle("OPENAI Releases GPT-5")];
    const scored = preScoreArticles(articles, ["openai"]);
    expect(scored[0]._preScore).toBe(1);
  });

  it("returns articles sorted descending by score", () => {
    const articles = [
      makeArticle("Unrelated article"),
      makeArticle("AI agents and LLM tools"),
      makeArticle("AI only"),
    ];
    const scored = preScoreArticles(articles, ["ai", "llm", "agents"]);
    expect(scored[0]._preScore).toBeGreaterThanOrEqual(scored[1]._preScore);
    expect(scored[1]._preScore).toBeGreaterThanOrEqual(scored[2]._preScore);
  });

  it("keeps zero-scored articles at the end (not dropped)", () => {
    const articles = [
      makeArticle("AI and machine learning"),
      makeArticle("Cooking with love"),
      makeArticle("Sports weekend recap"),
    ];
    const scored = preScoreArticles(articles, ["AI"]);
    expect(scored).toHaveLength(3);
    expect(scored[scored.length - 1]._preScore).toBe(0);
  });

  it("handles a single article", () => {
    const scored = preScoreArticles([makeArticle("AI breakthrough")], ["AI"]);
    expect(scored).toHaveLength(1);
    expect(scored[0]._preScore).toBe(1);
  });

  it("handles an empty article array", () => {
    const scored = preScoreArticles([], ["AI", "LLM"]);
    expect(scored).toHaveLength(0);
  });

  it("trims whitespace from topic keywords", () => {
    const articles = [makeArticle("AI is here")];
    const scored = preScoreArticles(articles, ["  AI  "]);
    expect(scored[0]._preScore).toBe(1);
  });
});
