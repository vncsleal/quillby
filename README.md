# Quillby

Quillby gives Claude a daily content briefing. It scans articles across your topics, finds what's relevant to your audience, and helps you write posts that sound like you — not generic AI.

Quillby is now workspace-based: use one workspace per Claude Project, client, brand, or campaign.

No extra accounts. No API keys. Everything runs on your computer, inside Claude.

---

## What you need

- **[Claude Desktop](https://claude.ai/download)** — the free desktop app from Anthropic (free tier works)
- **[Node.js 20+](https://nodejs.org)** — a free one-time install (click the large **LTS** button on their site)

---

## Installation

### macOS / Linux

Paste this into your terminal. It installs Quillby and connects it to Claude Desktop automatically:

```bash
curl -fsSL https://raw.githubusercontent.com/vncsleal/quillby/main/install.sh | bash
```

### Windows

Open PowerShell and run:

```powershell
irm https://raw.githubusercontent.com/vncsleal/quillby/main/install.ps1 | iex
```

Both scripts handle everything: install Quillby, inject the Claude Desktop config with absolute paths, and print next steps.

Then **fully quit Claude Desktop** (right-click the Dock/taskbar icon → Quit), reopen it, and in a new chat type:

> Set me up with Quillby

Claude will ask a few questions about your work, your audience, and what you publish. Answer naturally — that's how Quillby learns your voice.

### Manual install (any platform)

1. Install the package:
   ```
   npm install -g @vncsleal/quillby
   ```

2. Open your Claude Desktop config file:
   - **Mac:** `~/Library/Application Support/Claude/claude_desktop_config.json`
   - **Windows:** `%APPDATA%\Claude\claude_desktop_config.json`

3. Add the following inside the `mcpServers` block:
   ```json
   {
     "mcpServers": {
       "quillby": {
         "command": "quillby-mcp"
       }
     }
   }
   ```

4. Fully quit and reopen Claude Desktop, then say: *Set me up with Quillby*

---

## Every day

Once set up, just talk to Claude like normal.

If you work across multiple contexts, start by creating or selecting a workspace:

> "Create a Quillby workspace for my B2B SaaS brand"

> "Switch Quillby to my newsletter workspace"

**Open the saved Briefing instantly:**

> "Open Quillby"

> "Open my daily brief"

**Refresh today's content ideas when you want a new run:**

> "Give me my Quillby daily brief"

Claude scans today's articles across your topics, picks the most relevant ones for your audience, and gives you a set of ready-to-use ideas — each with a specific angle and hook.

**Write a post from any idea:**

> "Write a LinkedIn post from idea 3"

Claude writes it in your voice, based on your profile.

**Save it:**

> "Save this draft"

Quillby stores it inside your Quillby data directory, typically `~/.quillby/workspaces/<workspace-id>/output/`.

---

## Teaching Quillby your voice

The more examples Quillby has, the more accurately it writes like you.

When Claude writes a post you're happy with, say:

> "Add this post to my Quillby voice examples"

Quillby saves it inside the current workspace. Every future post in that workspace draws on those examples.

To check what Quillby knows about your style:

> "Show me my Quillby Voice System"

You can also save typed editorial memory:

> "Remember this as a Quillby style rule: short paragraphs, no consultant tone"

> "Remember this as a Quillby do-not-say rule: never say 'unlock growth'"

---

## Tips

**Updating your focus:**
> "Update my Quillby profile — I'm focusing on [topic] now"

**Adding sources:**
> "Find good news sources for my Quillby topics and add them"

**Use natural language.** Good prompts sound like: "Open Quillby", "What's worth writing about today?", "Open the second story and draft it for LinkedIn", "Show me my Voice System."

**Being specific gets better results.** "Write a 150-word conversational LinkedIn post from idea 2" works much better than "write a post."

**Use Claude Projects with Quillby.** Keep structured state in Quillby, keep long reference material in Claude Project knowledge, and let Claude render the working surfaces as native artifacts.

**Your content stays on your computer.** Your profile, memory, drafts, and content ideas are saved locally under `~/.quillby/workspaces/`. Nothing is sent to any external service beyond the AI client you choose to use.

---

## Troubleshooting

**Quillby doesn't appear in Claude** — Make sure you fully quit and reopened Claude Desktop after saving the config. Check the path in the config matches exactly what the terminal printed (no extra spaces or missing characters).

**"No context saved" error** — Start setup for the current workspace: *"Set me up with Quillby"*

**"No feeds configured" error** — Ask Claude to find sources: *"Find RSS feeds for my topics and add them to Quillby"*

---

## For developers

HTTP transport, environment variables, scheduled harvest, the full tool reference, and integration configs for VS Code and Cursor: see [docs/MCP.md](docs/MCP.md). The implementation roadmap is in [docs/ROADMAP.md](docs/ROADMAP.md).

## Self-hosted quick start

If you want cross-device/team access on your own infrastructure:

```bash
docker compose -f infra/docker/docker-compose.yml up -d --build
```

Then point your MCP client to:

- `http://localhost:3000/mcp` (local testing)
- or your reverse-proxied HTTPS URL in production

Set `QUILLBY_DEPLOYMENT_MODE=self-hosted` for user-operated deployments. This keeps
SaaS billing/subscription logic disabled while preserving hosted features like API-key auth and shared workspaces.

---

## License

MIT
