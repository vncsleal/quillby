# GitHub Onboarding

If you just cloned this repository, run:

```bash
<install dependencies with your package manager>
tsc
./bin/grist-mcp
```

Create local config files if they do not exist:

- `config/context.md`
- `config/rss_sources.txt`

Then call GRIST from your MCP host client via `grist_harvest`, `grist_list_cards`, and `grist_compose`.

### Runtime Model

Default MVP mode is host-model-first and keyless:

- GRIST runs deterministic local MCP tools.
- Your MCP host client model (Claude/Cursor/VS Code/OpenAI) performs reasoning and writing.
- No GRIST-specific API key is required for normal operation.
