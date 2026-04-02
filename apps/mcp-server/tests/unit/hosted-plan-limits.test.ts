import { beforeEach, afterEach, describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { eq } from "drizzle-orm";
import { createDb, HostedDbWorkspaceStorage } from "../../src/storage.js";
import { hostedUserState } from "../../src/db/schema.js";
import type { CardInput } from "../../src/types.js";

let tempDir = "";
let tempDbPath = "";
let previousEnforce = "";
let previousMode = "";

function mkCard(title: string, link: string, thesis = "X"): CardInput {
  return {
    title,
    source: "S",
    link,
    thesis,
    relevanceScore: 0,
    relevanceReason: "",
    keyInsights: [],
    insightOptions: [],
    takeOptions: [],
    angleOptions: [],
    hookOptions: [],
    wireframeOptions: [],
    trendTags: [],
    transposabilityHint: "",
  };
}

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "quillby-hosted-plan-"));
  tempDbPath = path.join(tempDir, "test.db");
  previousEnforce = process.env.QUILLBY_ENFORCE_PLAN_LIMITS ?? "";
  previousMode = process.env.QUILLBY_DEPLOYMENT_MODE ?? "";
  process.env.QUILLBY_DEPLOYMENT_MODE = "cloud";
  process.env.QUILLBY_ENFORCE_PLAN_LIMITS = "1";
});

afterEach(() => {
  if (previousEnforce) process.env.QUILLBY_ENFORCE_PLAN_LIMITS = previousEnforce;
  else delete process.env.QUILLBY_ENFORCE_PLAN_LIMITS;
  if (previousMode) process.env.QUILLBY_DEPLOYMENT_MODE = previousMode;
  else delete process.env.QUILLBY_DEPLOYMENT_MODE;
  fs.rmSync(tempDir, { recursive: true, force: true });
});

describe("hosted plan limits", () => {
  it("enforces free workspace count limit", async () => {
    const { db } = createDb(`file:${tempDbPath}`);
    const user = new HostedDbWorkspaceStorage("free-user", db);

    // Default workspace is created during bootstrap; free limit allows 3 total.
    await user.listWorkspaces();
    await user.createWorkspace({ name: "Workspace A", id: "ws-a" });
    await user.createWorkspace({ name: "Workspace B", id: "ws-b" });

    await expect(
      user.createWorkspace({ name: "Workspace C", id: "ws-c" })
    ).rejects.toThrow(/free plan limit/i);
  });

  it("enforces free harvest cooldown", async () => {
    const { db } = createDb(`file:${tempDbPath}`);
    const user = new HostedDbWorkspaceStorage("cooldown-user", db);

    await user.saveHarvestOutput([
      mkCard("T1", "https://example.com/1", "X"),
    ]);

    await expect(
      user.saveHarvestOutput([
        mkCard("T2", "https://example.com/2", "Y"),
      ])
    ).rejects.toThrow(/cooldown/i);
  });

  it("allows pro users to bypass limits", async () => {
    const { db } = createDb(`file:${tempDbPath}`);
    const user = new HostedDbWorkspaceStorage("pro-user", db);

    // Ensure hosted_user_state exists, then upgrade to pro.
    await user.listWorkspaces();
    await db
      .update(hostedUserState)
      .set({ plan: "pro" })
      .where(eq(hostedUserState.userId, "pro-user"));

    await user.createWorkspace({ name: "One", id: "one" });
    await user.createWorkspace({ name: "Two", id: "two" });
    await user.createWorkspace({ name: "Three", id: "three" });
    await user.createWorkspace({ name: "Four", id: "four" });

    await user.saveHarvestOutput([
      mkCard("A", "https://example.com/a", "A"),
    ]);
    await expect(
      user.saveHarvestOutput([
        mkCard("B", "https://example.com/b", "B"),
      ])
    ).resolves.toBeTypeOf("string");
  });

  it("does not enforce SaaS limits in self-hosted mode", async () => {
    process.env.QUILLBY_DEPLOYMENT_MODE = "self-hosted";
    const { db } = createDb(`file:${tempDbPath}`);
    const user = new HostedDbWorkspaceStorage("selfhost-user", db);

    await user.listWorkspaces();
    await user.createWorkspace({ name: "One", id: "one" });
    await user.createWorkspace({ name: "Two", id: "two" });
    await user.createWorkspace({ name: "Three", id: "three" });
    await user.createWorkspace({ name: "Four", id: "four" });

    await user.saveHarvestOutput([
      mkCard("H1", "https://example.com/h1", "X"),
    ]);
    await expect(
      user.saveHarvestOutput([
        mkCard("H2", "https://example.com/h2", "Y"),
      ])
    ).resolves.toBeTypeOf("string");
  });
});
