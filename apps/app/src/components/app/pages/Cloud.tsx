import { useState } from "react";
import { Link, Navigate } from "react-router-dom";
import { signInEmail, signUpEmail, useSession } from "../auth";

type AuthMode = "sign-in" | "sign-up";

export function Cloud() {
  const session = useSession();
  const [mode, setMode] = useState<AuthMode>("sign-in");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  if (session.data) {
    return <Navigate to="/workspaces" replace />;
  }

  async function handleSubmit(form: HTMLFormElement) {
    setError(null);
    setLoading(true);
    try {
      const data = new FormData(form);
      const emailValue = String(data.get("email") ?? "");
      const passwordValue = String(data.get("password") ?? "");
      if (mode === "sign-up") {
        const nameValue = String(data.get("name") ?? "");
        await signUpEmail(nameValue, emailValue, passwordValue);
      } else {
        await signInEmail(emailValue, passwordValue);
      }
      await session.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Authentication failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div
      className="min-h-screen px-6 py-10"
      style={{
        background:
          "radial-gradient(circle at top, rgba(124,58,237,0.18), transparent 38%), #0c0915",
        color: "#f0ecfa",
      }}
    >
      <div className="mx-auto flex max-w-3xl flex-col gap-8 rounded-[2rem] border px-8 py-10" style={{ borderColor: "rgba(255,255,255,0.08)", background: "rgba(15,11,25,0.82)" }}>
        <div className="text-xs uppercase tracking-[0.24em]" style={{ color: "#c4b5fd" }}>
          Quillby Cloud
        </div>
        <h1
          className="text-5xl font-semibold leading-tight"
          style={{ fontFamily: "var(--font-display, serif)", letterSpacing: "-0.03em" }}
        >
          Sign in to the managed dashboard.
        </h1>
        <p className="text-base leading-8" style={{ color: "rgba(240,236,250,0.72)" }}>
          Cloud users authenticate with a Quillby account and use a browser session. Connector API keys remain for Claude Connectors and other remote MCP clients, not for the primary dashboard sign-in.
        </p>
        <div className="flex gap-2 rounded-full border p-1 w-fit" style={{ borderColor: "rgba(255,255,255,0.08)", background: "rgba(255,255,255,0.04)" }}>
          {(["sign-in", "sign-up"] as AuthMode[]).map((value) => (
            <button
              key={value}
              type="button"
              onClick={() => setMode(value)}
              className="rounded-full px-4 py-2 text-sm font-semibold"
              style={{
                background: mode === value ? "rgba(124,58,237,0.24)" : "transparent",
                border: "none",
                color: mode === value ? "#f0ecfa" : "#9c8db5",
                cursor: "pointer",
              }}
            >
              {value === "sign-in" ? "Sign in" : "Create account"}
            </button>
          ))}
        </div>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void handleSubmit(e.currentTarget);
          }}
          className="grid gap-4 rounded-3xl border p-6"
          style={{ borderColor: "rgba(196,181,253,0.16)", background: "rgba(124,58,237,0.08)" }}
        >
          <div className="text-sm font-semibold" style={{ color: "#f0ecfa" }}>
            {mode === "sign-in" ? "Access your Quillby Cloud account" : "Create your Quillby Cloud account"}
          </div>
          {mode === "sign-up" && (
            <label className="grid gap-2 text-sm">
              <span style={{ color: "#c4b5fd" }}>Name</span>
              <input
                required
                name="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="rounded-xl px-4 py-3"
                style={{ background: "rgba(12,9,21,0.7)", border: "1px solid rgba(255,255,255,0.08)", color: "#f0ecfa" }}
              />
            </label>
          )}
          <label className="grid gap-2 text-sm">
            <span style={{ color: "#c4b5fd" }}>Email</span>
            <input
              required
              type="email"
              name="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="rounded-xl px-4 py-3"
              style={{ background: "rgba(12,9,21,0.7)", border: "1px solid rgba(255,255,255,0.08)", color: "#f0ecfa" }}
            />
          </label>
          <label className="grid gap-2 text-sm">
            <span style={{ color: "#c4b5fd" }}>Password</span>
            <input
              required
              type="password"
              name="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="rounded-xl px-4 py-3"
              style={{ background: "rgba(12,9,21,0.7)", border: "1px solid rgba(255,255,255,0.08)", color: "#f0ecfa" }}
            />
          </label>
          {error && (
            <div className="rounded-xl px-4 py-3 text-sm" style={{ background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.2)", color: "#fca5a5" }}>
              {error}
            </div>
          )}
          <button
            type="submit"
            disabled={loading || session.isPending}
            className="rounded-full px-4 py-3 text-sm font-semibold"
            style={{ background: "linear-gradient(135deg, #6d28d9, #7c3aed)", border: "none", color: "#fff", cursor: "pointer" }}
          >
            {loading ? "Working..." : mode === "sign-in" ? "Sign in" : "Create account"}
          </button>
        </form>
        <div className="flex flex-wrap gap-3">
          <Link
            to="/connect/self-hosted"
            className="rounded-full px-4 py-2 no-underline"
            style={{ color: "#c4b5fd", background: "rgba(124,58,237,0.12)", border: "1px solid rgba(196,181,253,0.16)" }}
          >
            Use a self-hosted server instead
          </Link>
          <a
            href="http://localhost:4321/cloud"
            className="rounded-full px-4 py-2 no-underline"
            style={{ color: "#f0ecfa", background: "rgba(255,255,255,0.08)", border: "1px solid rgba(255,255,255,0.12)" }}
          >
            Read the cloud overview
          </a>
        </div>
      </div>
    </div>
  );
}
