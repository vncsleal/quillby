# Contributing to GRIST

Thanks for helping improve GRIST.

## Development setup

1. Fork the repo and create a branch from `main`.
2. Install dependencies:
   - `npm install`
3. Initialize local private files:
   - `npm run init`
4. Configure environment:
   - `cp .env.example .env`
   - set `OPENAI_API_KEY`
5. Validate locally:
   - `npm run typecheck`
   - `npm run harvest` (optional sanity test)

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
