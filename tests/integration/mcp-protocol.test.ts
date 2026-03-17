/**
 * Integration tests for the MCP protocol layer (src/mcp/server.ts).
 *
 * These tests spawn the compiled server binary over stdio and verify
 * that JSON-RPC requests return correct, spec-compliant responses.
 *
 * Prerequisites: `npm run build` must have been run before this suite.
 * The build is checked at suite setup — if the binary is missing the
 * tests will fail with a clear message rather than a cryptic spawn error.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { spawn, type ChildProcess } from "node:child_process";
import * as path from "node:path";
import * as fs from "node:fs";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(fileURLToPath(import.meta.url), "../../../");
const SERVER_BIN = path.join(ROOT, "dist/mcp/server.js");

// ─── JSON-RPC client helper ────────────────────────────────────────────────────

interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: number;
  result?: unknown;
  error?: { code: number; message: string };
}

class McpTestClient {
  private proc: ChildProcess;
  private buf = "";
  private pending = new Map<number, (res: JsonRpcResponse) => void>();

  constructor() {
    this.proc = spawn("node", [SERVER_BIN], {
      stdio: ["pipe", "pipe", "pipe"],
      cwd: ROOT,
    });
    this.proc.stderr?.on("data", () => {}); // suppress startup logs
    this.proc.stdout?.on("data", (chunk: Buffer) => {
      this.buf += chunk.toString();
      const lines = this.buf.split("\n");
      this.buf = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.trim()) continue;
        let obj: JsonRpcResponse;
        try {
          obj = JSON.parse(line) as JsonRpcResponse;
        } catch {
          continue;
        }
        const resolve = this.pending.get(obj.id);
        if (resolve) {
          this.pending.delete(obj.id);
          resolve(obj);
        }
      }
    });
  }

  request(msg: object & { id: number }): Promise<JsonRpcResponse> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(msg.id);
        reject(new Error(`Timeout waiting for response to id=${msg.id}`));
      }, 8000);
      this.pending.set(msg.id, (res) => {
        clearTimeout(timeout);
        resolve(res);
      });
      this.proc.stdin!.write(JSON.stringify(msg) + "\n");
    });
  }

  close() {
    this.proc.kill();
  }
}

// ─── Suite setup ──────────────────────────────────────────────────────────────

let client: McpTestClient;

beforeAll(() => {
  if (!fs.existsSync(SERVER_BIN)) {
    throw new Error(
      `Built server not found at ${SERVER_BIN}.\nRun 'npm run build' before the integration tests.`,
    );
  }
  client = new McpTestClient();
});

afterAll(() => {
  client?.close();
});

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("MCP initialize", () => {
  it("responds with correct server name and version", async () => {
    const res = await client.request({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: { name: "vitest-runner", version: "0.0.1" },
      },
    });

    expect(res.error).toBeUndefined();
    expect((res.result as { serverInfo: { name: string; version: string } }).serverInfo.name).toBe(
      "grist-mcp",
    );
    expect(
      (res.result as { serverInfo: { name: string; version: string } }).serverInfo.version,
    ).toBe("0.4.0");
  });
});

describe("MCP tools/list", () => {
  let tools: { name: string; outputSchema?: object }[];

  beforeAll(async () => {
    // Ensure we've initialized first
    await client.request({
      jsonrpc: "2.0",
      id: 10,
      method: "initialize",
      params: {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: { name: "vitest-runner", version: "0.0.1" },
      },
    });

    const res = await client.request({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/list",
      params: {},
    });
    tools = (res.result as { tools: typeof tools }).tools;
  });

  it("returns exactly 18 tools", () => {
    expect(tools).toHaveLength(18);
  });

  it.each([
    "grist_onboard",
    "grist_set_context",
    "grist_get_context",
    "grist_fetch_articles",
    "grist_save_cards",
    "grist_daily_brief",
    "grist_analyze_articles",
    "grist_generate_post",
    "grist_rate_card",
    "grist_rate_post",
    "grist_feedback_stats",
  ])('tool "%s" is present', (name) => {
    expect(tools.map((t) => t.name)).toContain(name);
  });

  it("every tool declares an outputSchema", () => {
    const missing = tools.filter((t) => !t.outputSchema).map((t) => t.name);
    expect(missing).toEqual([]);
  });

  it("every tool has a non-empty description", () => {
    const noDesc = tools
      .filter((t) => !(t as { description?: string }).description?.trim())
      .map((t) => t.name);
    expect(noDesc).toEqual([]);
  });
});

describe("MCP prompts/list", () => {
  it("returns at least 2 prompts", async () => {
    const res = await client.request({
      jsonrpc: "2.0",
      id: 3,
      method: "prompts/list",
      params: {},
    });
    const prompts = (res.result as { prompts: unknown[] }).prompts;
    expect(prompts.length).toBeGreaterThanOrEqual(2);
  });
});

describe("grist_feedback_stats tool call", () => {
  it("responds without error and returns text content", async () => {
    const res = await client.request({
      jsonrpc: "2.0",
      id: 4,
      method: "tools/call",
      params: { name: "grist_feedback_stats", arguments: {} },
    });
    expect(res.error).toBeUndefined();
    const content = (res.result as { content: { type: string; text: string }[] }).content;
    expect(Array.isArray(content)).toBe(true);
    expect(content[0].text.length).toBeGreaterThan(0);
  });
});

describe("grist_get_context tool call", () => {
  it("responds without error and returns text content", async () => {
    const res = await client.request({
      jsonrpc: "2.0",
      id: 5,
      method: "tools/call",
      params: { name: "grist_get_context", arguments: {} },
    });
    expect(res.error).toBeUndefined();
    const content = (res.result as { content: { type: string; text: string }[] }).content;
    expect(Array.isArray(content)).toBe(true);
    expect(content[0].text.length).toBeGreaterThan(0);
  });
});
