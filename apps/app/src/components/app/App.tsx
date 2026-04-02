import React, { Component } from "react";
import { HashRouter, Routes, Route, Navigate, useLocation } from "react-router-dom";
import { useSession } from "./auth";
import { getConnection } from "./api";
import { Home } from "./pages/Home";
import { Cloud } from "./pages/Cloud";
import { Connect } from "./pages/Connect";
import { Workspaces } from "./pages/Workspaces";
import { Cards } from "./pages/Cards";
import { Drafts } from "./pages/Drafts";
import { Connectors } from "./pages/Connectors";

class ErrorBoundary extends Component<
  { children: React.ReactNode },
  { error: Error | null }
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { error: null };
  }
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  render() {
    if (this.state.error) {
      return (
        <div style={{ padding: "2rem", color: "#f87171", fontFamily: "monospace", background: "#0c0915", minHeight: "100vh" }}>
          <h2 style={{ color: "#f87171", marginBottom: "1rem" }}>App Error</h2>
          <pre style={{ whiteSpace: "pre-wrap", color: "#fca5a5" }}>{this.state.error.message}</pre>
          <pre style={{ whiteSpace: "pre-wrap", color: "#9ca3af", marginTop: "1rem", fontSize: "0.75rem" }}>{this.state.error.stack}</pre>
        </div>
      );
    }
    return this.props.children;
  }
}

/** Redirect to the hosted entrypoint if there is no saved self-hosted connection. */
function RequireAuth({ children }: { children: React.ReactNode }) {
  const location = useLocation();
  const conn = getConnection();
  const session = useSession();

  if (session.isPending) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: "#0c0915", color: "#f0ecfa" }}>
        Loading Quillby…
      </div>
    );
  }

  if (!conn && !session.data) {
    return <Navigate to="/" state={{ from: location }} replace />;
  }
  return <>{children}</>;
}

export function App() {
  return (
    <ErrorBoundary>
      <HashRouter>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/cloud" element={<Cloud />} />
          <Route path="/connect" element={<Navigate to="/connect/self-hosted" replace />} />
          <Route path="/connect/self-hosted" element={<Connect />} />
          <Route
            path="/workspaces"
            element={
              <RequireAuth>
                <Workspaces />
              </RequireAuth>
            }
          />
          <Route
            path="/cards"
            element={
              <RequireAuth>
                <Cards />
              </RequireAuth>
            }
          />
          <Route
            path="/drafts"
            element={
              <RequireAuth>
                <Drafts />
              </RequireAuth>
            }
          />
          <Route
            path="/connectors"
            element={
              <RequireAuth>
                <Connectors />
              </RequireAuth>
            }
          />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </HashRouter>
    </ErrorBoundary>
  );
}
