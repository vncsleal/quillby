# Quillby Roadmap

## Product Direction

Quillby should evolve in clear stages:

1. Published single-workspace local binary
2. Multi-workspace local binary
3. Dual-mode architecture for local and hosted runtimes
4. Hosted remote MCP connector
5. MCP App and paid hosted tiers

This keeps the product stable while moving from a local-first tool to a more native Claude integration.

## Principles

- One Quillby workspace per Claude Project, client, brand, or campaign.
- Keep structured editorial state in Quillby workspaces.
- Keep large background docs in Claude Project knowledge.
- Preserve local-first operation.
- Prefer simplicity over backward compatibility in early personal versions.
- Avoid runtime legacy migration layers, placeholders, and mock compatibility paths unless they are actively needed.
- Do not force hosted storage on users who want local-only usage.

## Current State

The current published version is a local MCP binary with one effective workspace.

This branch upgrades Quillby to a local multi-workspace model:

- Dynamic Quillby home via `QUILLBY_HOME`
- Workspace-scoped storage under `~/.quillby/workspaces/<workspaceId>/`
- Current-workspace selection
- Clean-start workspace model (no automatic legacy runtime migration)
- Typed memory buckets:
  - voice examples
  - style rules
  - audience insights
  - do-not-say rules
  - successful posts
  - campaign context
  - source preferences
- Expanded MCP surface:
  - `quillby_list_workspaces`
  - `quillby_create_workspace`
  - `quillby_select_workspace`
  - `quillby_get_workspace`
  - `quillby_get_memory`

## Release Plan

### v0.4: Local Multi-Workspace

Goal: make the workspace model the new stable local foundation.

Scope:

- ship multi-workspace local storage
- keep local stdio MCP as the primary distribution
- update docs and tests around workspace-based usage

Exit criteria:

- workspace switching is clear in Claude
- tests pass against isolated local state

### v0.5: Dual-Mode Refactor

Goal: make hosted mode possible without rewriting Quillby.

Scope:

- separate business logic from filesystem layout
- add service and repository boundaries
- keep local mode behavior unchanged

Exit criteria:

- local filesystem becomes one storage backend
- domain logic no longer depends directly on raw file paths

### v0.6: Harden Remote HTTP MCP

Goal: turn HTTP transport into a real deployable MCP server.

Scope:

- production-ready `/mcp` endpoint
- Streamable HTTP as the canonical remote transport
- deployment config, health checks, structured logs

Exit criteria:

- Quillby can run as a stable hosted MCP endpoint

### v0.7: Auth Layer

Goal: make hosted Quillby user-scoped and safe.

Scope:

- user accounts or equivalent identity model
- per-user authentication
- ideally OAuth-compatible connector auth

Exit criteria:

- each MCP request maps to an authenticated user
- no shared global hosted state

### v0.8: Hosted Persistence

Goal: move hosted state off the local filesystem.

Scope:

- database-backed hosted storage for:
  - workspaces
  - context
  - typed memory
  - sources
  - harvests
  - cards
  - drafts
- keep filesystem storage for local mode

Exit criteria:

- local mode uses filesystem storage
- hosted mode uses user-scoped backend storage
- both run on the same domain model

### v0.9: Claude Connector Readiness

Goal: make Quillby feel coherent as a remote connector.

Scope:

- narrow and polish the tool surface
- improve read/write tool metadata
- write custom connector setup docs
- test through Claude custom connector flows

Exit criteria:

- Quillby can be added as a custom remote connector
- workspace selection is clear in Claude

### v1.0: Hosted Quillby

Goal: release the first supported hosted Quillby connector.

Scope:

- stable hosted MCP service
- local mode still supported
- explicit local-to-hosted migration or import path

### v1.1+: MCP App And Paid Tiers

Goal: improve the native experience and productize hosted Quillby.

Scope:

- MCP App for shortlist review, filters, approvals, and workspace switching
- hosted plans and billing
- optional team/shared use cases

## Near-Term Follow-Ups

After local multi-workspace lands, the next local hardening steps should be:

1. Add per-tool workspace overrides so Claude can operate across workspaces without changing the global selection.
2. Add explicit schema versions and migrations.
3. Add atomic writes and file locking around workspace state.
4. Add richer memory entries with timestamps, tags, and provenance.
5. Add source trust, freshness, and duplicate clustering metadata.
