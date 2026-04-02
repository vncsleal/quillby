import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "../..");
const SERVER_BIN = path.join(ROOT, "dist/mcp/server.js");

let server: ChildProcess | undefined;
let port = 0;
let apiKey = "";
let tempDir = "";
let dbUrl = "";
let serverStderr = "";

function runOrThrow(command: string, args: string[], env: Record<string, string>) {
  const result = spawnSync(command, args, {
    cwd: ROOT,
    env: { ...process.env, ...env },
    encoding: "utf-8",
  });
  if (result.status !== 0) {
    throw new Error(
      [
        `Command failed: ${command} ${args.join(" ")}`,
        `exit=${result.status}`,
        result.stdout,
        result.stderr,
      ].join("\n"),
    );
  }
  return result.stdout + result.stderr;
}

beforeAll(async () => {
  if (!fs.existsSync(SERVER_BIN)) {
    throw new Error(`Built server not found at ${SERVER_BIN}. Run 'pnpm --filter @vncsleal/quillby build' first.`);
  }

  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "quillby-http-auth-"));
  dbUrl = `file:${path.join(tempDir, "auth.db")}`;
  port = 3100 + Math.floor(Math.random() * 400);

  const env = {
    QUILLBY_AUTH_DB_URL: dbUrl,
    BETTER_AUTH_URL: `http://localhost:${port}`,
  };

  runOrThrow("pnpm", ["--filter", "@vncsleal/quillby", "db:push"], env);

  const userOut = runOrThrow("pnpm", ["--filter", "@vncsleal/quillby", "keys", "create-user", "http-auth@example.com", "StrongPass123", "HTTP Auth"], env);
  const userMatch = userOut.match(/"id"\s*:\s*"([^"]+)"/);
  if (!userMatch) {
    throw new Error(`Could not parse user id from output:\n${userOut}`);
  }

  const keyOut = runOrThrow("pnpm", ["--filter", "@vncsleal/quillby", "keys", "create", userMatch[1], "http-key", "60"], env);
  const keyMatch = keyOut.match(/"key"\s*:\s*"([^"]+)"/);
  if (!keyMatch) {
    throw new Error(`Could not parse api key from output:\n${keyOut}`);
  }
  apiKey = keyMatch[1];

  server = spawn("node", [SERVER_BIN], {
    cwd: ROOT,
    env: {
      ...process.env,
      Quillby_TRANSPORT: "http",
      PORT: String(port),
      QUILLBY_AUTH_DB_URL: dbUrl,
      BETTER_AUTH_URL: `http://localhost:${port}`,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  server.stderr?.on("data", (chunk: Buffer) => {
    serverStderr += chunk.toString();
  });

  server.stdout?.on("data", () => {
    // Ignore structured logs from http mode in test output.
  });

  // Wait until /health responds or fail fast if process exits.
  const deadline = Date.now() + 6000;
  let ready = false;
  while (Date.now() < deadline) {
    if (server.exitCode != null) {
      throw new Error(`HTTP server exited early with code ${server.exitCode}. stderr:\n${serverStderr}`);
    }
    try {
      const res = await fetch(`http://localhost:${port}/health`);
      if (res.ok) {
        ready = true;
        break;
      }
    } catch {
      // not ready yet
    }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }

  if (!ready) {
    throw new Error(`HTTP server did not become ready on port ${port}. stderr:\n${serverStderr}`);
  }
}, 30_000);

afterAll(() => {
  server?.kill();
  if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
});

describe("HTTP auth", () => {
  it("returns 401 for /mcp without bearer key", async () => {
    const res = await fetch(`http://localhost:${port}/mcp`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }),
    });
    expect(res.status).toBe(401);
  });

  it("accepts valid bearer key and reaches MCP transport", async () => {
    const res = await fetch(`http://localhost:${port}/mcp`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }),
    });

    // Missing Accept header causes transport-level 406, which still proves
    // auth succeeded and request reached MCP transport.
    expect([200, 406]).toContain(res.status);
  });

  it("supports creating multiple authenticated sessions", async () => {
    const payload = JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: { name: "http-auth-test", version: "1.0.0" },
      },
    });

    const headers = {
      Authorization: `Bearer ${apiKey}`,
      Accept: "application/json, text/event-stream",
      "Content-Type": "application/json",
    };

    const first = await fetch(`http://localhost:${port}/mcp`, {
      method: "POST",
      headers,
      body: payload,
    });
    const second = await fetch(`http://localhost:${port}/mcp`, {
      method: "POST",
      headers,
      body: payload,
    });

    // New sessions should not hit protocol reconnect failures.
    expect(first.status).not.toBe(500);
    expect(second.status).not.toBe(500);
  });
});
