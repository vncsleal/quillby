import { beforeEach, afterEach, describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { createDb, HostedDbWorkspaceStorage } from "../../src/storage.js";

let tempDir = "";
let tempDbPath = "";

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "quillby-hosted-storage-"));
  tempDbPath = path.join(tempDir, "test.db");
});

afterEach(() => {
  fs.rmSync(tempDir, { recursive: true, force: true });
});

describe("hosted storage isolation", () => {
  it("keeps workspace state isolated per authenticated user", async () => {
    const { db } = createDb(`file:${tempDbPath}`);
    const userA = new HostedDbWorkspaceStorage("user-A", db);
    const userB = new HostedDbWorkspaceStorage("user-B", db);

    await userA.createWorkspace({
      name: "A Workspace",
      workspaceId: "a-workspace",
      makeCurrent: true,
    });

    const userAWorkspaces = (await userA.listWorkspaces()).map((w) => w.id);
    const userBWorkspaces = (await userB.listWorkspaces()).map((w) => w.id);

    expect(userAWorkspaces).toContain("a-workspace");
    expect(userBWorkspaces).not.toContain("a-workspace");
  });
});
