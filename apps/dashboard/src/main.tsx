import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";

function App() {
  return (
    <main className="shell">
      <aside className="sidebar glass">
        <div className="brand">
          <span className="brand-mark">D</span>
          <div>
            <strong>DevOne</strong>
            <small>Server</small>
          </div>
        </div>
        <nav>
          <a className="active">Dashboard</a>
          <a>Websites</a>
          <a>Applications</a>
          <a>Databases</a>
          <a>Containers</a>
          <a>Software</a>
          <a>Cloudflare</a>
          <a>DevOne AI</a>
          <a>Settings</a>
        </nav>
      </aside>

      <section className="content">
        <header className="topbar glass">
          <div>
            <span className="eyebrow">SERVER CONTROL</span>
            <h1>Good morning</h1>
          </div>
          <div className="status-pill"><span /> System healthy</div>
        </header>

        <section className="hero">
          <div>
            <span className="eyebrow">DEVONE SERVER 1.0</span>
            <h2>Your server, managed beautifully.</h2>
            <p>Management starts with a reliable foundation. Phase 1 is building the control plane, Agent boundary, security model, and deployment-ready dashboard.</p>
          </div>
        </section>

        <section className="metrics">
          {[
            ["CPU", "—", "Waiting for Agent"],
            ["Memory", "—", "Waiting for Agent"],
            ["Storage", "—", "Waiting for Agent"],
            ["Services", "—", "Waiting for Agent"]
          ].map(([label, value, detail]) => (
            <article className="card glass" key={label}>
              <span>{label}</span>
              <strong>{value}</strong>
              <small>{detail}</small>
            </article>
          ))}
        </section>

        <section className="grid">
          <article className="card glass wide">
            <div className="card-heading"><h3>Websites</h3><button>+ Add Website</button></div>
            <div className="empty">No websites have been configured yet.</div>
          </article>
          <article className="card glass">
            <div className="card-heading"><h3>DevOne AI</h3></div>
            <p className="muted">Connect Google Gemini from Settings to enable server diagnostics and controlled AI operations.</p>
            <button className="secondary">Configure AI</button>
          </article>
        </section>
      </section>
    </main>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode><App /></StrictMode>
);
