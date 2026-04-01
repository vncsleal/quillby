import React, { Component } from "react";
import { HashRouter, Routes, Route, Navigate, useLocation } from "react-router-dom";
import { getConnection } from "./api";
import { Connect } from "./pages/Connect";
import { Workspaces } from "./pages/Workspaces";
import { Cards } from "./pages/Cards";
import { Drafts } from "./pages/Drafts";

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

/** Redirect to /connect if there is no saved connection. */
function RequireAuth({ children }: { children: React.ReactNode }) {
  const location = useLocation();
  const conn = getConnection();
  if (!conn) {
    return <Navigate to="/connect" state={{ from: location }} replace />;
  }
  return <>{children}</>;
}

export function App() {
  return (
    <ErrorBoundary>
      <HashRouter>
        <Routes>
          <Route path="/connect" element={<Connect />} />
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
          {/* Default: go to workspaces if connected, else connect */}
          <Route path="*" element={<Navigate to="/workspaces" replace />} />
        </Routes>
      </HashRouter>
    </ErrorBoundary>
  );
}
