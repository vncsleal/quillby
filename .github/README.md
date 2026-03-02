# GitHub Onboarding

If you just cloned this repository, run:

```bash
npm install
npm run init
```

`npm run init` creates your local private files (`config/context.md`, `config/rss_sources.txt`, and `config/prompts/*.local.txt`) without changing tracked defaults.

Optional:

- `npm run init -- --copy` for copy-only setup
- `npm run init -- --ai --overwrite` to regenerate local prompts with AI personalization
