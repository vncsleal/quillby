# Quillby Custom Connector Setup

How to run Quillby as a remote MCP server and connect it to Claude.ai as a custom connector.

This lets you use Quillby from Claude.ai in a browser, on mobile, or from any device — without installing anything locally.

---

## Prerequisites

- A server to host Quillby (Fly.io, Railway, Render, a VPS, or localhost with a tunnel)
- Node.js 20+ on the server
- A Claude.ai account with access to custom connectors (Pro or Team plan)

---

## 1. Deploy Quillby

Clone and build:

```bash
git clone https://github.com/vncsleal/quillby.git
cd quillby
pnpm install
pnpm build
```

Create a `.env` file with at minimum:

```env
Quillby_TRANSPORT=http
PORT=3000
QUILLBY_BASE_URL=https://your-quillby.example.com
BETTER_AUTH_SECRET=<generate with: openssl rand -base64 32>

# Local SQLite (default — fine for single-user self-hosted)
QUILLBY_AUTH_DB_URL=file:./quillby-auth.db

# For Turso remote DB (multi-device or multi-user)
# QUILLBY_AUTH_DB_URL=libsql://<db>.turso.io
# LIBSQL_AUTH_TOKEN=<token>
```

Start the server:

```bash
node apps/mcp-server/dist/mcp/server.js
```

Verify it is running:

```bash
curl https://your-quillby.example.com/health
# {"status":"ok","version":"1.0.0",...}
```

---

## 2. Create a user account and API key

Quillby's HTTP mode uses API keys for connector authentication.

Create a user account first:

```bash
pnpm --filter @vncsleal/quillby keys create-user you@example.com yourpassword "Your Name"
# Prints: { "id": "user_...", "email": "...", "name": "..." }
```

Then create an API key for that user (copy the printed `userId`):

```bash
pnpm --filter @vncsleal/quillby keys create <userId> quillby-connector
# Prints the full API key — copy it now, it is only shown once.
```

To list existing keys or revoke one:

```bash
pnpm --filter @vncsleal/quillby keys list <userId>
pnpm --filter @vncsleal/quillby keys revoke <keyId>
```

---

## 3. Migrate existing local data (optional)

If you have been using Quillby locally (`~/.quillby`), you can copy your workspaces, context, memory, sources, and latest harvest into the hosted database — without losing any history.

**Step 1 — make sure your `.env` points at the hosted DB:**

```env
QUILLBY_AUTH_DB_URL=libsql://quillby-<org>.turso.io
LIBSQL_AUTH_TOKEN=<token>
```

**Step 2 — dry-run first to preview what will be migrated:**

```bash
pnpm --filter @vncsleal/quillby migrate -- <userId> --dry-run
# Uses ~/.quillby by default; pass a path as second arg to use a different directory:
pnpm --filter @vncsleal/quillby migrate -- <userId> /custom/path/.quillby --dry-run
```

**Step 3 — run live:**

```bash
pnpm --filter @vncsleal/quillby migrate -- <userId>
```

The script is **idempotent**: workspaces already in the hosted DB are silently skipped, so it is safe to re-run. Each migrated workspace preserves its original creation timestamp, context, memory, sources, seen-URL cache, and latest harvest bundle.

> **Note:** migration only reads your local data — it does not modify or delete anything in `~/.quillby`.

---

## 4. Add Quillby to Claude.ai

1. Open [claude.ai](https://claude.ai) in a browser.
2. Go to **Settings → Integrations** (or **Connectors**, depending on your plan).
3. Click **Add custom connector** (or **Add integration**).
4. Fill in:
   - **Name:** Quillby
   - **Connector URL:** `https://your-quillby.example.com/mcp`
   - **Authentication:** Bearer token
   - **Token:** the API key from step 2
5. Save. Claude will verify the connection.

---

## 5. First use

Open a new Claude chat and say:

> Open Quillby

Claude calls `quillby_open_briefing`. If no Briefing is saved yet, it guides you through onboarding and feed discovery first. After setup, saying "Open Quillby" always loads your latest Briefing instantly.

To generate a fresh Briefing from current news:

> Refresh my Quillby Briefing

---

## Notes

- Each API key scopes to one user. Create a separate key per Claude.ai account.
- The `/health` endpoint is unauthenticated — suitable for uptime monitoring.
- The `/.well-known/agent.json` endpoint describes Quillby for agent discovery.
- Workspace state is stored in the database, not on the local filesystem, so all sessions share the same workspaces.

---

## Fly.io example

```bash
fly launch --name quillby-mcp
fly secrets set \
  Quillby_TRANSPORT=http \
  QUILLBY_BASE_URL=https://quillby-mcp.fly.dev \
  BETTER_AUTH_SECRET=$(openssl rand -base64 32)
fly deploy
```

For a persistent remote database (recommended on Fly.io):

```bash
# Create a Turso database
turso db create quillby
turso db show quillby        # copy the URL
turso db tokens create quillby   # copy the auth token

fly secrets set \
  QUILLBY_AUTH_DB_URL=libsql://quillby-<org>.turso.io \
  LIBSQL_AUTH_TOKEN=<token>
fly deploy
```

Then create your user and API key:

```bash
fly ssh console -C "node apps/mcp-server/dist/mcp/server.js" &   # not needed — just run the script
# Run keys commands locally against the remote DB:
QUILLBY_AUTH_DB_URL=libsql://quillby-<org>.turso.io \
LIBSQL_AUTH_TOKEN=<token> \
pnpm --filter @vncsleal/quillby keys create-user you@example.com yourpassword "Your Name"

QUILLBY_AUTH_DB_URL=libsql://quillby-<org>.turso.io \
LIBSQL_AUTH_TOKEN=<token> \
pnpm --filter @vncsleal/quillby keys create <userId> quillby-connector
```
