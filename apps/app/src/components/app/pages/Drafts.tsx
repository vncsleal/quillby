import React, { useEffect, useState, useCallback } from "react";
import { listDrafts, listWorkspaces, type Draft, type Workspace } from "../api";
import { Layout, PageTitle, Card, Button, Spinner, EmptyState, ErrorBanner } from "../Layout";

function formatDate(iso?: string): string {
  if (!iso) return "";
  try {
    return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(iso));
  } catch {
    return iso;
  }
}

const FORMAT_LABELS: Record<string, string> = {
  linkedin: "LinkedIn",
  twitter: "Twitter / X",
  threads: "Threads",
  instagram: "Instagram",
  newsletter: "Newsletter",
  blog: "Blog",
};

export function Drafts() {
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [activeWsId, setActiveWsId] = useState<string | undefined>(undefined);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const loadWorkspaces = useCallback(async () => {
    try {
      const ws = await listWorkspaces();
      setWorkspaces(ws);
      const active = ws.find((w) => w.isActive);
      if (active) setActiveWsId(active.id);
    } catch {
      // non-fatal
    }
  }, []);

  const load = useCallback(async (wsId?: string) => {
    setError(null);
    setLoading(true);
    try {
      const fetched = await listDrafts(wsId);
      setDrafts(fetched);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadWorkspaces().then(() => load(activeWsId));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    load(activeWsId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeWsId]);

  const activeWs = workspaces.find((w) => w.id === activeWsId);

  return (
    <Layout activeWorkspace={activeWs?.name}>
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
        <PageTitle>Drafts</PageTitle>
        <div className="flex items-center gap-2">
          {workspaces.length > 1 && (
            <select
              value={activeWsId ?? ""}
              onChange={(e) => { setActiveWsId(e.target.value || undefined); }}
              className="rounded-lg px-3 py-1.5 text-xs outline-none"
              style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.1)", color: "#c4b5fd", cursor: "pointer" }}
            >
              <option value="">All workspaces</option>
              {workspaces.map((w) => (
                <option key={w.id} value={w.id}>{w.name}</option>
              ))}
            </select>
          )}
          <Button variant="ghost" onClick={() => load(activeWsId)} disabled={loading} className="text-xs">
            {loading ? <Spinner /> : "Refresh"}
          </Button>
        </div>
      </div>

      {error && <ErrorBanner message={error} />}

      {loading && drafts.length === 0 ? (
        <div className="flex justify-center py-16"><Spinner /></div>
      ) : drafts.length === 0 ? (
        <EmptyState
          title="No drafts yet"
          body="Ask Claude to generate a post from a card to create your first draft."
        />
      ) : (
        <div className="flex flex-col gap-3">
          {drafts.map((draft) => {
            const isExpanded = expandedId === draft.id;
            const formatLabel = draft.format ? (FORMAT_LABELS[draft.format] ?? draft.format) : null;

            return (
              <Card key={draft.id}>
                {/* Header */}
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <button
                      onClick={() => setExpandedId(isExpanded ? null : draft.id)}
                      className="text-left w-full"
                      style={{ background: "none", border: "none", cursor: "pointer", padding: 0 }}
                    >
                      <p className="font-semibold text-sm leading-snug hover:underline" style={{ color: "#f0ecfa" }}>
                        {draft.title ?? `Draft ${draft.id.slice(0, 8)}…`}
                      </p>
                    </button>
                    <div className="flex items-center gap-2 mt-1 flex-wrap">
                      {formatLabel && (
                        <span
                          className="rounded px-2 py-0.5 text-xs font-semibold"
                          style={{ background: "rgba(124,58,237,0.15)", color: "#c4b5fd" }}
                        >
                          {formatLabel}
                        </span>
                      )}
                      {draft.createdAt && (
                        <span className="text-xs" style={{ color: "rgba(156,141,181,0.5)" }}>
                          {formatDate(draft.createdAt)}
                        </span>
                      )}
                    </div>
                  </div>
                  <button
                    onClick={() => setExpandedId(isExpanded ? null : draft.id)}
                    className="shrink-0 rounded-md w-7 h-7 flex items-center justify-center text-xs transition-all"
                    style={{
                      border: "1px solid rgba(255,255,255,0.1)",
                      background: isExpanded ? "rgba(124,58,237,0.15)" : "rgba(255,255,255,0.04)",
                      color: isExpanded ? "#c4b5fd" : "#9c8db5",
                      cursor: "pointer",
                      transform: isExpanded ? "rotate(180deg)" : "none",
                    }}
                    title={isExpanded ? "Collapse" : "Expand"}
                  >
                    ▾
                  </button>
                </div>

                {/* Expanded content */}
                {isExpanded && draft.content && (
                  <div className="mt-4 pt-4 border-t" style={{ borderColor: "rgba(255,255,255,0.06)" }}>
                    <pre
                      className="text-sm leading-relaxed whitespace-pre-wrap"
                      style={{
                        color: "#d4c8f0",
                        fontFamily: "var(--font-mono, monospace)",
                        fontSize: "0.8125rem",
                      }}
                    >
                      {draft.content}
                    </pre>
                    <div className="flex justify-end mt-4">
                      <Button
                        variant="secondary"
                        className="text-xs"
                        onClick={() => {
                          navigator.clipboard.writeText(draft.content ?? "").catch(() => {});
                        }}
                      >
                        Copy
                      </Button>
                    </div>
                  </div>
                )}
              </Card>
            );
          })}
        </div>
      )}
    </Layout>
  );
}
