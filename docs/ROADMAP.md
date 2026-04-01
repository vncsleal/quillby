# Quillby Roadmap

## Deployment Model

Quillby is an AI agent for copywriters. It runs in three distinct modes. Every mode
uses the same codebase and the same MCP tool surface — only the storage backend and
transport differ.

---

### Local

The default mode. No server. No account. No setup beyond dropping a config block
into Claude Desktop (or any MCP-compatible client).

- Transport: stdio
- Storage: local filesystem under `~/.quillby/`
- Auth: none — the process is owned by the user's machine
- Cost: free, always
- Trade-off: data lives on one machine; no sharing; no cross-device access

Suitable for: individual copywriters who want a personal writing assistant on their
own computer.

---

### Self-Hosted

An advanced user deploys the Quillby HTTP server on their own infrastructure —
a VPS, a home server, a container platform, anything they control. They supply
their own database URL and auth secret, and they point their MCP client at their
own endpoint.

- Transport: HTTP (Streamable MCP)
- Storage: user-supplied libSQL/Turso database (or any libSQL-compatible endpoint)
- Auth: better-auth + API keys; configured by the deployer
- Cost: whatever the user pays for their own infra (Quillby itself is free)
- Trade-off: full control and data ownership, but the user is responsible for
  uptime, backups, and upgrades

Suitable for: technical users who want cross-device or team access on their own terms.
Also suitable as a private multi-user instance for a small team or agency.

---

### Cloud (Quillby Cloud)

Quillby runs the infrastructure. The user signs up, gets an endpoint, and connects
their MCP client to it — no server to configure, no database to provision.

- Transport: HTTP (Streamable MCP)
- Storage: Quillby-managed database, isolated per user
- Auth: better-auth + API keys, provisioned by Quillby
- Cost: monthly subscription fee (free tier for basic use; pro tier for higher
  limits and team features)
- Trade-off: no ops burden, but data is on Quillby's infrastructure

Suitable for: copywriters who want the benefits of an always-on, cross-device agent
without managing their own server.

---

> **Key implementation principle**: the same `WorkspaceStorage` interface powers all
> three modes. `LocalWorkspaceStorage` serves local mode. `HostedDbWorkspaceStorage`
> (pointed at any libSQL endpoint) serves both self-hosted and cloud.
> The only difference between the latter two is who provisions the database and who
> pays for it.

---

## Principles

- One Quillby workspace per Claude Project, client, brand, or campaign.
- Keep structured editorial state in Quillby workspaces.
- Keep large background docs in Claude Project knowledge.
- Preserve local-first operation — local mode must always work without any external
  dependency.
- Self-hosted must be fully operable with a single `docker run` or equivalent.
- Quillby Cloud is built on top of the same open codebase; no features are locked
  behind proprietary backends.
- Prefer simplicity over backward compatibility in early versions.
- Avoid runtime legacy migration layers unless actively needed.
- Do not force cloud storage on users who want local-only usage.

---

## Current State

- **Local mode**: stable, multi-workspace, tested. ✓
- **Self-hosted mode**: HTTP server + DB-backed storage + auth layer shipped. ✓  
  Users can deploy with `QUILLBY_DB_URL` + `QUILLBY_AUTH_SECRET` and reach a
  working MCP endpoint.
- **Cloud mode**: infrastructure scaffold in place; billing and onboarding not yet
  productized.

---

## Release Plan

### v0.4: Local Multi-Workspace ✓

Goal: make the workspace model the stable local foundation.

- multi-workspace filesystem storage ✓
- local stdio MCP as primary distribution ✓

Mode: **Local**

### v0.5: Dual-Mode Refactor ✓

Goal: make self-hosted and cloud modes possible without rewriting Quillby.

- `WorkspaceStorage` interface separates domain logic from storage backend ✓
- local filesystem becomes one swappable backend ✓

Mode: **Local** (unchanged) + **Self-Hosted/Cloud** (foundation)

### v0.6: HTTP MCP Server ✓

Goal: turn HTTP transport into a deployable MCP server.

- production-ready `/mcp` endpoint ✓
- Streamable HTTP transport ✓

Mode: **Self-Hosted**, **Cloud**

### v0.7: Auth Layer ✓

Goal: make hosted Quillby user-scoped and safe.

- better-auth + API key plugin ✓
- per-user request scoping ✓

Mode: **Self-Hosted**, **Cloud**

### v0.8: Hosted Persistence ✓

Goal: move hosted state off the local filesystem.

- DB-backed storage (libSQL/Turso) for workspaces, context, memory, sources,
  harvests, cards, drafts ✓
- filesystem storage kept for local mode ✓

Mode: **Self-Hosted** ✓, **Cloud** ✓

### v0.9: Connector Readiness ✓

Goal: make Quillby coherent as a remote MCP connector.

- polished tool surface ✓
- custom connector setup docs ✓

Mode: **Self-Hosted**, **Cloud**

### v1.0: First Hosted Release ✓

Goal: release the first supported hosted Quillby connector.

- stable hosted MCP service ✓
- local mode still supported ✓
- local-to-hosted migration path (`npm run migrate`) ✓

Mode: **All three**

### v1.1: Card Curation ✓

Goal: let Claude help the user curate harvested cards before drafting.

- `quillby_curate_card`: approve, reject, or flag individual cards ✓
- `quillby_list_cards`: filter by curation status ✓
- curation state persisted per harvest in both local and hosted storage ✓
- draft listing (`quillby_list_drafts`) ✓

Mode: **All three**

### v1.2: Per-Workspace Override + Plans + Team Access ✓

Goal: remove the last friction points for cloud and self-hosted use.

**Per-tool workspace override** (all modes)

- every content tool accepts an optional `workspaceId` parameter
- Claude can operate across workspaces in a single conversation without
  changing the global selection
- `storage.withWorkspace(id)` returns a scoped storage view without side effects

**Hosted plans scaffold** (Cloud)

- `plan: "free" | "pro"` field on user state
- `quillby_get_plan` tool exposes current plan to Claude
- no billing integration yet — groundwork for v1.3

**Team / shared workspaces** (Self-Hosted, Cloud)

- workspace owner can grant `viewer` or `editor` access to other users
- `quillby_share_workspace`, `quillby_revoke_access`, `quillby_list_workspace_access`
- shared workspace content is read/written as the owner's data (grantee sees
  the same cards, drafts, and memory as the owner for that workspace)

### v1.3: Quillby Cloud Billing (in progress)

Goal: productize Quillby Cloud.

- Stripe webhook integration for plan sync (free/pro) ✓
- usage limits enforced per plan (harvest frequency, workspace count, draft storage) ✓
- billing portal link exposed via `quillby_get_plan` ✓
- self-hosted users are unaffected — plan enforcement is behind deployment mode gating ✓
- remaining: checkout + subscription lifecycle UX (upgrade/downgrade flows)

Mode: **Cloud** only

### v1.4: Self-Hosted Operations Kit ✓

Goal: make self-hosting genuinely easy.

- official Docker image and `docker-compose.yml`
- one-command bootstrap: `docker compose up` gives a working MCP endpoint
- environment variable reference and deployment checklist in docs
- upgrade path: pull new image, restart, DDL migrations run automatically
- optional: `quillby_server_info` tool that reports version, mode, and DB status

Mode: **Self-Hosted** only (local mode unaffected)

### v1.5: MCP App

Goal: give managed hosted users a native GUI alongside Claude.

- card review, curation filters, and approval flows
- workspace switcher
- draft history browser
- connects to the same HTTP API as the MCP server

Mode: **Cloud** (self-hosted users can run it against their own endpoint)

---

## Near-Term Follow-Ups (post v1.2)

1. Explicit schema versions and DDL migrations with version table.
2. Atomic writes and file locking for local mode workspace state.
3. Richer memory entries: timestamps, tags, and provenance.
4. Source trust, freshness, and duplicate clustering metadata.
5. Rate limiting and abuse protection for Quillby Cloud endpoints.
