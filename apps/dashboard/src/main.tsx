import { SitesWorkspace } from "./SitesWorkspace";
import { SetupWizard } from "./SetupWizard";
import { ControlWorkspace, type ControlView } from "./ControlWorkspace";
import { DashboardInsights } from "./ManagementModules";
import { UpdatesWorkspace } from "./UpdatesWorkspace";
import { StrictMode, useEffect, useState, type FormEvent, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";


type GlyphName = string;
function Glyph({name,className}:{name:GlyphName;className?:string}) {
  const paths:Record<string,ReactNode> = {
    grid:<><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/></>,
    layers:<><path d="m12 3 9 5-9 5-9-5 9-5Z"/><path d="m3 12 9 5 9-5M3 16l9 5 9-5"/></>,
    globe:<><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c-5 5-5 13 0 18M12 3c5 5 5 13 0 18"/></>,
    activity:<><path d="M3 12h4l3-8 4 16 3-8h4"/></>,
    lock:<><rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/></>,
    shield:<><path d="m12 2 9 4v6c0 5-3.5 8.5-9 10-5.5-1.5-9-5-9-10V6l9-4Z"/><path d="m9 12 2 2 4-4"/></>,
    zap:<path d="m13 2-9 12h7l-1 8 10-12h-7V2Z"/>,
    mail:<><rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/></>,
    eye:<><path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/></>,
    "eye-off":<><path d="M3 3 21 21M9.9 5.2A11 11 0 0 1 12 5c6 0 10 7 10 7a15 15 0 0 1-3 3.7M6 7C3.5 9 2 12 2 12s4 7 10 7a10.5 10.5 0 0 0 4.2-.9"/><path d="M10 10a3 3 0 0 0 4 4"/></>,
    arrow:<><path d="M4 12h16m-7-7 7 7-7 7"/></>,
    chevron:<path d="m9 5 7 7-7 7"/>,
    check:<path d="m4 12 5 5L20 6"/>,
    alert:<><circle cx="12" cy="12" r="10"/><path d="M12 7v6m0 4h.01"/></>,
    logout:<><path d="M10 4H5a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h5M15 7l5 5-5 5m5-5H9"/></>,
    server:<><rect x="3" y="3" width="18" height="8" rx="2"/><rect x="3" y="13" width="18" height="8" rx="2"/><path d="M7 7h.01M7 17h.01"/></>,
    cpu:<><rect x="5" y="5" width="14" height="14" rx="2"/><rect x="9" y="9" width="6" height="6"/><path d="M9 1v4m6-4v4M9 19v4m6-4v4M1 9h4m-4 6h4m14-6h4m-4 6h4"/></>,
    memory:<><rect x="3" y="7" width="18" height="10" rx="2"/><path d="M7 10v4m4-4v4m4-4v4M7 17v3m5-3v3m5-3v3"/></>,
    clock:<><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></>,
    database:<><ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M3 5v14c0 2 4 3 9 3s9-1 9-3V5M3 12c0 2 4 3 9 3s9-1 9-3"/></>,
    backup:<><path d="M3 12a9 9 0 1 0 3-6M3 4v5h5M12 7v5l3 2"/></>,
    box:<><path d="m12 2 9 5v10l-9 5-9-5V7l9-5Zm-9 5 9 5 9-5M12 12v10"/></>,
    chart:<><path d="M3 3v18h18M7 16l4-5 3 2 5-7"/></>,
    terminal:<><rect x="2" y="4" width="20" height="16" rx="2"/><path d="m6 9 3 3-3 3m5 0h6"/></>
  };
  return <svg className={className} width="20" height="20" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">{paths[name]??paths.box}</svg>;
}
function Brand({compact=false}:{compact?:boolean}) {
  return <div className={"brand-lockup"+(compact?" brand-compact":"")}><div className="logo-mark"><Glyph name="layers"/></div><div className="brand-text"><strong>DEVONE <span>SERVER</span></strong>{!compact&&<small>Your Server. Simplified.</small>}</div></div>;
}

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
  const [setupRequired, setSetupRequired] = useState<boolean | null>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [view, setView] = useState<"dashboard" | "websites" | "services" | "activity" | "secrets" | "updates" | ControlView>("dashboard");
  const [showPassword, setShowPassword] = useState(false);
  const [sites, setSites] = useState<{id:string;domain:string;state:string;webServer:string;tls?:boolean}[]>([]);

  async function refresh() {
    try {
      const response = await fetch("/api/system/status");
      if (response.status === 401) {
        setStatus(null); setSecretValue(""); setSecrets([]); setJobs([]); setSites([]);
        const setupResponse = await fetch("/api/setup/status", { cache: "no-store" });
        if (!setupResponse.ok) throw new Error("Initial setup status is unavailable");
        setSetupRequired(Boolean((await setupResponse.json()).setupRequired));
        return;
      }
      if (!response.ok) throw new Error("Server status unavailable");
      const nextStatus: Status = await response.json(); setStatus(nextStatus); setSetupRequired(false); setError("");
      const serviceResponse = await fetch("/api/services");
      if (serviceResponse.ok) setServices((await serviceResponse.json()).services);
      if (["owner", "admin"].includes(nextStatus.user.role)) {
        const sitesResponse = await fetch("/api/sites");
        if (sitesResponse.ok) setSites((await sitesResponse.json()).sites);
      }

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

  const navItems: Array<{id: typeof view; label:string; icon:string}> = [
    {id:"dashboard",label:"Dashboard",icon:"grid"},
    {id:"websites",label:"Websites & Files",icon:"globe"},
    {id:"services",label:"Services",icon:"layers"},
    {id:"activity",label:"Activity & Jobs",icon:"activity"},
    {id:"apps",label:"Apps & Runtimes",icon:"box"},
    {id:"databases",label:"Databases",icon:"database"},
    {id:"monitoring",label:"Monitoring",icon:"chart"},
    {id:"security",label:"Security Center",icon:"shield"},
    {id:"qa",label:"QA Center",icon:"shield"}
  ];
  if (status?.user.role === "owner") {
    navItems.push({id:"backups",label:"Backups",icon:"backup"});
    navItems.push({id:"secrets",label:"Secure Vault",icon:"lock"});
    navItems.push({id:"updates",label:"Software Updates",icon:"backup"});
  }
  navItems.push({id:"ai",label:"DevOne AI",icon:"zap"});
  if (loading) return <div className="loading-screen"><div className="loading-mark"><Glyph name="layers" /></div><strong>DEVONE <span>SERVER</span></strong><p>Establishing a secure connection…</p></div>;
  if (setupRequired) return <SetupWizard onComplete={() => { setSetupRequired(false); setNotice("Owner account created. Welcome to DevOne Server."); void refresh(); }} />;
  if (!status) return (
    <main className="auth-screen">
      <header className="auth-masthead"><Brand /><span className="auth-masthead-detail">POWERFUL <span>·</span> SECURE <span>·</span> BUILT FOR DEVELOPERS</span></header>
      <div className="auth-frame glass">
        <section className="auth-story">
          <div className="auth-story-copy">
            <span className="overline">DEVONE SERVER</span>
            <h1>Welcome back.</h1>
            <p>One beautiful place to manage your server, websites, and services.</p>
            <div className="auth-features">
              <div><span className="feature-icon"><Glyph name="zap" /></span><span><strong>Fast & secure</strong><small>Performance built into the platform</small></span></div>
              <div><span className="feature-icon"><Glyph name="layers" /></span><span><strong>All-in-one control</strong><small>Your infrastructure, beautifully organized</small></span></div>
              <div><span className="feature-icon"><Glyph name="shield" /></span><span><strong>Designed for developers</strong><small>Power and clarity without compromise</small></span></div>
            </div>
          </div>
          <div className="server-art" aria-hidden="true">
            <div className="art-halo" />
            <div className="art-cloud cloud-left" /><div className="art-cloud cloud-right" />
            <div className="art-base" />
            <div className="art-stack">
              <div className="art-unit"><i/><b/><em/></div>
              <div className="art-unit"><i/><b/><em/></div>
              <div className="art-unit"><i/><b/><em/></div>
            </div>
            <div className="art-floating art-one"><Glyph name="globe" /></div>
            <div className="art-floating art-two"><Glyph name="terminal" /></div>
            <div className="art-floating art-three"><Glyph name="shield" /></div>
          </div>
          <p className="story-footnote">YOUR SERVER. SIMPLIFIED.</p>
        </section>
        <section className="auth-panel">
          <div className="auth-panel-top"><span className="secure-label"><Glyph name="shield" /> Secure owner access</span><span className="auth-panel-logo"><Glyph name="layers" /></span></div>
          <form className="sign-in-form" onSubmit={signIn}>
            <span className="form-kicker">WELCOME TO DEVONE</span>
            <h2>Sign in to your account</h2>
            <p>Access your DevOne Server control panel.</p>
            <label htmlFor="owner-email">Email address</label>
            <div className="input-wrap"><Glyph name="mail" /><input id="owner-email" type="email" autoComplete="username" required autoFocus value={email} onChange={e => setEmail(e.target.value)} placeholder="owner@example.com" /></div>
            <label htmlFor="owner-password">Password</label>
            <div className="input-wrap"><Glyph name="lock" /><input id="owner-password" type={showPassword ? "text" : "password"} autoComplete="current-password" required value={password} onChange={e => setPassword(e.target.value)} placeholder="Enter your password" /><button className="input-action" type="button" onClick={() => setShowPassword(!showPassword)} aria-label={showPassword ? "Hide password" : "Show password"}><Glyph name={showPassword ? "eye-off" : "eye"} /></button></div>
            {error && <p role="alert" className="auth-error"><Glyph name="alert" /> {error}</p>}
            <button className="primary-button signin-button" type="submit" disabled={busy}>{busy ? "Signing in…" : "Sign in securely"} <Glyph name="arrow" /></button>
            <div className="auth-privacy"><Glyph name="shield" /> Protected connection · Your credentials stay on your server</div>
          </form>
          <div className="auth-panel-footer"><span>DEVONE SERVER</span><span>Node edition</span></div>
        </section>
      </div>
      <footer className="auth-footer">DEVONE SERVER <span>·</span> YOUR INFRASTRUCTURE. IN YOUR CONTROL.</footer>
    </main>
  );

  const m = status.metrics;
  const memoryUsed = m.ok && m.memoryTotal ? m.memoryTotal - (m.memoryFree ?? 0) : 0;
  const memoryPercent = m.ok && m.memoryTotal ? Math.max(0,Math.min(100,Math.round(memoryUsed / m.memoryTotal * 100))) : null;
  const uptimeHours = m.ok && typeof m.uptime === "number" ? Math.floor(m.uptime / 3600) : null;
  const uptimeLabel = uptimeHours === null ? "Unavailable" : Math.floor(uptimeHours / 24) + "d " + (uptimeHours % 24) + "h";
  const activeServices = services.filter(service=>service.ActiveState === "active").length;
  const agentOnline = Boolean(status.agent.ok);
  const canManage = ["owner","admin"].includes(status.user.role);
  const resourceCards = [
    {label:"CPU cores",value:m.ok && m.cpuCount !== undefined ? String(m.cpuCount) : "—",detail:"Logical processors",icon:"cpu",tone:"violet"},
    {label:"Memory used",value:memoryPercent === null ? "—" : memoryPercent + "%",detail:m.ok ? (memoryUsed / 1073741824).toFixed(1) + " of " + ((m.memoryTotal ?? 0)/1073741824).toFixed(1) + " GiB" : "Metrics unavailable",icon:"memory",tone:"blue"},
    {label:"System load",value:m.ok && m.load?.[0] !== undefined ? m.load[0].toFixed(2) : "—",detail:"1-minute load average",icon:"activity",tone:"pink"},
    {label:"Uptime",value:uptimeLabel,detail:"Since last restart",icon:"clock",tone:"green"}
  ];
  const contentTitle: Record<typeof view,string>={dashboard:"Dashboard",websites:"Websites & files",services:"Services",activity:"Activity & jobs",secrets:"Secure vault",apps:"Apps & runtimes",databases:"Databases",backups:"Backups",monitoring:"Monitoring",qa:"QA Center",ai:"DevOne AI",security:"Security Center",updates:"Software Updates"};
  const jobsTable = <div className="table-scroll"><table className="data-table"><thead><tr><th>Operation</th><th>Status</th><th>Result</th></tr></thead><tbody>{jobs.map(job=><tr key={job.id}><td className="job-input">{job.operation}</td><td><span className={"state-chip "+(job.state==="succeeded"?"good":job.state==="failed"?"bad":"neutral")}>{job.state}</span></td><td>{job.error ?? "—"}</td></tr>)}</tbody></table>{!jobs.length && <p className="empty-copy">No operations have been queued yet.</p>}</div>;
  const servicesList = <div className="table-scroll"><table className="data-table"><thead><tr><th>Service</th><th>Status</th><th>Actions</th></tr></thead><tbody>{services.map(service=><tr key={service.service}><td><strong className="service-name"><span className="service-glyph"><Glyph name="layers" /></span>{service.service}</strong></td><td><span className={"state-chip "+(service.ActiveState==="active"?"good":"neutral")}>{service.ActiveState}</span></td><td><div className="row-actions">{["start","stop","restart"].map(action=><button key={action} className="table-action" disabled={busy || !canManage} onClick={()=>void serviceAction(service.service,action)}>{action}</button>)}</div></td></tr>)}</tbody></table>{!services.length && <p className="empty-copy">No managed services reported by the agent.</p>}</div>;
  const sitesList = <div className="table-scroll"><table className="data-table"><thead><tr><th>Domain</th><th>Type</th><th>Status</th><th>TLS</th></tr></thead><tbody>{sites.slice(0,6).map(site=><tr key={site.id}><td><strong className="service-name"><span className="service-glyph globe"><Glyph name="globe" /></span>{site.domain}</strong></td><td>{site.webServer==="nginx"?"Static site":"Files only"}</td><td><span className={"state-chip "+(site.state==="ready"?"good":"neutral")}>{site.state}</span></td><td>{site.tls?"Enabled":"—"}</td></tr>)}</tbody></table>{!sites.length && <p className="empty-copy">No sites yet. Create your first one in Websites & files.</p>}</div>;
  return <main className="app-shell">
    <aside className="app-sidebar glass">
      <Brand compact />
      <div className="side-divider" />
      <div className="side-label">WORKSPACE</div>
      <nav className="side-nav" aria-label="Main navigation">
        {navItems.map(item=><button key={item.id} type="button" className={"nav-item "+(view===item.id?"active":"")} aria-current={view===item.id?"page":undefined} onClick={()=>setView(item.id)}><Glyph name={item.icon}/><span>{item.label}</span>{view===item.id && <Glyph name="chevron" />}</button>)}
      </nav>
      <div className="sidebar-bottom"><div className="side-server"><div className="server-badge"><span className={"live-dot "+(agentOnline?"":"offline")}/>{agentOnline?"Agent connected":"Agent unavailable"}</div><strong>{m.hostname ?? "DevOne server"}</strong><small>Uptime · {uptimeLabel}</small></div><p className="side-version">DEVONE SERVER · NODE EDITION</p></div>
    </aside>
    <section className="app-content">
      <header className="app-header glass">
        <div className="breadcrumb"><span className="breadcrumb-root">Control panel</span><Glyph name="chevron"/><strong>{contentTitle[view]}</strong></div>
        <div className="header-tools"><span className={"top-status "+(agentOnline?"":"disconnected")}><span className={"live-dot "+(agentOnline?"":"offline")}/>{agentOnline?"Server connected":"Agent unavailable"}</span><span className="user-avatar" aria-hidden="true">{status.user.email.charAt(0).toUpperCase()}</span><span className="user-email">{status.user.email}</span><button className="signout-button" onClick={()=>void signOut()} aria-label="Sign out"><Glyph name="logout" /> <span>Sign out</span></button></div>
      </header>
      {error && <p role="alert" className="inline-error"><Glyph name="alert" />{error}</p>}
      {notice && <p role="status" className="inline-notice"><Glyph name="check" />{notice}</p>}
      {view==="dashboard" && <>
        <section className="welcome-banner">
          <div><span className="overline">YOUR SERVER AT A GLANCE</span><h1>Good to see you again <span className="wave">✳</span></h1><p>Everything you need to keep your infrastructure running smoothly.</p></div>
          <div className="welcome-server"><span className="illustration-icon"><Glyph name="layers" /></span><div><strong>{m.hostname ?? "DevOne Server"}</strong><span className={"server-badge "+(agentOnline?"":"unavailable")}><span className={"live-dot "+(agentOnline?"":"offline")}/>{agentOnline?"Online":"Unavailable"}</span></div></div>
        </section>
        <div className="health-pills"><span className={"health-chip "+(agentOnline?"":"warning")}><Glyph name="shield" /> Agent {agentOnline?"connected":"unavailable"}</span><span className="health-chip"><Glyph name="layers" /> {activeServices} / {services.length} active services</span><span className="health-chip"><Glyph name="globe" /> {sites.length} websites / workspaces</span><span className="health-chip"><Glyph name="clock" /> Updated every 15 seconds</span></div>
        <DashboardInsights onAi={()=>setView("ai")} onSecurity={()=>setView("security")} onApps={()=>setView("apps")}/>{status.user.role==="owner"&&<div className="update-home-link glass"><div><strong>DevOne Software Updates</strong><span>Install verified dashboard releases without SSH.</span></div><button className="primary-button" onClick={()=>setView("updates")}>Check for Updates →</button></div>}
        <section className="resource-grid" aria-label="Live server resources">{resourceCards.map(card=><article className="resource-card glass" key={card.label}><div className="resource-head"><span className={"metric-icon "+card.tone}><Glyph name={card.icon}/></span><span>{card.label}</span></div><strong>{card.value}</strong><small>{card.detail}</small>{card.label==="Memory used"&&memoryPercent!==null?<div className="meter-track"><span style={{width:memoryPercent+"%"}}/></div>:<div className="metric-underline" />}</article>)}</section>
        <section className="dashboard-columns">
          <article className="surface-card glass"><div className="section-heading"><div><h2><Glyph name="layers"/> Managed services</h2><p>Live status reported by your DevOne agent</p></div><button className="text-action" onClick={()=>setView("services")}>Manage services <Glyph name="arrow"/></button></div>{servicesList}</article>
          <article className="surface-card glass"><div className="section-heading"><div><h2><Glyph name="globe"/> Websites & files</h2><p>Hosted static sites and isolated workspaces</p></div><button className="text-action" onClick={()=>setView("websites")}>Manage sites <Glyph name="arrow"/></button></div>{sitesList}</article>
        </section>
        <section className="dashboard-bottom">
          <article className="surface-card glass"><div className="section-heading"><div><h2><Glyph name="activity"/> Recent activity</h2><p>Latest queued infrastructure operations</p></div><button className="text-action" onClick={()=>setView("activity")}>View all <Glyph name="arrow"/></button></div><div className="timeline">{jobs.slice(0,5).map(job=><div className="timeline-entry" key={job.id}><span className={"timeline-marker "+(job.state==="succeeded"?"good":job.state==="failed"?"bad":"neutral")}><Glyph name={job.state==="succeeded"?"check":"activity"}/></span><div><strong>{job.operation}</strong><small>{job.error ?? job.state}</small></div><time>{new Date(job.created_at).toLocaleString()}</time></div>)}{!jobs.length&&<p className="empty-copy">Your recent actions will appear here.</p>}</div></article>
          <article className="surface-card glass"><div className="section-heading"><div><h2><Glyph name="server"/> System information</h2><p>Live host details</p></div></div><div className="system-list"><div><span>Hostname</span><strong>{m.hostname??"Unavailable"}</strong></div><div><span>Logical CPU cores</span><strong>{m.ok?m.cpuCount??"—":"Unavailable"}</strong></div><div><span>Load (1 / 5 / 15 min)</span><strong>{m.ok?m.load?.map(n=>n.toFixed(2)).join(" / ")??"—":"Unavailable"}</strong></div><div><span>Memory</span><strong>{memoryPercent===null?"Unavailable":memoryPercent+"% used"}</strong></div><div><span>Uptime</span><strong>{uptimeLabel}</strong></div><div><span>Agent connection</span><strong>{agentOnline?"Connected":"Unavailable"}</strong></div></div></article>
        </section>
      </>}
      {view==="services"&&<><div className="page-heading"><span className="overline">INFRASTRUCTURE</span><h1>Managed services</h1><p>Check service health and control supported system services. Service changes require confirmation.</p></div><article className="surface-card glass"><div className="section-heading"><h2>System services</h2><span className="status-pill"><span />{activeServices} active</span></div>{servicesList}</article></>}
      {view==="websites"&&<><div className="page-heading"><span className="overline">HOSTING</span><h1>Websites & files</h1><p>Create isolated static websites, manage file workspaces, domains, and HTTPS certificates.</p></div>{canManage?<SitesWorkspace/>:<p className="surface-card glass">You do not have permission to manage websites.</p>}</>}
      {view==="activity"&&<><div className="page-heading"><span className="overline">OPERATIONS</span><h1>Activity & jobs</h1><p>Review queued, completed, and interrupted infrastructure operations.</p></div><article className="surface-card glass"><div className="section-heading"><h2>Job history</h2><small>Interrupted jobs require inspection before retrying.</small></div>{jobsTable}</article></>}
      {view==="updates"&&status.user.role==="owner"&&<UpdatesWorkspace onDashboard={()=>setView("dashboard")}/>}
      {(["apps","databases","backups","monitoring","qa","ai","security"] as const).includes(view as ControlView) && <ControlWorkspace key={view} view={view as ControlView} role={status.user.role} onNavigate={setView} />}
      {view==="secrets"&&status.user.role==="owner"&&<><div className="page-heading"><span className="overline">SECURE STORAGE</span><h1>Encrypted vault</h1><p>Store integration credentials securely. Existing secret values are never displayed.</p></div><article className="surface-card glass vault-card"><form onSubmit={saveSecret}><h2>Add a credential</h2><div className="vault-fields"><label>Name<input required pattern="[a-z][a-z0-9_.-]{0,63}" maxLength={64} value={secretName} onChange={e=>setSecretName(e.target.value)} placeholder="service.api_key"/></label><label>Secret value<input required type="password" autoComplete="off" maxLength={8192} value={secretValue} onChange={e=>setSecretValue(e.target.value)} placeholder="Paste private value"/></label></div><button className="primary-button" disabled={busy}>Save secret <Glyph name="arrow"/></button></form><div className="vault-items"><h2>Stored credentials</h2>{secrets.map(secret=><div className="vault-item" key={secret.name}><span><Glyph name="lock"/><strong>{secret.name}</strong><small>{new Date(secret.updated_at).toLocaleString()}</small></span><button disabled={busy} onClick={()=>void deleteSecret(secret.name)} className="delete-action">Delete</button></div>)}{!secrets.length&&<p className="empty-copy">Your vault is empty.</p>}</div></article></>}
      <footer className="app-footer">DEVONE SERVER <span>·</span> Performance. Perfection. Pristine design.</footer>
    </section>
  </main>;

}
createRoot(document.getElementById("root")!).render(<StrictMode><App /></StrictMode>);
