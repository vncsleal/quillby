# GRIST v0.2

Guided Research and Insight Synthesis Tool.

GRIST is MCP-first. It exposes deterministic tools, and your host AI client handles reasoning and final writing.

## Quick Start

```bash
<install dependencies with your package manager>
tsc
./bin/grist-mcp
```

Then use your MCP host client to call:

- `grist_harvest`
- `grist_list_cards`
- `grist_get_card`
- `grist_compose`

## Configuration

- `config/context.md`: identity, voice, and content preferences
- `config/rss_sources.txt`: RSS feed list

## Runtime Mode

Default mode is keyless and host-model-first:

- GRIST tools run locally over MCP/stdio.
- Claude/Cursor/VS Code/OpenAI host clients perform reasoning and writing.
- No GRIST-specific API key is required for standard operation.

## MCP

MCP config files:

- `.mcp.json`
- `.cursor/mcp.json`
- `.vscode/mcp.json`

See `docs/MCP.md` for tool contracts and client configuration examples.

## Project Layout

```
src/
  mcp/server.ts
  agents/
    harvest.ts
    compose.ts
  extractors/
    rss.ts
    content.ts
  output/
    structures.ts
```

## Development

```bash
tsc --noEmit
npm run mcp:dev
```

## License

MIT
