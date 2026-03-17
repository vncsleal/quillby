import { describe, it, expect, beforeEach } from "vitest";
import {
  getPreferredPatterns,
  feedbackSummary,
  type FeedbackRecord,
} from "../../src/output/feedback.js";

// ─── Fixtures ──────────────────────────────────────────────────────────────────

function makeCard(overrides: Partial<FeedbackRecord> = {}): FeedbackRecord {
  return {
    id: "test-id",
    timestamp: "2026-01-01T10:00:00.000Z",
    type: "card",
    rating: 5,
    topics: ["AI", "developer tools"],
    trendTags: ["llm", "agents"],
    usedAngle: "The cost nobody talks about",
    usedHook: "Agents are eating software budgets.",
    ...overrides,
  };
}

function makePost(overrides: Partial<FeedbackRecord> = {}): FeedbackRecord {
  return {
    id: "post-id",
    timestamp: "2026-01-02T10:00:00.000Z",
    type: "post",
    rating: 5,
    platform: "linkedin",
    postContent: "Agents aren't replacing engineers. They're creating new toil.",
    topics: ["AI", "startups"],
    trendTags: ["llm", "automation"],
    ...overrides,
  };
}

// ─── getPreferredPatterns ──────────────────────────────────────────────────────

describe("getPreferredPatterns", () => {
  it("returns empty patterns for empty input", () => {
    const p = getPreferredPatterns([]);
    expect(p.topics).toEqual([]);
    expect(p.trendTags).toEqual([]);
    expect(p.angles).toEqual([]);
    expect(p.hooks).toEqual([]);
    expect(p.voiceExamples).toEqual([]);
  });

  it("ignores records with rating < 4", () => {
    const low = [
      makeCard({ rating: 1, topics: ["crypto"] }),
      makeCard({ rating: 3, topics: ["web3"] }),
    ];
    const p = getPreferredPatterns(low);
    expect(p.topics).toEqual([]);
  });

  it("collects topics from high-rated records only", () => {
    const records = [
      makeCard({ rating: 5, topics: ["AI", "SaaS"] }),
      makeCard({ rating: 5, topics: ["AI", "developer tools"] }),
      makeCard({ rating: 2, topics: ["crypto"] }),
    ];
    const p = getPreferredPatterns(records);
    expect(p.topics[0]).toBe("AI"); // highest frequency
    expect(p.topics).not.toContain("crypto");
  });

  it("ranks trendTags by frequency", () => {
    const records = [
      makeCard({ rating: 4, trendTags: ["llm", "agents"] }),
      makeCard({ rating: 5, trendTags: ["llm", "agents", "automation"] }),
      makeCard({ rating: 5, trendTags: ["llm"] }),
    ];
    const p = getPreferredPatterns(records);
    expect(p.trendTags[0]).toBe("llm"); // 3 occurrences
    expect(p.trendTags[1]).toBe("agents"); // 2 occurrences
  });

  it("collects usedAngle values from high-rated cards", () => {
    const records = [
      makeCard({ rating: 5, usedAngle: "The hidden cost" }),
      makeCard({ rating: 5, usedAngle: "The hidden cost" }),
      makeCard({ rating: 5, usedAngle: "The builder's dilemma" }),
      makeCard({ rating: 2, usedAngle: "should be excluded" }),
    ];
    const p = getPreferredPatterns(records);
    expect(p.angles[0]).toBe("The hidden cost");
    expect(p.angles).not.toContain("should be excluded");
  });

  it("collects voiceExamples from high-rated posts, capped at 10", () => {
    const posts = Array.from({ length: 15 }, (_, i) =>
      makePost({
        id: `post-${i}`,
        rating: 5,
        postContent: `Post content ${i}`,
        timestamp: new Date(2026, 0, i + 1).toISOString(),
      }),
    );
    const p = getPreferredPatterns(posts);
    expect(p.voiceExamples).toHaveLength(10);
  });

  it("sorts voiceExamples by rating desc then timestamp desc", () => {
    const records = [
      makePost({ id: "a", rating: 5, postContent: "A", timestamp: "2026-01-01T00:00:00.000Z" }),
      makePost({ id: "b", rating: 4, postContent: "B", timestamp: "2026-01-03T00:00:00.000Z" }),
      makePost({ id: "c", rating: 5, postContent: "C", timestamp: "2026-01-05T00:00:00.000Z" }),
    ];
    const p = getPreferredPatterns(records);
    // Both 5-star posts come first (C is newer, so C before A), then 4-star B
    expect(p.voiceExamples[0]).toBe("C");
    expect(p.voiceExamples[1]).toBe("A");
    expect(p.voiceExamples[2]).toBe("B");
  });

  it("excludes post records without postContent from voiceExamples", () => {
    const records = [
      makePost({ rating: 5, postContent: undefined }),
      makePost({ rating: 5, postContent: "Valid post" }),
    ];
    const p = getPreferredPatterns(records);
    expect(p.voiceExamples).toEqual(["Valid post"]);
  });
});

// ─── feedbackSummary ───────────────────────────────────────────────────────────

describe("feedbackSummary", () => {
  it("returns zeros for empty input", () => {
    const s = feedbackSummary([]);
    expect(s.total).toBe(0);
    expect(s.avgRating).toBe(null);
    expect(s.postsRated).toBe(0);
    expect(s.cardsRated).toBe(0);
  });

  it("counts total, type breakdowns, and average correctly", () => {
    const records = [
      makeCard({ rating: 4, type: "card" }),
      makeCard({ rating: 5, type: "card" }),
      makePost({ rating: 3, type: "post" }),
    ];
    const s = feedbackSummary(records);
    expect(s.total).toBe(3);
    expect(s.cardsRated).toBe(2);
    expect(s.postsRated).toBe(1);
    expect(s.avgRating).toBe(4); // (4+5+3)/3 = 4.0
  });

  it("byRating buckets sum to total", () => {
    const records = [
      makeCard({ rating: 1 }),
      makeCard({ rating: 1 }),
      makeCard({ rating: 3 }),
      makeCard({ rating: 5 }),
    ];
    const s = feedbackSummary(records) as {
      byRating: { rating: number; count: number }[];
      total: number;
    };
    const bucketSum = s.byRating.reduce((acc, b) => acc + b.count, 0);
    expect(bucketSum).toBe(s.total);
  });

  it("includes preferredPatterns in summary", () => {
    const s = feedbackSummary([makeCard({ rating: 5 })]) as {
      preferredPatterns: { topics: string[] };
    };
    expect(s.preferredPatterns).toBeDefined();
    expect(Array.isArray(s.preferredPatterns.topics)).toBe(true);
  });
});
