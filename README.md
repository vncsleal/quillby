# GRIST v0.1

**Guided Research & Insight Synthesis Tool.**

AI agent for reading the internet and writing content in your voice.
Automatically filters RSS feeds for relevant tech news, researches articles deeply, and generates structure cards with multiple insights and takes.

## Quick Start

```bash
# Install dependencies
npm install

# Initialize local private files (context, sources, and prompt overrides)
npm run init

# Copy .env.example and add your OpenAI API key
cp .env.example .env

# Copy personal context template and customize it
cp config/context.example.md config/context.md

# Copy feed sources template and customize it
cp config/rss_sources.example.txt config/rss_sources.txt

# Harvest structure cards
npm run harvest

# See card board (id, title, top take/insight)
npm run board

# Compose one draft from a selected structure card
npm run compose -- --card 1 --platform LinkedIn

# Show command help
npm run help
```

## Architecture

Two-step workflow split by intent:

```
HARVEST
📡 Fetch → 📚 Filter → 🔬 Research → 📈 Trends + 🧐 Concepts → 🏗️ Structure Cards

COMPOSE
🧩 Pick card + insight + take → ✍️ Generate one draft for chosen platform
```

## Key Files

```
src/
  index.ts              # Orchestrator
  config.ts             # Configuration
  types.ts              # TypeScript types & schemas
  llm.ts                # OpenAI client & tool calling
  
  extractors/
    rss.ts              # RSS feed fetching
    content.ts          # Article content extraction
  
  agents/
    librarian.ts        # Filter & score items
    researcher.ts       # Deep article analysis
    editor.ts           # Generate content concepts
      copywriter.ts       # Build wireframes
    trend-spotter.ts    # Cross-article pattern detection
  
  output/
      structures.ts       # Structure cards + harvest/compose persistence

config/
   context.md            # Your identity & voice
   rss_sources.txt       # RSS feed URLs
   prompts/
  README.md           # Prompt contracts
      librarian.txt       # Scoring & filtering rules
      researcher.txt      # Deep analysis framework
      editor.txt          # Content concept generation
      copywriter.txt      # Wireframe building
      ghostwriter.txt     # Publish-ready draft writing
      trend-spotter.txt   # Pattern detection
```

## Configuration

Edit `config/context.md` to customize:
- Your identity and tech stack
- Content interests and dislikes
- Writing voice and tone
- Content themes and goals

The file `config/context.md` is gitignored; commit-safe template lives at `config/context.example.md`.

Edit `config/rss_sources.txt` to add/remove RSS feeds.
The file `config/rss_sources.txt` is gitignored; commit-safe template lives at `config/rss_sources.example.txt`.

For prompt personalization, create local override files in `config/prompts/` using `*.local.txt`
(for example `editor.local.txt`, `copywriter.local.txt`). The runtime prefers local overrides automatically,
and these files are gitignored.

## Output

Harvest creates:
- `overview.md` — run summary
- `structures.md` — readable structure cards
- `structures.json` — compose-ready structured data

Compose creates:
- `draft.md` — one draft from selected card/insight/take

## Commands

- `npm run harvest` — scan and build structure cards
- `npm run board` — list latest structure cards for quick selection
- `npm run compose -- --card <id> --platform <platform>` — generate one draft on demand
- `npm run init` — create local private config and prompt overrides
- `npm run help` — show commands and examples

Init options:
- `npm run init -- --copy` — copy defaults only (no AI)
- `npm run init -- --ai` — personalize local prompts with AI
- `npm run init -- --overwrite` — replace existing local files

## Open Source Readiness

This repo is set up for public collaboration with:
- `LICENSE` (MIT)
- `CONTRIBUTING.md`
- `CODE_OF_CONDUCT.md`
- `SECURITY.md`
- `.github/ISSUE_TEMPLATE/*`
- `.github/PULL_REQUEST_TEMPLATE.md`

Contributor onboarding quick path: see `.github/README.md`.

Before publishing, run:

```bash
npm install
npm run typecheck
npm run harvest
```

Then push to GitHub and enable:
- Issues
- Discussions (optional)
- Security Advisories

## Models (2026 Latest)

**Current (Stable):**
- **Fast:** `gpt-4o-mini` — Cost-effective, fast filtering & scoring
- **Standard:** `gpt-4o-mini` — General purpose agent tasks
- **Research:** `gpt-4-turbo` — Deep analysis & reasoning

**Upgrade Path (when available in your account):**
- **Fast:** `gpt-5-mini` — Latest economical model
- **Standard:** `gpt-5.2` — Best overall quality, broad world knowledge
- **Advanced:** `gpt-5.2` — Research & content generation
- **Reasoning:** `o3` — Highest reasoning level for complex analysis
- **Pro:** `gpt-5.2-pro` — Extended compute for hardest problems

**Embeddings:**
- `text-embedding-3-large` — 3072-dimensional vectors for semantic search

Change models in `.env`:
```bash
LLM_MODEL_FAST=gpt-4o-mini      # or gpt-5-mini
LLM_MODEL=gpt-4o-mini            # or gpt-5.2
LLM_MODEL_RESEARCH=gpt-4-turbo   # or gpt-5.2
LLM_MODEL_REASONING=o1-mini      # or o3
```

## Advanced Features

### 🧠 Semantic Deduplication (Optional)
Prevent duplicate content even when URLs differ:

```bash
# Enable in .env
USE_VECTOR_STORE=true
EMBEDDING_MODEL=text-embedding-3-large
```

Benefits:
- Detects semantically similar articles from different sources
- Avoids covering the same story twice
- Improves content diversity
- Reduces processing costs

### ⚡ Parallel Processing
Configure concurrency for faster execution:

```bash
PARALLEL_WORKERS=4       # Concurrent agent tasks
BATCH_SIZE=10            # Items per batch
PARALLEL_REQUESTS=5      # LLM API parallelism
```

See [docs/ADVANCED_FEATURES.md](./docs/ADVANCED_FEATURES.md) for:
- Batch API integration
- Streaming support
- Model selection strategies
- Cost optimization tips
- Performance tuning

See [config/prompts/README.md](./config/prompts/README.md) for prompt contracts and safe editing rules.

## Cost Estimate

- ~100 items processed → ~$0.50 (with gpt-4o-mini)
- ~20 concepts generated → ~$0.20
- **Total per run:** ~$0.70 for full pipeline

## Development

```bash
# Watch mode
npm run dev

# Harvest structures
npm run harvest

# Compose one draft from latest harvest
npm run compose -- --card 1 --platform LinkedIn

# Build
npm run build

# Clear cache
npm run clear-cache
```

## What Makes It Different

1. **Tool-Calling Architecture** — Uses OpenAI's function calling for cleaner agent loops
2. **Modular Agents** — Each stage is independent, testable, and reusable
3. **Your Voice** — Deeply integrated with your identity from `config/context.md`
4. **Idea-First Workflow** — Harvest reusable structures, then compose with your own angle
5. **Cost-Conscious** — Uses cheapest appropriate models, caches aggressively

## Next Steps

- Run a harvest cycle: `npm run harvest`
- Compose from a selected card: `npm run compose -- --card 1 --platform LinkedIn`
- Check `output/` files
- Refine `config/context.md` based on output quality
- Integrate with your publish workflow

---

Built by Vinicius Leal | "Ship ideas before they get overthought"
