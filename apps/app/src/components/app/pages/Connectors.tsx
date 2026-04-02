import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  createConnectorApiKey,
  getConnection,
  getResolvedApiBaseUrl,
  listConnectorApiKeys,
  revokeConnectorApiKey,
  type ConnectorApiKey,
} from "../api";
import { Layout, PageTitle, Card, Button, Spinner, EmptyState, ErrorBanner } from "../Layout";

function formatDate(iso?: string | null): string {
  if (!iso) return "No expiry";
  try {
    return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(iso));
  } catch {
    return iso;
  }
}

function buildConnectorUrl(baseUrl: string): string {
  return `${baseUrl.replace(/\/$/, "")}/mcp`;
}

export function Connectors() {
  const [keys, setKeys] = useState<ConnectorApiKey[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [revokingId, setRevokingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [newKeyName, setNewKeyName] = useState("claude-connector");
  const [rateLimitMax, setRateLimitMax] = useState("60");
  const [freshKey, setFreshKey] = useState<string | null>(null);

  const apiBaseUrl = useMemo(() => getResolvedApiBaseUrl(), []);
  const connectorUrl = useMemo(() => buildConnectorUrl(apiBaseUrl), [apiBaseUrl]);
  const isSelfHosted = Boolean(getConnection());

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await listConnectorApiKeys();
      setKeys(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load API keys");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function handleCreate() {
    setCreating(true);
    setError(null);
    setFreshKey(null);
    try {
      const limit = rateLimitMax.trim() ? Number(rateLimitMax) : undefined;
      const result = await createConnectorApiKey(newKeyName.trim() || "quillby-connector", Number.isFinite(limit) ? limit : undefined);
      setFreshKey(result.key);
      setKeys((prev) => [result.meta, ...prev]);
      setNewKeyName("quillby-connector");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create API key");
    } finally {
      setCreating(false);
    }
  }

  async function handleRevoke(keyId: string) {
    setRevokingId(keyId);
    setError(null);
    try {
      await revokeConnectorApiKey(keyId);
      setKeys((prev) => prev.filter((key) => key.id !== keyId));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to revoke API key");
    } finally {
      setRevokingId(null);
    }
  }

  return (
    <Layout>
      <div className="flex items-center justify-between mb-6">
        <PageTitle>Connectors</PageTitle>
        <Button variant="ghost" onClick={() => void load()} disabled={loading} className="text-xs">
          {loading ? <Spinner /> : "Refresh"}
        </Button>
      </div>

      {error && <ErrorBanner message={error} />}

      <div className="grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
        <Card className="flex flex-col gap-5">
          <div>
            <div className="text-xs uppercase tracking-[0.22em]" style={{ color: "#c4b5fd" }}>
              Remote MCP access
            </div>
            <h2 className="mt-2 text-xl font-semibold" style={{ color: "#f0ecfa" }}>
              Generate connector keys for Claude and other clients
            </h2>
            <p className="mt-2 text-sm leading-7" style={{ color: "rgba(240,236,250,0.72)" }}>
              Browser sessions are used for this dashboard. Remote MCP clients still authenticate with Bearer API keys against your Quillby HTTP endpoint.
            </p>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <label className="grid gap-2 text-sm">
              <span style={{ color: "#c4b5fd" }}>Key label</span>
              <input
                value={newKeyName}
                onChange={(e) => setNewKeyName(e.target.value)}
                className="rounded-xl px-4 py-3"
                style={{ background: "rgba(12,9,21,0.7)", border: "1px solid rgba(255,255,255,0.08)", color: "#f0ecfa" }}
                placeholder="claude-connector"
              />
            </label>
            <label className="grid gap-2 text-sm">
              <span style={{ color: "#c4b5fd" }}>Requests per minute</span>
              <input
                value={rateLimitMax}
                onChange={(e) => setRateLimitMax(e.target.value)}
                className="rounded-xl px-4 py-3"
                style={{ background: "rgba(12,9,21,0.7)", border: "1px solid rgba(255,255,255,0.08)", color: "#f0ecfa" }}
                inputMode="numeric"
              />
            </label>
          </div>

          <div className="flex flex-wrap gap-3">
            <Button onClick={() => void handleCreate()} disabled={creating}>
              {creating ? <Spinner /> : "Create API key"}
            </Button>
            <Button
              variant="secondary"
              onClick={() => {
                navigator.clipboard.writeText(connectorUrl).catch(() => {});
              }}
            >
              Copy MCP URL
            </Button>
          </div>

          {freshKey && (
            <div
              className="rounded-2xl p-4"
              style={{ background: "rgba(16,185,129,0.09)", border: "1px solid rgba(16,185,129,0.22)" }}
            >
              <div className="text-sm font-semibold" style={{ color: "#a7f3d0" }}>
                New API key generated
              </div>
              <p className="mt-2 text-sm leading-7" style={{ color: "rgba(240,236,250,0.72)" }}>
                Copy it now. Quillby only shows the full token once.
              </p>
              <code
                className="mt-3 block overflow-x-auto rounded-xl px-4 py-3 text-xs"
                style={{ background: "rgba(12,9,21,0.7)", color: "#f0ecfa" }}
              >
                {freshKey}
              </code>
              <div className="mt-3">
                <Button
                  variant="secondary"
                  onClick={() => {
                    navigator.clipboard.writeText(freshKey).catch(() => {});
                  }}
                >
                  Copy key
                </Button>
              </div>
            </div>
          )}
        </Card>

        <Card className="flex flex-col gap-4">
          <div className="text-xs uppercase tracking-[0.22em]" style={{ color: "#c4b5fd" }}>
            Setup
          </div>
          <h2 className="text-xl font-semibold" style={{ color: "#f0ecfa" }}>
            Connector details
          </h2>
          <div className="grid gap-3">
            <ConnectorField label="Mode" value={isSelfHosted ? "Self-hosted endpoint" : "Quillby Cloud endpoint"} />
            <ConnectorField label="Connector URL" value={connectorUrl} />
            <ConnectorField label="Authentication" value="Bearer token" />
          </div>
          <div className="rounded-2xl p-4" style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)" }}>
            <div className="text-sm font-semibold" style={{ color: "#f0ecfa" }}>
              Claude.ai custom connector
            </div>
            <ol className="mt-3 grid gap-2 text-sm" style={{ color: "rgba(240,236,250,0.72)" }}>
              <li>1. Open Claude settings and add a custom connector.</li>
              <li>2. Use the connector URL shown here.</li>
              <li>3. Choose Bearer token authentication.</li>
              <li>4. Paste the new API key.</li>
            </ol>
          </div>
          <div className="rounded-2xl p-4" style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)" }}>
            <div className="text-sm font-semibold" style={{ color: "#f0ecfa" }}>
              Other MCP clients
            </div>
            <p className="mt-2 text-sm leading-7" style={{ color: "rgba(240,236,250,0.72)" }}>
              Use the same URL and token in ChatGPT connectors or any MCP client that supports remote HTTP transport with Bearer authentication.
            </p>
          </div>
        </Card>
      </div>

      <div className="mt-8">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold" style={{ color: "#f0ecfa" }}>
            Existing keys
          </h2>
        </div>

        {loading && keys.length === 0 ? (
          <div className="flex justify-center py-16"><Spinner /></div>
        ) : keys.length === 0 ? (
          <EmptyState
            title="No connector keys yet"
            body="Create a key above to connect Claude, ChatGPT, or another remote MCP client."
          />
        ) : (
          <div className="flex flex-col gap-3">
            {keys.map((key) => (
              <Card key={key.id} className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                <div className="min-w-0">
                  <div className="font-semibold" style={{ color: "#f0ecfa" }}>
                    {key.name}
                  </div>
                  <div className="mt-1 flex flex-wrap gap-2 text-xs" style={{ color: "#9c8db5" }}>
                    <span>{[key.prefix, key.start].filter(Boolean).join("_") || key.id}</span>
                    {typeof key.rateLimitMax === "number" && <span>{key.rateLimitMax} req/min</span>}
                    <span>Created {formatDate(key.createdAt)}</span>
                    <span>{formatDate(key.expiresAt)}</span>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    variant="danger"
                    onClick={() => void handleRevoke(key.id)}
                    disabled={revokingId === key.id}
                    className="text-xs"
                  >
                    {revokingId === key.id ? <Spinner /> : "Revoke"}
                  </Button>
                </div>
              </Card>
            ))}
          </div>
        )}
      </div>
    </Layout>
  );
}

function ConnectorField({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl p-4" style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)" }}>
      <div className="text-xs uppercase tracking-[0.18em]" style={{ color: "#9c8db5" }}>
        {label}
      </div>
      <code className="mt-2 block overflow-x-auto text-sm" style={{ color: "#f0ecfa" }}>
        {value}
      </code>
    </div>
  );
}
