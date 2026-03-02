# Prompt Contracts (GRIST)

These prompts drive the `harvest -> compose` workflow.

## Goals

- Keep Harvest focused on reusable idea extraction.
- Keep Compose focused on one draft generated on demand.
- Preserve parser-safe output contracts where JSON is expected.

## Prompt map

- `librarian.txt` -> RSS signal filter (JSON: `{ selected: [{ id, score, reason }] }`)
- `researcher.txt` -> article analysis (JSON matching `ResearchSchema`)
- `editor.txt` -> concept generation (JSON: `{ concepts: ContentConcept[] }`)
- `copywriter.txt` -> wireframe seed generator (plain text, concise and structured)
- `trend-spotter.txt` -> cross-article synthesis (JSON: `{ trends: Trend[], meta_observation }`)
- `ghostwriter.txt` -> compose-style drafting guidance (not part of default harvest path)

## Local personalization (recommended)

Keep your personal prompt tuning in local override files:
- `editor.local.txt`
- `copywriter.local.txt`
- `ghostwriter.local.txt`
- `trend-spotter.local.txt`

The runtime prefers `*.local.txt` automatically when present. These files are gitignored, so your personal style stays local while the tracked `*.txt` files remain GitHub-safe defaults.

Bootstrap these files with:

```bash
npm run init
```

For AI-assisted personalization:

```bash
npm run init -- --ai --overwrite
```

## Safety rules when editing prompts

1. Do not change JSON key names expected by TypeScript schemas/parsers.
2. Keep enum values exactly as required:
   - platform: `X | LinkedIn | Blog`
   - temperature: `Hot | Warm | Cold`
   - signal_strength: `Strong | Moderate | Emerging`
3. Prefer grounded, anti-hype, builder-oriented language.
4. Never instruct models to fabricate first-hand usage claims.

## Validation after prompt changes

```bash
npm run typecheck
npm run harvest
npm run board
```

If harvest JSON parsing fails, revert recent prompt edits and re-apply incrementally.
