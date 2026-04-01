# Quillby MCP Setup

How to connect Quillby to your AI client. Quillby supports two transports:
- **stdio** — local, no server needed (default, recommended for personal use)
- **HTTP** — stateful Streamable HTTP, for hosted/remote deployments

## Prerequisites

- [Node.js 20+](https://nodejs.org)
- A built copy of Quillby:

```bash
cd /path/to/quillby
npm install
npm run build
```

`./bin/quillby-mcp` is the canonical entrypoint after building.

## Tools

**For Claude Desktop user setup, see [README.md](../README.md).**

### Onboarding & Profile

| Tool | Parameters | Returns |
|---|---|---|
| `quillby_onboard` | *(MCP Elicitation — no params)* | Inline questions → profile saved |
| `quillby_list_workspaces` | — | Workspace list |
| `quillby_create_workspace` | `name`, `workspaceId?`, `description?`, `makeCurrent?` | Created workspace |
| `quillby_select_workspace` | `workspaceId` | Active workspace |
| `quillby_get_workspace` | `workspaceId?` | Workspace metadata + active state |
| `quillby_open_briefing` | — | Opens the cached Briefing MCP App instantly from saved local state |
| `quillby_set_context` | `context` object (required) | Confirmation |
| `quillby_get_context` | — | Profile JSON |

### Feed Management

| Tool | Parameters | Returns |
|---|---|---|
| `quillby_discover_feeds` | `topics[]` (optional override) | Suggested feed URLs |
| `quillby_add_feeds` | `urls[]` (required) | Added / skipped counts |
| `quillby_list_feeds` | — | Feed URL list |

### Fetch & Research

| Tool | Parameters | Returns |
|---|---|---|
| `quillby_fetch_articles` | `sources[]` (optional), `slim` (bool) | Article array |
| `quillby_read_article` | `url` (required) | Full article text |

### Analysis *(requires MCP Sampling)*

| Tool | Parameters | Returns |
|---|---|---|
| `quillby_daily_brief` | `topN` (number, default 15) | Full brief with scored cards |
| `quillby_analyze_articles` | `sources[]`, `topN` | Cards from full pipeline |

### Cards & Drafts

| Tool | Parameters | Returns |
|---|---|---|
| `quillby_save_cards` | `cards[]` (CardInput array, required) | Save path |
| `quillby_list_cards` | `limit`, `minScore` | Card summaries |
| `quillby_get_card` | `cardId` (number, required) | Full card object |
| `quillby_generate_post` | `cardId`, `platform` | Post text. Requires Sampling. |
| `quillby_save_draft` | `content`, `platform`, `cardId`, `addToVoiceExamples` | Save path |

### Voice Memory

| Tool | Parameters | Returns |
|---|---|---|
| `quillby_remember` | `entries[]`, `memoryType?` | Confirmation |
| `quillby_get_memory` | `memoryType?` | Typed memory |

## Resources

| URI | MIME | Description |
|---|---|---|
| `quillby://workspace/current` | `application/json` | Active workspace metadata |
| `quillby://context` | `application/json` | User content creator profile |
| `quillby://memory` | `application/json` | Typed memory for the active workspace |
| `quillby://harvest/latest` | `application/json` | Cards from the latest session |
| `quillby://feeds` | `text/plain` | Configured RSS feed URLs |

## Prompts

| Prompt | Description |
|---|---|
| `quillby_onboarding` | Guided setup |
| `quillby_session_start` | Session-entry behavior for opening Quillby and its Briefing artifact |
| `quillby_briefing` | Briefing artifact behavior |
| `quillby_story` | Story artifact behavior |
| `quillby_voice_system` | Voice System artifact behavior |
| `quillby_projects_playbook` | Claude Projects + artifacts playbook |

## Environment

### stdio (local)

For standard local usage, no API key is required.

| Variable | Default | Description |
|---|---|---|
| `QUILLBY_HOME` | `~/.quillby` | Root data directory |
| `Quillby_SCHEDULE` | *(unset)* | Daily harvest time `HH:MM` (fires while server is running) |
| `Quillby_SCHEDULE_TOP_N` | `15` | Max cards per scheduled harvest |

### HTTP mode

Set `Quillby_TRANSPORT=http` to run as a remote MCP server.

| Variable | Default | Description |
|---|---|---|
| `Quillby_TRANSPORT` | `stdio` | Set to `http` to enable HTTP mode |
| `PORT` | `3000` | TCP port to bind |
| `QUILLBY_HTTP_HOST` | `0.0.0.0` | Host interface to bind (`127.0.0.1` for local-only) |
| `QUILLBY_BASE_URL` | `http://localhost:PORT` | Public base URL (used in agent card) |
| `QUILLBY_AUTH_DB_URL` | `file:./quillby-auth.db` | libSQL connection string. Swap to `libsql://<db>.turso.io` for remote. |
| `LIBSQL_AUTH_TOKEN` | *(unset)* | Auth token for remote Turso connections only. |
| `QUILLBY_RATE_LIMIT` | `60` | Default max requests per minute per API key. |

HTTP mode endpoints:

| Path | Auth | Description |
|---|---|---|
| `GET /health` | none | Health check: `{ status, version, uptime, sessions }` |
| `GET /.well-known/agent.json` | none | A2A agent discovery card |
| `POST /api/auth/sign-up/email` | none | Register a new user |
| `POST /api/auth/sign-in/email` | none | Sign in, get session |
| `POST /mcp` | Bearer API key | MCP Streamable HTTP transport |
| `GET /mcp` | Bearer API key | SSE stream for an existing session |
| `DELETE /mcp` | Bearer API key | Close an existing session |

HTTP logs are newline-delimited JSON emitted to stderr:
```json
{"ts":"2026-03-31T12:00:00.000Z","level":"info","msg":"listening","host":"0.0.0.0","port":3000}
{"ts":"2026-03-31T12:00:01.000Z","level":"info","msg":"request","method":"POST","path":"/mcp","status":200,"ms":12}
```

## Do I Need To Deploy?

No, for personal/local use you do not deploy anything.

Use local stdio MCP:
- your client starts `node dist/mcp/server.js`
- tools are available locally in your client

Run as a remote HTTP server when you need:
- team/shared hosted access
- OpenAI ChatGPT app/deep research remote integration
- centralized auth and policy enforcement

```bash
# 1. Push schema to the auth DB (first-time setup)
npm run db:push

# 2. Create a user and generate an API key
npm run keys create-user user@example.com mypassword "Alice"
npm run keys create <userId> my-key

# 3. Start the server
Quillby_TRANSPORT=http PORT=3000 node dist/mcp/server.js
```

Clients authenticate by passing the API key as a Bearer token:
```
Authorization: Bearer qb_<generated-key>
```

## Example Client Configs

### Claude Code (CLI)

Add Quillby with explicit stdio command:

```bash
claude mcp add --transport stdio --scope project grist -- \
  /path/to/quillby/bin/quillby-mcp
```

Notes:
- `--scope project` writes a team-shareable `.mcp.json` in project root.
- Rebuild with `tsc` after code changes so `dist/mcp/server.js` stays current.

### Claude Desktop

Add to Claude Desktop MCP config:

```json
{
  "mcpServers": {
    "quillby": {
      "type": "stdio",
      "command": "/path/to/quillby/bin/quillby-mcp",
      "args": []
    }
  }
}
```

### VS Code (`.vscode/mcp.json`)

```json
{
  "servers": {
    "quillby": {
      "type": "stdio",
      "command": "${workspaceFolder}/bin/quillby-mcp",
      "args": []
    }
  }
}
```

### Cursor (`.cursor/mcp.json`)

```json
{
  "mcpServers": {
    "quillby": {
      "type": "stdio",
      "command": "${workspaceFolder}/bin/quillby-mcp",
      "args": []
    }
  }
}
```

### OpenAI (remote MCP style)

OpenAI docs emphasize remote MCP for ChatGPT Apps / deep research / API tools:

- host MCP server behind `https://.../mcp`
- use OAuth/authn for enterprise/shared deployments
- register tool server in ChatGPT or pass as `tools: [{ type: "mcp", server_url: ... }]` in API flows

Quillby supports both local stdio and hosted HTTP modes. For OpenAI-native remote deployment, set `Quillby_TRANSPORT=http`, put Quillby behind HTTPS, and issue Better Auth API keys for clients.

### Gemini and other clients

Gemini tooling emphasizes function/tool use. For MCP-capable clients, use the same stdio config shape above (`type`, `command`, `args`).

### Generic MCP config template

```json
{
  "mcpServers": {
    "quillby": {
      "type": "stdio",
      "command": "/absolute/path/to/quillby/bin/quillby-mcp",
      "args": []
    }
  }
}
```

## Notes

- Quillby suppresses normal CLI stdout while tools execute so MCP JSON-RPC output is not corrupted.
- `quillby_daily_brief` and `quillby_analyze_articles` require MCP Sampling support in the host client (Claude Desktop supports this).
- Saved cards and drafts are written under `~/.quillby/workspaces/<workspace-id>/output/<timestamp>/`.
- Typed memory is written under `~/.quillby/workspaces/<workspace-id>/memory/typed-memory.json`.

## Practical Recommendation

For acceptance and familiarity:

1. Keep local stdio support (already implemented).
2. Use config-file-driven setup (`.mcp.json`, `.vscode/mcp.json`, `.cursor/mcp.json`) with explicit `command`/`args`.
3. Use repo-local executable wrapper `./bin/quillby-mcp` for consistent client wiring.
4. Use `Quillby_TRANSPORT=http` for hosted deployments and require Bearer API keys issued by Better Auth.
