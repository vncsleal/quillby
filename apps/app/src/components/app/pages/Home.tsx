import { Link, Navigate } from "react-router-dom";
import { useSession } from "../auth";
import { getConnection } from "../api";

function ActionCard({
  title,
  body,
  href,
  cta,
  tone = "primary",
}: {
  title: string;
  body: string;
  href: string;
  cta: string;
  tone?: "primary" | "secondary";
}) {
  const style =
    tone === "primary"
      ? {
          background: "linear-gradient(160deg, rgba(124,58,237,0.24), rgba(14,9,24,0.96))",
          border: "1px solid rgba(196,181,253,0.22)",
        }
      : {
          background: "rgba(255,255,255,0.04)",
          border: "1px solid rgba(255,255,255,0.08)",
        };

  return (
    <Link
      to={href}
      className="rounded-3xl p-6 no-underline transition-transform hover:-translate-y-0.5"
      style={{ ...style, color: "#f0ecfa" }}
    >
      <div className="text-xs uppercase tracking-[0.22em]" style={{ color: "#c4b5fd" }}>
        {tone === "primary" ? "Managed" : "Bring your own server"}
      </div>
      <h2
        className="mt-3 text-2xl font-semibold"
        style={{ fontFamily: "var(--font-display, serif)", letterSpacing: "-0.02em" }}
      >
        {title}
      </h2>
      <p className="mt-3 text-sm leading-7" style={{ color: "rgba(240,236,250,0.72)" }}>
        {body}
      </p>
      <div className="mt-6 text-sm font-semibold" style={{ color: "#c4b5fd" }}>
        {cta}
      </div>
    </Link>
  );
}

export function Home() {
  const conn = getConnection();
  const session = useSession();

  if (conn || session.data) {
    return <Navigate to="/workspaces" replace />;
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
      <div className="mx-auto flex max-w-5xl flex-col gap-10">
        <header className="flex flex-col gap-5 rounded-[2rem] border px-8 py-10" style={{ borderColor: "rgba(255,255,255,0.08)", background: "rgba(15,11,25,0.82)" }}>
          <div className="text-xs uppercase tracking-[0.24em]" style={{ color: "#c4b5fd" }}>
            Hosted Quillby
          </div>
          <h1
            className="max-w-3xl text-5xl font-semibold leading-tight"
            style={{ fontFamily: "var(--font-display, serif)", letterSpacing: "-0.03em" }}
          >
            Choose how this dashboard should reach your Quillby workspace.
          </h1>
          <p className="max-w-2xl text-base leading-8" style={{ color: "rgba(240,236,250,0.72)" }}>
            Quillby Cloud uses a managed account flow. Self-hosted users connect this dashboard to their own Quillby HTTP endpoint.
          </p>
          <div className="flex flex-wrap gap-3 text-sm">
            <a
              href="http://localhost:4321/cloud"
              className="rounded-full px-4 py-2 no-underline"
              style={{ color: "#f0ecfa", background: "rgba(255,255,255,0.08)", border: "1px solid rgba(255,255,255,0.12)" }}
            >
              Cloud overview
            </a>
            <a
              href="http://localhost:4321/self-host"
              className="rounded-full px-4 py-2 no-underline"
              style={{ color: "#c4b5fd", background: "rgba(124,58,237,0.12)", border: "1px solid rgba(196,181,253,0.16)" }}
            >
              Self-host guide
            </a>
          </div>
        </header>

        <section className="grid gap-6 md:grid-cols-2">
          <ActionCard
            title="Quillby Cloud"
            body="Use the managed hosted product. This dashboard should sign you in with a Quillby account and attach to the managed backend automatically."
            href="/cloud"
            cta="Open cloud entry →"
            tone="primary"
          />
          <ActionCard
            title="Self-hosted Quillby"
            body="Connect this dashboard to your own deployed Quillby server with its URL and API key. This is the right path for Docker or custom deployments."
            href="/connect/self-hosted"
            cta="Connect self-hosted server →"
            tone="secondary"
          />
        </section>
      </div>
    </div>
  );
}
