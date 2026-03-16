# Contributing to GRIST

Thanks for helping improve GRIST.

## Development setup

1. Fork the repo and create a branch from `main`.
2. Install dependencies with your preferred package manager.
3. Create local config files if needed:
   - `config/context.md`
   - `config/rss_sources.txt`
4. Validate locally:
   - `tsc --noEmit`
   - `npm run mcp:dev` (optional MCP startup sanity test)

## Pull request checklist

- Keep changes focused and small.
- Include a clear problem statement and solution summary.
- Update docs when behavior changes.
- Avoid committing secrets, outputs, or cache files.

## Commit style (recommended)

Use concise, scoped messages, for example:
- `feat: add compose option selection`
- `fix: prevent duplicate trend tags`
- `docs: update quick start`

## Reporting bugs and requesting features

- Use issue templates in `.github/ISSUE_TEMPLATE`.
- Include reproduction steps and expected behavior.
- For feature requests, explain workflow impact.
