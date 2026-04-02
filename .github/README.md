# GitHub Onboarding

If you just cloned this repository, run:

```bash
<install dependencies with your package manager>
pnpm --filter @vncsleal/quillby build
./apps/mcp-server/bin/quillby-mcp
```

Create local config files if they do not exist:

- `apps/mcp-server/config/context.md`
- `apps/mcp-server/config/rss_sources.txt`

Then call Quillby from your MCP host client via `quillby_harvest`, `quillby_list_cards`, and `quillby_compose`.

### Runtime Model

Default MVP mode is host-model-first and keyless:

- Quillby runs deterministic local MCP tools.
- Your MCP host client model (Claude/Cursor/VS Code/OpenAI) performs reasoning and writing.
- No Quillby-specific API key is required for normal operation.
