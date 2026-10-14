import { useEffect, useState } from "react";

export type ControlView = "apps" | "databases" | "backups" | "monitoring" | "qa" | "ai";
type Runtime = {name:string;installed:boolean;version:string|null};
type Database = {name:string;clientInstalled:boolean;version:string|null;service:string;serviceState:string};
type Discovery = {checkedAt:string;runtimes:Runtime[];databases:Database[];capabilities:{applicationDeployments:boolean;databaseProvisioning:boolean}};
type Sample = {checked_at:string;load1:number;load5:number;memory_percent:number;cpu_cores:number;uptime_seconds:number};
type QA = {id:string;checkedAt:string;passed:boolean;scope:string;productionReady:boolean;results:{check:string;status:"pass"|"fail";detail:string}[]};
type Backup = {id:string;createdAt:string;bytes:number};
const headings:Record<ControlView,{eyebrow:string;title:string;description:string}>={
  apps:{eyebrow:"APPLICATIONS",title:"Software & app runtimes",description:"Discover installed development runtimes and the host's software foundation."},
  databases:{eyebrow:"DATABASES",title:"Database engines",description:"Inspect installed database clients and services. Database creation and user management require the next controlled Agent phase."},
  backups:{eyebrow:"RECOVERY",title:"Control-plane backups",description:"Create and download consistent SQLite snapshots of DevOne's control database."},
  monitoring:{eyebrow:"OBSERVABILITY",title:"Server monitoring",description:"Real server metrics and recent history from your connected agent."},
  qa:{eyebrow:"QUALITY ASSURANCE",title:"Automatic QA Center",description:"Non-destructive live checks, scheduled every six hours, with retained results."},
  ai:{eyebrow:"INTELLIGENCE",title:"DevOne AI",description:"Read-only Gemini diagnostics grounded in your current service and health data."}
};
async function getJson<T>(path:string):Promise<T>{
  const response=await fetch(path,{credentials:"same-origin",cache:"no-store"});
  if(!response.ok)throw Error("Request failed ("+response.status+").");
  return response.json() as Promise<T>;
}
async function sendJson<T>(path:string,body:unknown):Promise<T>{
  const response=await fetch(path,{method:"POST",credentials:"same-origin",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)});
  const result=await response.json().catch(()=>({})) as T & {error?:string};
  if(!response.ok)throw Error(result.error??("Request failed ("+response.status+")."));
  return result;
}
function MetricChart({history,keyName,label}:{history:Sample[];keyName:"load1"|"memory_percent";label:string}) {
  const recent=history.slice(-60);
  const high=keyName==="memory_percent"?100:Math.max(1,...recent.map(r=>r.load1))*1.2;
  const points=recent.map((sample,i)=>{
    const x=recent.length<=1?0:i*600/(recent.length-1);
    const y=115-Math.max(0,Math.min(1,sample[keyName]/high))*105;
    return x.toFixed(1)+","+y.toFixed(1);
  }).join(" ");
  const current=recent.at(-1);
  return <div className="ops-graph"><div className="ops-graph-title"><strong>{label}</strong><span>{current?keyName==="memory_percent"?current.memory_percent.toFixed(1)+"%":current.load1.toFixed(2):"Waiting for samples"}</span></div>
    {recent.length>1?<svg viewBox="0 0 600 125" preserveAspectRatio="none" role="img" aria-label={label+" trend for last "+recent.length+" samples"}><path d="M0 115H600M0 65H600M0 15H600" stroke="#e8eaf7" fill="none" strokeWidth="1"/><polyline points={points} fill="none" stroke="#7955eb" strokeWidth="3" vectorEffect="non-scaling-stroke" strokeLinecap="round" strokeLinejoin="round"/></svg>:<p className="ops-empty">Metrics history begins after the API runs its first sample.</p>}
  </div>;
}

export function ControlWorkspace({view,role}:{view:ControlView;role:string}) {
  const [discovery,setDiscovery]=useState<Discovery|null>(null);
  const [history,setHistory]=useState<Sample[]>([]);
  const [qa,setQa]=useState<QA[]>([]);
  const [qaRunning,setQaRunning]=useState(false);
  const [backups,setBackups]=useState<Backup[]>([]);
  const [backupWarning,setBackupWarning]=useState("");
  const [aiConfigured,setAiConfigured]=useState(false);
  const [aiModel,setAiModel]=useState("");
  const [question,setQuestion]=useState("");
  const [answer,setAnswer]=useState("");
  const [error,setError]=useState("");
  const [notice,setNotice]=useState("");
  const [busy,setBusy]=useState(false);
  async function refresh(){
    if(view==="apps"||view==="databases")setDiscovery(await getJson<Discovery>("/api/discovery"));
    if(view==="monitoring")setHistory((await getJson<{history:Sample[]}>("/api/monitoring")).history);
    if(view==="qa"){
      const data=await getJson<{history:QA[];running:boolean}>("/api/qa");
      setQa(data.history);setQaRunning(data.running);
    }
    if(view==="backups"){
      const data=await getJson<{backups:Backup[];warning:string}>("/api/backups");
      setBackups(data.backups);setBackupWarning(data.warning);
    }
    if(view==="ai"){
      const data=await getJson<{configured:boolean;model:string}>("/api/ai/status");
      setAiConfigured(data.configured);setAiModel(data.model);
    }
  }
  useEffect(()=>{
    let active=true;
    setError("");setNotice("");
    void refresh().catch(e=>{if(active)setError(e instanceof Error?e.message:"Module unavailable.");});
    const timer=setInterval(()=>{if(active && (view==="monitoring"||view==="qa"||view==="apps"||view==="databases"))void refresh().catch(()=>{});},30000);
    return ()=>{active=false;clearInterval(timer);};
  },[view]);
  async function runQa(){
    setBusy(true);setError("");setNotice("");
    try{
      const report=await sendJson<QA>("/api/qa/run",{});
      setNotice(report.passed?"All live QA checks passed. This is not the full release gate.":"Live QA found a failed check. Inspect the results below.");
      await refresh();
    }catch(e){setError(e instanceof Error?e.message:"QA execution failed.");}
    finally{setBusy(false);}
  }
  async function createBackup(){
    if(!window.confirm("Create a snapshot of the DevOne control database only? Hosted website files, system configuration and the separate vault master key are NOT included."))return;
    setBusy(true);setError("");setNotice("");
    try{await sendJson("/api/backups",{confirmed:true});setNotice("Encrypted control-database snapshot created.");await refresh();}
    catch(e){setError(e instanceof Error?e.message:"Backup failed.");}
    finally{setBusy(false);}
  }
  async function diagnose(){
    setBusy(true);setError("");setAnswer("");
    try{const data=await sendJson<{answer:string}>("/api/ai/diagnose",{question});setAnswer(data.answer);}
    catch(e){setError(e instanceof Error?e.message:"AI provider unavailable.");}
    finally{setBusy(false);}
  }
  const header=headings[view];
  return <div className="ops-workspace">
    <div className="page-heading"><span className="overline">{header.eyebrow}</span><h1>{header.title}</h1><p>{header.description}</p></div>
    {error&&<p role="alert" className="inline-error">{error}</p>}
    {notice&&<p role="status" className="inline-notice">{notice}</p>}
    {view==="apps"&&<section className="surface-card glass"><div className="section-heading"><div><h2>Detected software</h2><p>Automatic discovery · No packages will be installed or changed</p></div></div>
      {discovery?<><div className="ops-table-wrap"><table className="ops-table"><thead><tr><th>Runtime / tool</th><th>Installation</th><th>Detected version</th></tr></thead><tbody>{discovery.runtimes.map(runtime=><tr key={runtime.name}><td><strong>{runtime.name}</strong></td><td><span className={"state-chip "+(runtime.installed?"good":"neutral")}>{runtime.installed?"Installed":"Not detected"}</span></td><td>{runtime.version??"—"}</td></tr>)}</tbody></table></div><p className="ops-note">Managed Node/Python app deployments, Git release history, per-app domains and rollback are next-stage integrations. Sites & files already supports static hosting.</p></>:<p className="ops-empty">Checking your server's software inventory…</p>}
    </section>}
    {view==="databases"&&<section className="surface-card glass"><div className="section-heading"><div><h2>Installed database engines</h2><p>Read-only discovery · Source: authenticated DevOne Agent</p></div></div>
      {discovery?<><div className="ops-table-wrap"><table className="ops-table"><thead><tr><th>Engine</th><th>Service state</th><th>Client</th></tr></thead><tbody>{discovery.databases.map(item=><tr key={item.name}><td><strong>{item.name}</strong><small className="ops-subtext">{item.version??"No client detected"}</small></td><td><span className={"state-chip "+(item.serviceState==="active"?"good":"neutral")}>{item.serviceState}</span></td><td>{item.clientInstalled?"Installed":"Not detected"}</td></tr>)}</tbody></table></div><p className="ops-note">Service start/stop/restart is available through Services. Database creation, credentials, SQL administration and restore are not enabled until Agent authorization and isolation tests pass.</p></>:<p className="ops-empty">Checking your database engines…</p>}
    </section>}
    {view==="monitoring"&&<>
      <div className="ops-chart-grid"><article className="surface-card glass"><MetricChart history={history} keyName="memory_percent" label="Memory utilization"/></article><article className="surface-card glass"><MetricChart history={history} keyName="load1" label="1-minute system load"/></article></div>
      <article className="surface-card glass ops-panel-gap"><div className="section-heading"><div><h2>Live metrics history</h2><p>One sample per minute · Last 24 hours retained</p></div><span className="state-chip good">{history.length} samples shown</span></div><div className="ops-table-wrap"><table className="ops-table"><thead><tr><th>Timestamp</th><th>Memory</th><th>Load 1m</th><th>Load 5m</th><th>CPU cores</th></tr></thead><tbody>{history.slice(-12).reverse().map((x,i)=><tr key={x.checked_at+i}><td>{new Date(x.checked_at).toLocaleString()}</td><td>{x.memory_percent.toFixed(1)}%</td><td>{x.load1.toFixed(2)}</td><td>{x.load5.toFixed(2)}</td><td>{x.cpu_cores}</td></tr>)}</tbody></table>{history.length===0&&<p className="ops-empty">Waiting for the first metrics sample.</p>}</div></article>
    </>}
    {view==="qa"&&<>
      <article className="surface-card glass"><div className="section-heading"><div><h2>Live system verification</h2><p>Read-only integrity, encryption, API/Agent and service checks</p></div><button className="primary-button" disabled={busy||qaRunning} onClick={()=>void runQa()}>{busy||qaRunning?"Checking…":"Run QA now"}</button></div>
        <div className="ops-qa-status"><div><small>Last result</small><strong>{qa.length?(qa[0].passed?"PASS":"CHECKS FAILED"):"Awaiting first run"}</strong></div><div><small>Schedule</small><strong>Every 6 hours</strong></div><div><small>Release readiness</small><strong>Not yet certified</strong></div></div>
        <p className="ops-note">The separate GitHub CI regression suite runs automatically on PRs/commits. A green live probe does not verify application CRUD, restores or production safety.</p></article>
      <article className="surface-card glass ops-panel-gap"><div className="section-heading"><h2>Latest check details</h2></div>{qa[0]?<><p className="ops-subtext">Checked {new Date(qa[0].checkedAt).toLocaleString()} · {qa[0].results.filter(x=>x.status==="pass").length} / {qa[0].results.length} passed</p><div className="ops-table-wrap"><table className="ops-table"><thead><tr><th>Check</th><th>Status</th><th>What was verified</th></tr></thead><tbody>{qa[0].results.map(x=><tr key={x.check}><td><strong>{x.check}</strong></td><td><span className={"state-chip "+(x.status==="pass"?"good":"bad")}>{x.status}</span></td><td>{x.detail}</td></tr>)}</tbody></table></div></>:<p className="ops-empty">The automatic first-run QA report will appear shortly.</p>}</article>
      <article className="surface-card glass ops-panel-gap"><h2>Recent QA runs</h2><div className="ops-table-wrap"><table className="ops-table"><thead><tr><th>Time</th><th>Result</th><th>Passed checks</th></tr></thead><tbody>{qa.slice(0,12).map(x=><tr key={x.id}><td>{new Date(x.checkedAt).toLocaleString()}</td><td><span className={"state-chip "+(x.passed?"good":"bad")}>{x.passed?"Pass":"Fail"}</span></td><td>{x.results.filter(y=>y.status==="pass").length}/{x.results.length}</td></tr>)}</tbody></table></div></article>
    </>}
    {view==="backups"&&<>
      {role==="owner"?<><article className="surface-card glass"><div className="section-heading"><div><h2>Control database snapshots</h2><p>SQLite online backup API · Consistent snapshots without stopping the server</p></div><button className="primary-button" disabled={busy} onClick={()=>void createBackup()}>{busy?"Creating…":"Create snapshot"}</button></div><p className="ops-warning">{backupWarning||"Backups exclude hosted sites, system configurations and the vault encryption key. Do not treat them as full-server recovery images."}</p></article>
      <article className="surface-card glass ops-panel-gap"><div className="section-heading"><h2>Available snapshots</h2><small className="ops-subtext">Owner-only downloads</small></div><div className="ops-table-wrap"><table className="ops-table"><thead><tr><th>Created</th><th>Size</th><th>Action</th></tr></thead><tbody>{backups.map(b=><tr key={b.id}><td>{new Date(b.createdAt).toLocaleString()}</td><td>{(b.bytes/1048576).toFixed(2)} MiB</td><td><a className="ops-download" href={"/api/backups/"+b.id+"/download"}>Download snapshot ↓</a></td></tr>)}</tbody></table>{!backups.length&&<p className="ops-empty">No snapshots yet.</p>}</div></article></>:<article className="surface-card glass"><h2>Owner permission required</h2><p>Backups are restricted to the Owner account.</p></article>}
    </>}
    {view==="ai"&&<div className="ops-ai-grid"><section className="surface-card glass"><div className="section-heading"><div><h2>AI infrastructure assistant</h2><p>Model: {aiModel||"Google Gemini"}</p></div><span className={"state-chip "+(aiConfigured?"good":"neutral")}>{aiConfigured?"Configured":"Not configured"}</span></div>
      <p className="ops-note">For security, DevOne AI only sees a minimal server-health summary. It cannot execute commands, alter services, read private files or disclose stored credentials.</p>
      {aiConfigured?<><label className="ops-ai-label" htmlFor="ai-question">What would you like to diagnose?</label><textarea id="ai-question" value={question} onChange={e=>setQuestion(e.target.value)} maxLength={1600} placeholder="For example: Why might a high 1-minute load average indicate performance problems?"/><button className="primary-button" disabled={busy||question.trim().length<5} onClick={()=>void diagnose()}>{busy?"Analyzing…":"Analyze my server"}</button></>:<div className="ops-ai-setup"><h3>Connect Google Gemini</h3><p>In the <strong>Secure Vault</strong>, add a secret named <code>gemini.api_key</code> containing your Google AI Studio API key. Return here when saved.</p><button onClick={()=>void refresh().catch(()=>{})} className="ops-secondary">Check configuration</button></div>}
      </section><section className="surface-card glass ops-ai-output"><h2>Diagnostic response</h2>{answer?<div className="ops-response" aria-live="polite">{answer}</div>:<p className="ops-empty">Your read-only diagnostic recommendations will appear here. Always verify suggestions before acting on production services.</p>}</section></div>}
  </div>;
}
