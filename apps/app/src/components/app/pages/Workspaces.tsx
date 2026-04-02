import React, { useEffect, useState, useCallback } from "react";
import { listWorkspaces, selectWorkspace, type Workspace } from "../api";
import { Layout, PageTitle, Card, Button, Spinner, EmptyState, ErrorBanner } from "../Layout";

export function Workspaces() {
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selecting, setSelecting] = useState<string | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    setLoading(true);
    try {
      const ws = await listWorkspaces();
      setWorkspaces(ws);
      const active = ws.find((w) => w.isActive);
      if (active) setActiveId(active.id);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function handleSelect(ws: Workspace) {
    setSelecting(ws.id);
    try {
      await selectWorkspace(ws.id);
      setActiveId(ws.id);
      setWorkspaces((prev) => prev.map((w) => ({ ...w, isActive: w.id === ws.id })));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSelecting(null);
    }
  }

  const activeWs = workspaces.find((w) => w.id === activeId);

  return (
    <Layout activeWorkspace={activeWs?.name}>
      <div className="flex items-center justify-between mb-6">
        <PageTitle>Workspaces</PageTitle>
        <Button variant="ghost" onClick={load} disabled={loading} className="text-xs">
          {loading ? <Spinner /> : "Refresh"}
        </Button>
      </div>

      {error && <ErrorBanner message={error} />}

      {loading && workspaces.length === 0 ? (
        <div className="flex justify-center py-16"><Spinner /></div>
      ) : workspaces.length === 0 ? (
        <EmptyState
          title="No workspaces yet"
          body="Create a workspace by asking Claude: &quot;Create a workspace called…&quot;"
        />
      ) : (
        <div className="flex flex-col gap-3">
          {workspaces.map((ws) => {
            const isActive = ws.id === activeId;
            return (
              <Card
                key={ws.id}
                className="flex items-center justify-between gap-4"
              >
                <div className="flex items-center gap-3 min-w-0">
                  {/* Active indicator dot */}
                  <div
                    className="shrink-0 w-2 h-2 rounded-full"
                    style={{ background: isActive ? "#7c3aed" : "rgba(255,255,255,0.12)", boxShadow: isActive ? "0 0 8px rgba(124,58,237,0.7)" : "none" }}
                  />
                  <div className="min-w-0">
                    <p className="font-semibold truncate" style={{ color: isActive ? "#f0ecfa" : "#c4b5fd" }}>
                      {ws.name}
                    </p>
                    <p className="text-xs font-mono truncate mt-0.5" style={{ color: "rgba(156,141,181,0.5)" }}>
                      {ws.id}
                    </p>
                  </div>
                </div>
                <div className="shrink-0">
                  {isActive ? (
                    <span
                      className="rounded-full px-3 py-1 text-xs font-semibold"
                      style={{ background: "rgba(124,58,237,0.2)", color: "#c4b5fd", border: "1px solid rgba(124,58,237,0.3)" }}
                    >
                      Active
                    </span>
                  ) : (
                    <Button
                      variant="secondary"
                      onClick={() => handleSelect(ws)}
                      disabled={selecting === ws.id}
                      className="text-xs"
                    >
                      {selecting === ws.id ? <Spinner /> : "Select"}
                    </Button>
                  )}
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </Layout>
  );
}
