import { SitesWorkspace } from "./SitesWorkspace";
import { StrictMode, useEffect, useState, type FormEvent } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";

type Job = { id: string; operation: string; input: string; state: string; error: string | null; created_at: string };
type Status = { user: { email: string; role: string }; agent: { ok: boolean }; metrics: { ok: boolean; hostname?: string; cpuCount?: number; load?: number[]; memoryTotal?: number; memoryFree?: number; uptime?: number } };
function App() {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [secrets, setSecrets] = useState<{name: string; updated_at: string}[]>([]);
  const [secretName, setSecretName] = useState("");
  const [secretValue, setSecretValue] = useState("");
  const [notice, setNotice] = useState("");
  const [services, setServices] = useState<{service: string; ActiveState: string}[]>([]);
  const [status, setStatus] = useState<Status | null>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  async function refresh() {
    try {
      const response = await fetch("/api/system/status");
      if (response.status === 401) { setStatus(null); setSecretValue(""); setSecrets([]); setJobs([]); return; }
      if (!response.ok) throw new Error("Server status unavailable");
      setStatus(await response.json()); setError("");
      const serviceResponse = await fetch("/api/services");
      if (serviceResponse.ok) setServices((await serviceResponse.json()).services);
      const jobResponse = await fetch("/api/jobs");
      if (jobResponse.ok) setJobs((await jobResponse.json()).jobs);
      const secretResponse = await fetch("/api/secrets");
      if (secretResponse.ok) setSecrets((await secretResponse.json()).secrets); else setSecrets([]);
    } catch (e) { setError(e instanceof Error ? e.message : "Connection failed"); }
    finally { setLoading(false); }
  }
  useEffect(() => { void refresh(); const timer = setInterval(() => void refresh(), 15000); return () => clearInterval(timer); }, []);
  async function signIn(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError("");
    try {
      const response = await fetch("/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password }) });
      if (!response.ok) throw new Error(response.status === 429 ? "Too many attempts. Try again in a minute." : "Sign-in failed. Check your credentials.");
      setPassword(""); await refresh();
    } catch (e) { setError(e instanceof Error ? e.message : "Sign-in failed"); }
    finally { setBusy(false); }
  }
  async function serviceAction(service: string, action: string) {
    if (!window.confirm(`${action} ${service}? This can interrupt hosted applications and panel access.`)) return;
    setBusy(true);
    try {
      const response = await fetch("/api/services/action", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ service, action, confirmed: true, requestKey: crypto.randomUUID() }) });
      if (!response.ok) throw new Error("Service action failed. Check server logs.");
      const { job } = await response.json();
      setNotice(`Service action queued: ${job.id}`);
      await refresh();
    } catch (e) { setError(e instanceof Error ? e.message : "Service action failed"); }
    finally { setBusy(false); }
  }
  async function saveSecret(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError("");
    try {
      const response = await fetch(`/api/secrets/${encodeURIComponent(secretName)}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ value: secretValue }) });
      if (!response.ok) throw new Error("Secret could not be saved. Check vault configuration.");
      setSecretValue(""); setNotice(`Saved ${secretName}.`); await refresh();
    } catch (e) { setError(e instanceof Error ? e.message : "Save failed"); }
    finally { setBusy(false); }
  }
  async function deleteSecret(name: string) {
    if (!window.confirm(`Delete stored secret ${name}?`)) return;
    setBusy(true);
    try { const response = await fetch(`/api/secrets/${encodeURIComponent(name)}`, { method: "DELETE" }); if (!response.ok) throw new Error("Delete failed"); await refresh(); }
    catch { setError("Secret could not be deleted."); }
    finally { setBusy(false); }
  }
  async function signOut() {
    try { const r = await fetch("/api/auth/logout", { method: "POST" }); if (!r.ok) throw new Error("Sign-out failed"); setStatus(null); setSecretValue(""); setSecrets([]); setJobs([]); setNotice(""); }
    catch { setError("Sign-out failed. Try again."); }
  }
  if (loading) return <main className="shell"><section className="content"><p>Connecting to DevOne…</p></section></main>;
  if (!status) return <main className="shell"><section className="content"><form className="card glass" onSubmit={signIn}><span className="eyebrow">DEVONE SERVER</span><h1>Welcome back</h1><p>Sign in with the owner account created by your installer.</p><label>Email<input type="email" autoComplete="username" required value={email} onChange={e => setEmail(e.target.value)} /></label><label>Password<input type="password" autoComplete="current-password" required value={password} onChange={e => setPassword(e.target.value)} /></label>{error && <p role="alert">{error}</p>}<button disabled={busy}>{busy ? "Signing in…" : "Sign in"}</button></form></section></main>;
  const m = status.metrics;
  const metrics = [["CPU cores", m.ok ? String(m.cpuCount) : "Unavailable"], ["Memory used", m.ok ? `${(((m.memoryTotal ?? 0) - (m.memoryFree ?? 0)) / 1073741824).toFixed(2)} GiB` : "Unavailable"], ["Load (1 minute)", m.ok ? m.load?.[0]?.toFixed(2) ?? "Unavailable" : "Unavailable"], ["Uptime", m.ok ? `${Math.floor((m.uptime ?? 0) / 3600)} hours` : "Unavailable"]];
  return <main className="shell"><aside className="sidebar glass"><div className="brand"><span className="brand-mark">D</span><div><strong>DevOne</strong><small>Server</small></div></div><nav><a className="active" href="#overview">Dashboard</a></nav><p className="muted">Node edition · Foundation</p></aside><section className="content" id="overview"><header className="topbar glass"><div><span className="eyebrow">SERVER CONTROL</span><h1>{m.hostname ?? "Your server"}</h1><small>{status.user.email}</small></div><button onClick={() => void signOut()}>Sign out</button></header>{error && <p role="alert">{error}</p>}{notice && <p role="status">{notice}</p>}<section className="hero"><h2>Server overview</h2><p>Agent: {status.agent.ok ? "Connected" : "Unavailable"}. Metrics refresh every 15 seconds.</p></section><section className="metrics">{metrics.map(([label, value]) => <article className="card glass" key={label}><span>{label}</span><strong>{value}</strong></article>)}</section><article className="card glass"><h3>Services</h3>{services.map(service => <div key={service.service}><strong>{service.service}</strong> · {service.ActiveState} {["start", "stop", "restart"].map(action => <button key={action} disabled={busy || !["owner", "admin"].includes(status.user.role)} onClick={() => void serviceAction(service.service, action)}>{action}</button>)}</div>)}</article><article className="card glass"><h3>Recent jobs</h3>{jobs.length ? <table><thead><tr><th>Operation</th><th>Status</th><th>Result</th></tr></thead><tbody>{jobs.map(job => <tr key={job.id}><td>{job.input}</td><td>{job.state}</td><td>{job.error ?? "—"}</td></tr>)}</tbody></table> : <p>No jobs yet.</p>}<p className="muted">Interrupted jobs need inspection before requesting the action again.</p></article>{status.user.role === "owner" && <article className="card glass"><h3>Encrypted secrets</h3><p>Store credentials for upcoming integrations. Stored values cannot be viewed here.</p><form onSubmit={saveSecret}><label>Name<input required pattern="[a-z][a-z0-9_.-]{0,63}" maxLength={64} value={secretName} onChange={e => setSecretName(e.target.value)} /></label><label>Value<input required type="password" autoComplete="off" maxLength={8192} value={secretValue} onChange={e => setSecretValue(e.target.value)} /></label><button disabled={busy}>Save secret</button></form>{secrets.map(secret => <div key={secret.name}>{secret.name} <small>{new Date(secret.updated_at).toLocaleString()}</small> <button disabled={busy} onClick={() => void deleteSecret(secret.name)}>Delete</button></div>)}</article>}{["owner", "admin"].includes(status.user.role) && <SitesWorkspace />}<article className="card glass"><h3>Management modules</h3><p>The complete 0.7.0 distribution is available through the separate legacy installer. Static websites and file operations are being ported; databases, containers, application installation and AI remain pending to this Node edition.</p></article></section></main>;
}
createRoot(document.getElementById("root")!).render(<StrictMode><App /></StrictMode>);
