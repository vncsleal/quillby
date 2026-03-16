# GRIST MCP Server

GRIST exposes its workflow as an MCP server over stdio so MCP-compatible clients can call it directly.

Default runtime is host-model-first and keyless: GRIST provides deterministic tools, and your MCP host client does reasoning and writing.

## Industry-Standard Setup Pattern

Across Claude Code, VS Code, Cursor, and OpenAI MCP integrations, the common pattern is:

- use MCP transport (`stdio` for local process, `http` for remote hosted server)
- configure servers in a client config file/command with explicit `command` + `args` (or `url`)
- pass secrets via environment variables or env files
- require user trust/approval for tool calls unless sandboxed/policy-managed

So for GRIST, prefer explicit server commands over project-specific wrappers when possible.
In this repo, `./bin/grist-mcp` is the canonical MCP entrypoint.

## Run (Local STDIO)

Recommended for production-like local use:

```bash
tsc
./bin/grist-mcp
```

Development mode:

```bash
tsx src/mcp/server.ts
```

This starts the server on stdio.

## Exposed Tools

### `grist_harvest`
Fetch RSS feeds and generate deterministic structure cards.

Input (all optional):
- `context: string` custom context override
- `sources: string[]` custom RSS source URLs override

Returns:
- run metadata (`generatedAt`, `dateLabel`, `outputDir`)
- `cardsCount`
- card summaries (`id`, `title`, `source`, `link`)

### `grist_list_cards`
List structure cards from the latest harvest bundle.

Input (optional):
- `limit: number` defaults to `25`, max `100`

Returns:
- bundle metadata
- card list with `id`, `title`, `source`, `link`, `thesis`

### `grist_get_card`
Get one full card by id.

Input:
- `cardId: number` required

Returns:
- bundle metadata
- full `card` object

### `grist_compose`
Build a deterministic draft scaffold from a selected card.

Input:
- `cardId: number` required
- `platform: string` optional, defaults to `LinkedIn`
- `take: string` optional override
- `insight: string` optional override
- `angle: string` optional override
- `save: boolean` optional, defaults to `true`

Returns:
- `draft`
- selected `cardId`
- `platform`
- save metadata (`saved`, `filePath`)

## Environment

For standard MVP usage, no GRIST API key is required.

## Do I Need To Deploy?

No, for personal/local use you do not deploy anything.

Use local stdio MCP:
- your client starts `node dist/mcp/server.js`
- tools are available locally in your client

You only deploy a remote HTTP MCP server if you need:
- team/shared hosted access
- OpenAI ChatGPT app/deep research remote integration
- centralized auth and policy enforcement

## Example Client Configs

### Claude Code (CLI)

Add GRIST with explicit stdio command:

```bash
claude mcp add --transport stdio --scope project grist -- \
  /Users/vncsleal/Downloads/projects/rss-filter/bin/grist-mcp
```

Notes:
- `--scope project` writes a team-shareable `.mcp.json` in project root.
- Rebuild with `tsc` after code changes so `dist/mcp/server.js` stays current.

### Claude Desktop

Add to Claude Desktop MCP config:

```json
{
  "mcpServers": {
    "grist": {
      "type": "stdio",
      "command": "/Users/vncsleal/Downloads/projects/rss-filter/bin/grist-mcp",
      "args": []
    }
  }
}
```

### VS Code (`.vscode/mcp.json`)

```json
{
  "servers": {
    "grist": {
      "type": "stdio",
      "command": "${workspaceFolder}/bin/grist-mcp",
      "args": []
    }
  }
}
```

### Cursor (`.cursor/mcp.json`)

```json
{
  "mcpServers": {
    "grist": {
      "type": "stdio",
      "command": "${workspaceFolder}/bin/grist-mcp",
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

GRIST today is local stdio only. If you want OpenAI-native remote deployment, next step is adding HTTP transport wrapper and auth.

### Gemini and other clients

Gemini tooling emphasizes function/tool use. For MCP-capable clients, use the same stdio config shape above (`type`, `command`, `args`).

### Generic MCP config template

```json
{
  "mcpServers": {
    "grist": {
      "type": "stdio",
      "command": "/absolute/path/to/rss-filter/bin/grist-mcp",
      "args": []
    }
  }
}
```

## Notes

- GRIST suppresses normal CLI stdout while tools execute so MCP JSON-RPC output is not corrupted.
- `grist_harvest` writes the latest bundle to `output/<timestamp>/structures.json` and updates `.cache/latest_harvest_path.txt`.
- `grist_compose` writes drafts into the latest harvest output directory when `save` is true.

## Practical Recommendation

For acceptance and familiarity:

1. Keep local stdio support (already implemented).
2. Use config-file-driven setup (`.mcp.json`, `.vscode/mcp.json`, `.cursor/mcp.json`) with explicit `command`/`args`.
3. Use repo-local executable wrapper `./bin/grist-mcp` for consistent client wiring.
4. Add remote HTTP transport + auth only if you want hosted/team-scale connectors.
