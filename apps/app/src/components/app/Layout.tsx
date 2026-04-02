import React from "react";
import { NavLink, useNavigate } from "react-router-dom";
import { signOut, useSession } from "./auth";
import { clearConnection, getConnection } from "./api";

interface LayoutProps {
  children: React.ReactNode;
  activeWorkspace?: string;
}

export function Layout({ children, activeWorkspace }: LayoutProps) {
  const navigate = useNavigate();
  const conn = getConnection();
  const session = useSession();

  async function disconnect() {
    if (!conn && session.data) {
      await signOut();
      navigate("/");
      return;
    }
    clearConnection();
    navigate("/");
  }

  const serverDisplay = conn?.serverUrl
    ? conn.serverUrl.replace(/^https?:\/\//, "")
    : session.data?.user.email ?? "";

  return (
    <div className="min-h-screen flex flex-col" style={{ background: "#0c0915", color: "#f0ecfa" }}>
      {/* Top nav */}
      <nav
        className="sticky top-0 z-50 flex items-center justify-between px-6 h-14 border-b"
        style={{ borderColor: "rgba(255,255,255,0.08)", background: "rgba(12,9,21,0.85)", backdropFilter: "blur(16px)" }}
      >
        {/* Left: logo + nav links */}
        <div className="flex items-center gap-8">
          <a href="/" className="flex items-center gap-2 no-underline" style={{ color: "#f0ecfa" }}>
            <span style={{ fontFamily: "var(--font-display, serif)", fontSize: "1.15rem", fontWeight: 700, letterSpacing: "-0.01em" }}>
              Quillby
            </span>
            <span
              className="rounded px-1.5 py-0.5 text-xs font-semibold"
              style={{ background: "rgba(124,58,237,0.25)", color: "#c4b5fd", fontSize: "0.65rem", letterSpacing: "0.06em" }}
            >
              APP
            </span>
          </a>
          <div className="flex items-center gap-1">
            <NavItem to="/workspaces" label="Workspaces" />
            <NavItem to="/cards" label="Cards" />
            <NavItem to="/drafts" label="Drafts" />
            <NavItem to="/connectors" label="Connectors" />
          </div>
        </div>

        {/* Right: workspace badge + server + disconnect */}
        <div className="flex items-center gap-3">
          {activeWorkspace && (
            <span
              className="rounded-full px-3 py-1 text-xs font-medium"
              style={{ background: "rgba(124,58,237,0.18)", color: "#c4b5fd", border: "1px solid rgba(196,181,253,0.2)" }}
            >
              {activeWorkspace}
            </span>
          )}
          <span className="text-xs font-mono hidden sm:block" style={{ color: "#9c8db5" }}>
            {serverDisplay}
          </span>
          <button
            onClick={disconnect}
            className="text-xs px-3 py-1.5 rounded-md transition-colors"
            style={{ color: "#9c8db5", border: "1px solid rgba(255,255,255,0.08)", background: "transparent", cursor: "pointer" }}
            onMouseEnter={(e) => { (e.target as HTMLButtonElement).style.color = "#f0ecfa"; }}
            onMouseLeave={(e) => { (e.target as HTMLButtonElement).style.color = "#9c8db5"; }}
          >
            {conn ? "Disconnect" : "Sign out"}
          </button>
        </div>
      </nav>

      {/* Page content */}
      <main className="flex-1 px-6 py-8 max-w-5xl mx-auto w-full">
        {children}
      </main>
    </div>
  );
}

function NavItem({ to, label }: { to: string; label: string }) {
  return (
    <NavLink
      to={to}
      className="px-3 py-1.5 rounded-md text-sm font-medium transition-colors"
      style={({ isActive }) => ({
        color: isActive ? "#f0ecfa" : "#9c8db5",
        background: isActive ? "rgba(255,255,255,0.07)" : "transparent",
        textDecoration: "none",
      })}
    >
      {label}
    </NavLink>
  );
}

// ─── Reusable primitives ──────────────────────────────────────────────────────

export function PageTitle({ children }: { children: React.ReactNode }) {
  return (
    <h1
      className="text-2xl font-bold mb-6"
      style={{ fontFamily: "var(--font-display, serif)", letterSpacing: "-0.02em", color: "#f0ecfa" }}
    >
      {children}
    </h1>
  );
}

export function Card({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <div
      className={`rounded-xl p-5 ${className}`}
      style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)" }}
    >
      {children}
    </div>
  );
}

export function Button({
  children,
  onClick,
  variant = "primary",
  disabled = false,
  className = "",
  type = "button",
}: {
  children: React.ReactNode;
  onClick?: () => void;
  variant?: "primary" | "secondary" | "danger" | "ghost";
  disabled?: boolean;
  className?: string;
  type?: "button" | "submit";
}) {
  const base = "inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition-all cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed";
  const styles: Record<string, React.CSSProperties> = {
    primary: { background: "linear-gradient(135deg, #6d28d9, #7c3aed)", color: "#fff", border: "none", boxShadow: "0 0 20px rgba(124,58,237,0.3)" },
    secondary: { background: "rgba(255,255,255,0.06)", color: "#c4b5fd", border: "1px solid rgba(255,255,255,0.1)" },
    danger: { background: "rgba(239,68,68,0.12)", color: "#fca5a5", border: "1px solid rgba(239,68,68,0.25)" },
    ghost: { background: "transparent", color: "#9c8db5", border: "1px solid rgba(255,255,255,0.08)" },
  };
  return (
    <button type={type} onClick={onClick} disabled={disabled} className={`${base} ${className}`} style={styles[variant]}>
      {children}
    </button>
  );
}

export function Spinner() {
  return (
    <div
      className="inline-block w-5 h-5 rounded-full border-2 animate-spin"
      style={{ borderColor: "rgba(196,181,253,0.2)", borderTopColor: "#7c3aed" }}
    />
  );
}

export function EmptyState({ title, body }: { title: string; body?: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-20 text-center">
      <p className="text-lg font-semibold mb-2" style={{ color: "#9c8db5" }}>{title}</p>
      {body && <p className="text-sm" style={{ color: "rgba(156,141,181,0.6)" }}>{body}</p>}
    </div>
  );
}

export function ErrorBanner({ message }: { message: string }) {
  return (
    <div
      className="rounded-xl px-4 py-3 text-sm mb-4"
      style={{ background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.2)", color: "#fca5a5" }}
    >
      {message}
    </div>
  );
}
