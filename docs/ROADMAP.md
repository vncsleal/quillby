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
- **Cloud mode**: browser sign-in, hosted dashboard, billing hooks, and connector
  API key management are now implemented. ✓
- **Monorepo**: repo reorganized into `apps/`, `packages/`, `infra/`, and
  audience-focused docs. Workspace tooling, root lint/build/typecheck/test, and
  separated marketing/app surfaces are in place. ✓

### Status Snapshot (2026-04-02)

What is now shipped in the repo:

- `apps/web`: public marketing and mode-selection surface (`/`, `/local`,
  `/self-host`, `/cloud`) ✓
- `apps/app`: Vite + React hosted dashboard with:
  - cloud sign-in/sign-up flow ✓
  - self-hosted connect flow ✓
  - workspace switcher ✓
  - card curation view ✓
  - draft history ✓
  - connector/API key management ✓
- `apps/mcp-server`: shared runtime for local, self-hosted, and cloud ✓
- extracted shared packages for core/config/workspace/database/billing/storage ✓

What is still not fully productized:

- cloud account lifecycle beyond basic auth
- self-host operations polish and smoke-tested deployment flows
- remaining package extraction (`auth`, `content`, `extractors`, `mcp-kit`,
  `ui-contracts`, `observability`)
- final docs/CI hardening

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

### v1.3: Quillby Cloud Billing ✓

Goal: productize Quillby Cloud.

- Stripe webhook integration for plan sync (free/pro) ✓
- usage limits enforced per plan (harvest frequency, workspace count, draft storage) ✓
- billing portal link exposed via `quillby_get_plan` ✓
- checkout + subscription lifecycle UX (`quillby_manage_subscription` + billing action endpoints) ✓
- self-hosted users are unaffected — plan enforcement and billing routes are deployment-mode gated ✓

Mode: **Cloud** only

### v1.4: Self-Hosted Operations Kit ✓

Goal: make self-hosting genuinely easy.

- official Docker image and `docker-compose.yml`
- one-command bootstrap: `docker compose up` gives a working MCP endpoint
- environment variable reference and deployment checklist in docs
- upgrade path: pull new image, restart, DDL migrations run automatically
- optional: `quillby_server_info` tool that reports version, mode, and DB status

Mode: **Self-Hosted** only (local mode unaffected)

### v1.5: MCP App ✓

Goal: give managed hosted users a native GUI alongside Claude.

- card review, curation filters, and approval flows ✓
- workspace switcher ✓
- draft history browser ✓
- connects to the same HTTP API as the MCP server ✓
- CORS headers added to HTTP server for browser clients ✓
- ships as a standalone GUI deployable that can be linked from the marketing site ✓

Mode: **Cloud** (self-hosted users can run it against their own endpoint)

### v1.6: Cloud Auth + Connector Management ✓

Goal: make the hosted app behave like a real SaaS surface instead of a generic
remote connector shell.

- cloud-first browser sign-in/sign-up flow in the app ✓
- self-hosted connection flow split from cloud onboarding ✓
- app uses session-backed `/api/app/*` endpoints instead of MCP tool calls ✓
- authenticated connector management UI for creating, listing, and revoking API keys ✓
- connector setup guidance inside the app for Claude and other hosted MCP clients ✓

Mode: **Cloud** primary, **Self-Hosted** compatible

---

## Missing / Next To Implement

These are the highest-value remaining items to make Quillby feel complete and
operationally credible.

### 1. Cloud Account Lifecycle

Goal: move from “basic auth works” to a complete managed product experience.

- password reset flow
- email verification / account confirmation
- account settings page
- profile/session management
- post-signup onboarding into first workspace and first connector

Mode: **Cloud**

### 2. Self-Hosted Operations Hardening

Goal: make self-hosting genuinely low-friction for technical users.

- stronger `.env.example` and deployment reference
- reverse proxy + HTTPS guidance
- backup / restore documentation
- upgrade / rollback playbook
- smoke-tested `docker compose` path in CI

Mode: **Self-Hosted**

### 3. Connector Docs by Client

Goal: make every supported MCP client path explicit instead of burying it in
general docs.

- Claude Desktop local setup
- Claude.ai hosted connector setup
- ChatGPT / OpenAI remote connector setup
- Cursor / VS Code setup where supported
- transport/auth matrix: stdio vs HTTP, session vs Bearer key

Mode: **All three**

### 4. Remaining Package Extraction

Goal: finish the monorepo architecture so `apps/mcp-server` becomes a thinner
composition layer.

- `packages/auth`
- `packages/content`
- `packages/extractors`
- `packages/mcp-kit`
- `packages/ui-contracts`
- optional `packages/observability`

Mode: **All three**

### 5. CI and Operational Compliance

Goal: move from local validation to repeatable repo guarantees.

- general CI workflow for lint/build/typecheck/test
- self-host smoke test workflow
- release verification across app/web/server outputs
- optional container/image validation

Mode: **All three**

### 6. Documentation Rewrite Around Final Architecture

Goal: make docs match the actual product and repository shape.

- rewrite `README.md` around Local / Self-Hosted / Cloud
- move architecture details into `docs/architecture`
- move deploy/runbook material into `docs/operations`
- publish explicit deployment and connector matrices

Mode: **All three**

---

## Near-Term Follow-Ups

Priority order recommended from the current codebase:

1. Cloud account lifecycle and onboarding
2. Self-host deployment hardening and smoke tests
3. Remaining package extraction
4. Connector docs by client
5. Final CI/docs pass

1. Explicit schema versions and DDL migrations with version table.
2. Atomic writes and file locking for local mode workspace state.
3. Richer memory entries: timestamps, tags, and provenance.
4. Source trust, freshness, and duplicate clustering metadata.
5. Rate limiting and abuse protection for Quillby Cloud endpoints.
