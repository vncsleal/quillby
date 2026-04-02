import React, { useEffect, useState, useCallback } from "react";
import { listCards, curateCard, listWorkspaces, type Card, type Workspace } from "../api";
import { Layout, PageTitle, Card as CardBox, Button, Spinner, EmptyState, ErrorBanner } from "../Layout";

type CurationStatus = "all" | "pending" | "approved" | "rejected" | "flagged";

const TABS: { label: string; value: CurationStatus }[] = [
  { label: "All", value: "all" },
  { label: "Pending", value: "pending" },
  { label: "Approved", value: "approved" },
  { label: "Rejected", value: "rejected" },
  { label: "Flagged", value: "flagged" },
];

const STATUS_STYLES: Record<string, { bg: string; color: string; border: string }> = {
  approved: { bg: "rgba(16,185,129,0.12)", color: "#6ee7b7", border: "rgba(16,185,129,0.25)" },
  rejected: { bg: "rgba(239,68,68,0.12)", color: "#fca5a5", border: "rgba(239,68,68,0.25)" },
  flagged:  { bg: "rgba(245,158,11,0.12)", color: "#fcd34d", border: "rgba(245,158,11,0.25)" },
  pending:  { bg: "rgba(156,141,181,0.08)", color: "#9c8db5", border: "rgba(156,141,181,0.2)" },
};

export function Cards() {
  const [cards, setCards] = useState<Card[]>([]);
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [activeWsId, setActiveWsId] = useState<string | undefined>(undefined);
  const [filterStatus, setFilterStatus] = useState<CurationStatus>("all");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actioning, setActioning] = useState<string | null>(null);
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

  const load = useCallback(async (wsId?: string, status?: CurationStatus) => {
    setError(null);
    setLoading(true);
    try {
      const fetched = await listCards(wsId, status ?? filterStatus);
      setCards(fetched);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [filterStatus]);

  useEffect(() => {
    loadWorkspaces().then(() => load(activeWsId, filterStatus));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    load(activeWsId, filterStatus);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterStatus, activeWsId]);

  async function curate(card: Card, action: "approved" | "rejected" | "flagged") {
    setActioning(card.id);
    setError(null);
    try {
      await curateCard(card.id, action, activeWsId);
      setCards((prev) =>
        prev.map((c) => c.id === card.id ? { ...c, curationStatus: action } : c)
      );
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setActioning(null);
    }
  }

  const activeWs = workspaces.find((w) => w.id === activeWsId);

  return (
    <Layout activeWorkspace={activeWs?.name}>
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
        <PageTitle>Cards</PageTitle>
        <div className="flex items-center gap-2">
          {/* Workspace picker */}
          {workspaces.length > 1 && (
            <select
              value={activeWsId ?? ""}
              onChange={(e) => setActiveWsId(e.target.value || undefined)}
              className="rounded-lg px-3 py-1.5 text-xs outline-none"
              style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.1)", color: "#c4b5fd", cursor: "pointer" }}
            >
              <option value="">All workspaces</option>
              {workspaces.map((w) => (
                <option key={w.id} value={w.id}>{w.name}</option>
              ))}
            </select>
          )}
          <Button variant="ghost" onClick={() => load(activeWsId, filterStatus)} disabled={loading} className="text-xs">
            {loading ? <Spinner /> : "Refresh"}
          </Button>
        </div>
      </div>

      {/* Filter tabs */}
      <div className="flex gap-1 mb-6 p-1 rounded-xl w-fit" style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.06)" }}>
        {TABS.map((tab) => (
          <button
            key={tab.value}
            onClick={() => setFilterStatus(tab.value)}
            className="rounded-lg px-4 py-1.5 text-xs font-semibold transition-all"
            style={{
              cursor: "pointer",
              border: "none",
              background: filterStatus === tab.value ? "rgba(124,58,237,0.25)" : "transparent",
              color: filterStatus === tab.value ? "#c4b5fd" : "#9c8db5",
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {error && <ErrorBanner message={error} />}

      {loading && cards.length === 0 ? (
        <div className="flex justify-center py-16"><Spinner /></div>
      ) : cards.length === 0 ? (
        <EmptyState
          title="No cards"
          body={filterStatus !== "all" ? `No ${filterStatus} cards in this workspace.` : "Harvest content cards first by asking Claude to open Quillby."}
        />
      ) : (
        <div className="flex flex-col gap-3">
          {cards.map((card) => {
            const status = card.curationStatus ?? "pending";
            const st = STATUS_STYLES[status] ?? STATUS_STYLES.pending;
            const isExpanded = expandedId === card.id;
            const isActioning = actioning === card.id;

            return (
              <CardBox key={card.id}>
                <div className="flex flex-col gap-3">
                  {/* Header row */}
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <button
                        onClick={() => setExpandedId(isExpanded ? null : card.id)}
                        className="text-left w-full"
                        style={{ background: "none", border: "none", cursor: "pointer", padding: 0 }}
                      >
                        <p className="font-semibold text-sm leading-snug hover:underline" style={{ color: "#f0ecfa" }}>
                          {card.title}
                        </p>
                      </button>
                      <div className="flex items-center gap-2 mt-1 flex-wrap">
                        {card.source && (
                          <span className="text-xs" style={{ color: "#9c8db5" }}>{card.source}</span>
                        )}
                        {typeof card.score === "number" && (
                          <span
                            className="rounded px-1.5 py-0.5 text-xs font-mono"
                            style={{ background: "rgba(124,58,237,0.15)", color: "#c4b5fd" }}
                          >
                            score {card.score.toFixed(1)}
                          </span>
                        )}
                        <span
                          className="rounded-full px-2 py-0.5 text-xs font-semibold"
                          style={{ background: st.bg, color: st.color, border: `1px solid ${st.border}` }}
                        >
                          {status}
                        </span>
                      </div>
                    </div>

                    {/* Curation action buttons */}
                    <div className="flex items-center gap-1.5 shrink-0">
                      {status !== "approved" && (
                        <CurateBtn
                          label="✓"
                          title="Approve"
                          activeColor="#6ee7b7"
                          disabled={isActioning}
                          onClick={() => curate(card, "approved")}
                        />
                      )}
                      {status !== "flagged" && (
                        <CurateBtn
                          label="⚑"
                          title="Flag"
                          activeColor="#fcd34d"
                          disabled={isActioning}
                          onClick={() => curate(card, "flagged")}
                        />
                      )}
                      {status !== "rejected" && (
                        <CurateBtn
                          label="✕"
                          title="Reject"
                          activeColor="#fca5a5"
                          disabled={isActioning}
                          onClick={() => curate(card, "rejected")}
                        />
                      )}
                    </div>
                  </div>

                  {/* Expanded summary */}
                  {isExpanded && card.summary && (
                    <p
                      className="text-sm leading-relaxed pt-1 border-t"
                      style={{ color: "#9c8db5", borderColor: "rgba(255,255,255,0.06)", fontFamily: "var(--font-mono, monospace)" }}
                    >
                      {card.summary}
                    </p>
                  )}
                  {isExpanded && card.url && (
                    <a
                      href={card.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs truncate"
                      style={{ color: "#7c3aed" }}
                    >
                      {card.url}
                    </a>
                  )}
                </div>
              </CardBox>
            );
          })}
        </div>
      )}
    </Layout>
  );
}

function CurateBtn({
  label,
  title,
  activeColor,
  disabled,
  onClick,
}: {
  label: string;
  title: string;
  activeColor: string;
  disabled: boolean;
  onClick: () => void;
}) {
  const [hov, setHov] = useState(false);
  return (
    <button
      title={title}
      onClick={onClick}
      disabled={disabled}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      className="w-7 h-7 flex items-center justify-center rounded-md text-xs font-bold transition-all"
      style={{
        cursor: disabled ? "not-allowed" : "pointer",
        border: "1px solid rgba(255,255,255,0.1)",
        background: hov ? `${activeColor}22` : "rgba(255,255,255,0.04)",
        color: hov ? activeColor : "#9c8db5",
        opacity: disabled ? 0.4 : 1,
      }}
    >
      {label}
    </button>
  );
}
