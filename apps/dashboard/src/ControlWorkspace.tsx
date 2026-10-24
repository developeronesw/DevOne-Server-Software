import {ApplicationQa} from "./ApplicationQa";
import {RecoveryBackups} from "./RecoveryBackups";
import {DatabaseWorkspace} from "./DatabaseWorkspace";
import {ServerWorkbench} from "./ServerWorkbench";
import {AiActions} from "./AiActions";
import { useEffect, useState } from "react";
import { AppCatalog, SecurityCenter } from "./ManagementModules";

export type ControlView = "apps" | "databases" | "backups" | "monitoring" | "qa" | "ai" | "security";
type Runtime = {name:string;installed:boolean;version:string|null};
type Database = {name:string;clientInstalled:boolean;version:string|null;service:string;serviceState:string};
type Discovery = {checkedAt:string;runtimes:Runtime[];databases:Database[];capabilities:{applicationDeployments:boolean;databaseProvisioning:boolean}};
type Sample = {checked_at:string;load1:number;load5:number;memory_percent:number;cpu_cores:number;uptime_seconds:number};
type QA = {id:string;checkedAt:string;passed:boolean;scope:string;productionReady:boolean;results:{check:string;status:"pass"|"fail";detail:string}[]};
type Backup = {id:string;createdAt:string;bytes:number};
type DisposableQA={id?:string;state:"not_run"|"running"|"passed"|"failed";startedAt?:string;finishedAt?:string;results:{name:string;status:"pass"|"fail"|"blocked";detail:string;siteId?:string;cleaned?:boolean}[];warning:string};
type AiProvider = {id:"gemini"|"openai"|"deepseek"|"openclaw";label:string;secretName:string;model:string;configured:boolean;keyStored:boolean;endpointConfigured:boolean;securityNote:string};
const headings:Record<ControlView,{eyebrow:string;title:string;description:string}>={
  apps:{eyebrow:"APPLICATIONS",title:"Software & app runtimes",description:"Discover installed development runtimes and the host's software foundation."},
  databases:{eyebrow:"DATABASES",title:"Database engines",description:"Provision dedicated application databases and inspect installed engines."},
  backups:{eyebrow:"RECOVERY",title:"Backups & recovery",description:"Protect panel records and saved secrets, then test an isolated restored copy."},
  monitoring:{eyebrow:"OBSERVABILITY",title:"Server monitoring",description:"Real server metrics and recent history from your connected agent."},
  qa:{eyebrow:"QUALITY ASSURANCE",title:"Automatic QA Center",description:"Non-destructive live checks, scheduled every six hours, with retained results."},
  ai:{eyebrow:"INTELLIGENCE",title:"DevOne AI",description:"Choose Gemini, OpenAI, DeepSeek, or a separately secured OpenClaw diagnostic agent."},
  security:{eyebrow:"SECURITY & HARDENING",title:"Security Center",description:"Identify configuration weaknesses and potential exposure with passive, repeatable local checks."}
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

export function ControlWorkspace({view,role,onNavigate}:{view:ControlView;role:string;onNavigate:(target:ControlView)=>void}) {
  const [discovery,setDiscovery]=useState<Discovery|null>(null);
  const [history,setHistory]=useState<Sample[]>([]);
  const [qa,setQa]=useState<QA[]>([]);
  const [qaRunning,setQaRunning]=useState(false);
  const [disposableQa,setDisposableQa]=useState<DisposableQA|null>(null);
  const [qaPassword,setQaPassword]=useState("");
  const [qaMfa,setQaMfa]=useState("");
  const [qaConfirm,setQaConfirm]=useState(false);
  const [qaStarting,setQaStarting]=useState(false);
  const [backups,setBackups]=useState<Backup[]>([]);
  const [backupWarning,setBackupWarning]=useState("");
  const [aiProviders,setAiProviders]=useState<AiProvider[]>([]);
  const [selectedProvider,setSelectedProvider]=useState<AiProvider["id"]>("gemini");
  const [modelInput,setModelInput]=useState("");
  const [apiKey,setApiKey]=useState("");
  const [showApiKey,setShowApiKey]=useState(false);
  const [includeSecurity,setIncludeSecurity]=useState(false);
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
      if(role==='owner')setDisposableQa(await getJson<DisposableQA>('/api/qa/disposable'));
    }
    if(view==="backups"){
      const data=await getJson<{backups:Backup[];warning:string}>("/api/backups");
      setBackups(data.backups);setBackupWarning(data.warning);
    }
    if(view==="ai"){
      const data=await getJson<{providers:AiProvider[]}>("/api/ai/status");
      setAiProviders(data.providers);
    }
  }
  useEffect(()=>{
    let active=true;
    setError("");setNotice("");
    void refresh().catch(e=>{if(active)setError(e instanceof Error?e.message:"Module unavailable.");});
    const timer=setInterval(()=>{if(active && (view==="monitoring"||view==="qa"||view==="apps"||view==="databases"))void refresh().catch(()=>{});},30000);
    return ()=>{active=false;clearInterval(timer);};
  },[view]);
  useEffect(()=>{
    if(view!=="qa"||role!=="owner"||disposableQa?.state!=="running")return;
    const timer=setInterval(()=>{void getJson<DisposableQA>("/api/qa/disposable").then(setDisposableQa).catch(()=>{});},2500);
    return()=>clearInterval(timer);
  },[view,role,disposableQa?.state]);
  async function runDisposableQa(){
    if(role!=="owner"||!qaConfirm||!qaPassword)return;
    if(!window.confirm("This will CREATE, publish, test and DELETE six disposable test websites on this VPS, then install packages inside a temporary Docker container. It will NOT uninstall shared host packages. Continue?"))return;
    setQaStarting(true);setError("");setNotice("");
    try{
      await sendJson("/api/qa/disposable/start",{confirmed:true,password:qaPassword,mfaCode:qaMfa});
      setQaPassword("");setQaMfa("");setQaConfirm(false);
      setDisposableQa(await getJson<DisposableQA>("/api/qa/disposable"));
      setNotice("Disposable QA started. Test progress and cleanup results will appear below.");
    }catch(e){setError(e instanceof Error?e.message:"Disposable QA could not start.");}
    finally{setQaStarting(false);}
  }
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
    try{await sendJson("/api/backups",{confirmed:true});setNotice("Control-database snapshot created. The snapshot file itself is not encrypted.");await refresh();}
    catch(e){setError(e instanceof Error?e.message:"Backup failed.");}
    finally{setBusy(false);}
  }
  async function diagnose(){
    setBusy(true);setError("");setAnswer("");
    try{const data=await sendJson<{answer:string}>("/api/ai/diagnose",{question,provider:selectedProvider,includeSecurity,...(selectedProvider==="openclaw"?{}:{model:modelInput||selected?.model})});setAnswer(data.answer);}
    catch(e){setError(e instanceof Error?e.message:"AI provider unavailable.");}
    finally{setBusy(false);}
  }
  async function saveProviderKey(){
    const provider=aiProviders.find(p=>p.id===selectedProvider);
    if(!provider||!apiKey.trim())return;
    setBusy(true);setError("");setNotice("");
    try{
      const response=await fetch("/api/secrets/"+encodeURIComponent(provider.secretName),{
        method:"PUT",credentials:"same-origin",headers:{"Content-Type":"application/json"},body:JSON.stringify({value:apiKey.trim()})
      });
      const result=await response.json().catch(()=>({})) as {error?:string};
      if(!response.ok)throw Error(result.error??"Could not save provider credential");
      setApiKey("");setShowApiKey(false);
      setNotice("Provider credential encrypted and saved. You can now use DevOne AI if the endpoint is configured.");
      await refresh();
    }catch(e){setError(e instanceof Error?e.message:"Credential save failed.");}
    finally{setBusy(false);}
  }
  const selected=aiProviders.find(p=>p.id===selectedProvider);
  const providerReady=Boolean(selected?.configured);
  const header=headings[view];
  return <div className="ops-workspace">
    <div className="page-heading"><span className="overline">{header.eyebrow}</span><h1>{header.title}</h1><p>{header.description}</p></div>
    {error&&<p role="alert" className="inline-error">{error}</p>}
    {notice&&<p role="status" className="inline-notice">{notice}</p>}
    {view==="apps"&&<AppCatalog role={role}/>}
    {view==="databases"&&role==="owner"&&<DatabaseWorkspace onApps={()=>onNavigate("apps")}/>}
    {view==="databases"&&<section className="surface-card glass"><div className="section-heading"><div><h2>Installed database engines</h2><p>Read-only discovery · Source: authenticated DevOne Agent</p></div></div>
      {discovery?<><div className="ops-table-wrap"><table className="ops-table"><thead><tr><th>Engine</th><th>Service state</th><th>Client</th></tr></thead><tbody>{discovery.databases.map(item=><tr key={item.name}><td><strong>{item.name}</strong><small className="ops-subtext">{item.version??"No client detected"}</small></td><td><span className={"state-chip "+(item.serviceState==="active"?"good":"neutral")}>{item.serviceState}</span></td><td>{item.clientInstalled?"Installed":"Not detected"}</td></tr>)}</tbody></table></div><p className="ops-note">Service start/stop/restart is available through Services. Owners can provision managed application databases above. SQL administration, deletion, credential rotation and restore remain unfinished.</p></>:<p className="ops-empty">Checking your database engines…</p>}
    </section>}
    {view==="monitoring"&&<>
      {role==="owner"&&<ServerWorkbench/>}
      <div className="ops-chart-grid"><article className="surface-card glass"><MetricChart history={history} keyName="memory_percent" label="Memory utilization"/></article><article className="surface-card glass"><MetricChart history={history} keyName="load1" label="1-minute system load"/></article></div>
      <article className="surface-card glass ops-panel-gap"><div className="section-heading"><div><h2>Live metrics history</h2><p>One sample per minute · Last 24 hours retained</p></div><span className="state-chip good">{history.length} samples shown</span></div><div className="ops-table-wrap"><table className="ops-table"><thead><tr><th>Timestamp</th><th>Memory</th><th>Load 1m</th><th>Load 5m</th><th>CPU cores</th></tr></thead><tbody>{history.slice(-12).reverse().map((x,i)=><tr key={x.checked_at+i}><td>{new Date(x.checked_at).toLocaleString()}</td><td>{x.memory_percent.toFixed(1)}%</td><td>{x.load1.toFixed(2)}</td><td>{x.load5.toFixed(2)}</td><td>{x.cpu_cores}</td></tr>)}</tbody></table>{history.length===0&&<p className="ops-empty">Waiting for the first metrics sample.</p>}</div></article>
    </>}
    {view==="qa"&&<>
      <article className="surface-card glass"><div className="section-heading"><div><h2>Live system verification</h2><p>Read-only integrity, encryption, API/Agent and service checks</p></div><button className="primary-button" disabled={busy||qaRunning} onClick={()=>void runQa()}>{busy||qaRunning?"Checking…":"Run QA now"}</button></div>
        <div className="ops-qa-status"><div><small>Last result</small><strong>{qa.length?(qa[0].passed?"PASS":"CHECKS FAILED"):"Awaiting first run"}</strong></div><div><small>Schedule</small><strong>Every 6 hours</strong></div><div><small>Release readiness</small><strong>Not yet certified</strong></div></div>
        <p className="ops-note">The separate GitHub CI regression suite runs automatically on PRs/commits. A green live probe does not verify application CRUD, restores or production safety.</p></article>
      {role==="owner"&&<ApplicationQa/>}
      {role==="owner"&&<article className="surface-card glass ops-panel-gap" aria-label="Disposable hosting and software QA">
        <div className="section-heading"><div><span className="overline">OWNER-APPROVED HOST ACCEPTANCE</span><h2>Disposable website and software QA</h2>
          <p>Creates real isolated static, file, PHP, Node, Python and Docker test sites; checks actual responses and deletes only those test sites. Packages are installed inside a temporary Docker container, never removed from the host.</p>
        </div><span className={"state-chip "+(disposableQa?.state==="passed"?"good":disposableQa?.state==="failed"?"bad":"neutral")}>{disposableQa?.state??"Not run"}</span></div>
        <p className="ops-warning">Run only on your development VPS. This temporarily creates Linux users and NGINX configurations, starts processes and pulls Docker images. Failed cleanup is reported and requires manual recovery; customer sites are never selected for deletion.</p>
        {disposableQa?.state!=="running"&&<div className="shield-form">
          <label className="shield-label">Owner password<input type="password" autoComplete="current-password" value={qaPassword} onChange={e=>setQaPassword(e.target.value)}/></label>
          <label className="shield-label">MFA code, if enabled<input autoComplete="one-time-code" value={qaMfa} onChange={e=>setQaMfa(e.target.value)} maxLength={17}/></label>
          <label className="shield-consent"><input type="checkbox" checked={qaConfirm} onChange={e=>setQaConfirm(e.target.checked)}/> I authorize disposable host changes and automatic deletion of QA-owned test sites.</label>
          <button className="primary-button" disabled={qaStarting||!qaConfirm||!qaPassword} type="button" onClick={()=>void runDisposableQa()}>{qaStarting?"Starting…":"Run disposable host QA"}</button>
        </div>}
        {disposableQa&&<div className="ops-table-wrap"><table className="ops-table"><thead><tr><th>Test</th><th>Result</th><th>Cleanup</th><th>Verification</th></tr></thead>
         <tbody>{disposableQa.results.map((x,i)=><tr key={x.name+i}><td><strong>{x.name}</strong></td><td><span className={"state-chip "+(x.status==="pass"?"good":x.status==="fail"?"bad":"neutral")}>{x.status}</span></td><td>{x.cleaned===undefined?"—":x.cleaned?"Deleted":"Needs inspection"}</td><td>{x.detail}</td></tr>)}</tbody></table>
        {disposableQa.state==="running"&&<p role="status" className="ops-subtext">Real host tests are running. Keep DevOne services online until completion.</p>}
        </div>}
      </article>}
      <article className="surface-card glass ops-panel-gap"><div className="section-heading"><h2>Latest check details</h2></div>{qa[0]?<><p className="ops-subtext">Checked {new Date(qa[0].checkedAt).toLocaleString()} · {qa[0].results.filter(x=>x.status==="pass").length} / {qa[0].results.length} passed</p><div className="ops-table-wrap"><table className="ops-table"><thead><tr><th>Check</th><th>Status</th><th>What was verified</th></tr></thead><tbody>{qa[0].results.map(x=><tr key={x.check}><td><strong>{x.check}</strong></td><td><span className={"state-chip "+(x.status==="pass"?"good":"bad")}>{x.status}</span></td><td>{x.detail}</td></tr>)}</tbody></table></div></>:<p className="ops-empty">The automatic first-run QA report will appear shortly.</p>}</article>
      <article className="surface-card glass ops-panel-gap"><h2>Recent QA runs</h2><div className="ops-table-wrap"><table className="ops-table"><thead><tr><th>Time</th><th>Result</th><th>Passed checks</th></tr></thead><tbody>{qa.slice(0,12).map(x=><tr key={x.id}><td>{new Date(x.checkedAt).toLocaleString()}</td><td><span className={"state-chip "+(x.passed?"good":"bad")}>{x.passed?"Pass":"Fail"}</span></td><td>{x.results.filter(y=>y.status==="pass").length}/{x.results.length}</td></tr>)}</tbody></table></div></article>
    </>}
    {view==="backups"&&<>
      {role==="owner"&&<RecoveryBackups/>}
      {role==="owner"?<><article className="surface-card glass"><div className="section-heading"><div><h2>Control database snapshots</h2><p>SQLite online backup API · Consistent snapshots without stopping the server</p></div><button className="primary-button" disabled={busy} onClick={()=>void createBackup()}>{busy?"Creating…":"Create snapshot"}</button></div><p className="ops-warning">{backupWarning||"Backups exclude hosted sites, system configurations and the vault encryption key. Do not treat them as full-server recovery images."}</p></article>
      <article className="surface-card glass ops-panel-gap"><div className="section-heading"><h2>Available snapshots</h2><small className="ops-subtext">Owner-only downloads</small></div><div className="ops-table-wrap"><table className="ops-table"><thead><tr><th>Created</th><th>Size</th><th>Action</th></tr></thead><tbody>{backups.map(b=><tr key={b.id}><td>{new Date(b.createdAt).toLocaleString()}</td><td>{(b.bytes/1048576).toFixed(2)} MiB</td><td><a className="ops-download" href={"/api/backups/"+b.id+"/download"}>Download snapshot ↓</a></td></tr>)}</tbody></table>{!backups.length&&<p className="ops-empty">No snapshots yet.</p>}</div></article></>:<article className="surface-card glass"><h2>Owner permission required</h2><p>Backups are restricted to the Owner account.</p></article>}
    </>}
    {view==="security"&&<SecurityCenter role={role} onAi={()=>onNavigate("ai")}/>}
    {view==="ai"&&<div className="ops-ai-grid"><section className="surface-card glass">
      <div className="section-heading"><div><h2>AI infrastructure assistant</h2><p>One DevOne workspace. Multiple model providers.</p></div><span className={"state-chip "+(providerReady?"good":"neutral")}>{providerReady?"Ready":"Needs setup"}</span></div>
      <label className="ops-ai-label" htmlFor="ai-provider">AI connection</label>
      <select id="ai-provider" value={selectedProvider} onChange={e=>{const next=e.target.value as AiProvider["id"];setSelectedProvider(next);setModelInput("");setAnswer("");setError("");}}>
        {["gemini","openai","deepseek","openclaw"].map(id=><option key={id} value={id}>{aiProviders.find(p=>p.id===id)?.label??({"gemini":"Google Gemini","openai":"OpenAI API","deepseek":"DeepSeek","openclaw":"OpenClaw Gateway"} as Record<string,string>)[id]}</option>)}
      </select>
      <div className="ops-provider-status"><span className={"state-chip "+(providerReady?"good":"neutral")}>{selected?.keyStored?"Credential in vault":"API key not saved"}</span>{selectedProvider==="openclaw"&&<span className={"state-chip "+(selected?.endpointConfigured?"good":"neutral")}>{selected?.endpointConfigured?"Gateway configured":"Gateway not configured"}</span>}</div>
      {selectedProvider!=="openclaw"&&<><label className="ops-ai-label" htmlFor="ai-model">Model identifier</label><input id="ai-model" value={modelInput} onChange={e=>setModelInput(e.target.value)} placeholder={selected?.model??"Choose your provider model"}/><p className="ops-subtext">Leave blank to use the default model: <strong>{selected?.model??"Loading…"}</strong>. The selected model must be available to your provider account.</p></>}
      {selectedProvider==="openclaw"&&<p className="ops-warning"><strong>OpenClaw gateway security:</strong> Connect only a dedicated diagnostics agent with all host, shell, file, browser and other tools disabled on the gateway. A normal OpenClaw agent could perform actions even if DevOne requests only text. Configure its fixed HTTPS gateway URL and pinned agent model on the VPS; never expose the gateway token here.</p>}
      <p className="ops-note">DevOne sends your question and a limited server-health snapshot to the selected provider. It does not intentionally send credentials, customer records, system logs or IP addresses. Diagnostics are advisory. Use AI Actions below to prepare and review a dashboard operation.</p>
      {role==="owner"&&<div className="ops-ai-setup"><h3>{selected?.keyStored?"Update connection key":"Connect "+(selected?.label??"your provider")}</h3>
        <p>Enter the API key/token here. It is sent directly to your DevOne backend and stored encrypted; existing saved values are never displayed.</p>
        <label htmlFor="ai-api-key" className="ops-ai-label">{selectedProvider==="openclaw"?"Dedicated gateway bearer token":"Provider API key"}</label>
        <div className="ops-secret-input"><input id="ai-api-key" autoComplete="off" spellCheck={false} type={showApiKey?"text":"password"} value={apiKey} onChange={e=>setApiKey(e.target.value)} placeholder={selected?.keyStored?"Paste a new key to rotate the connection":"Paste provider key"}/><button type="button" onClick={()=>setShowApiKey(!showApiKey)}>{showApiKey?"Hide":"Show"}</button></div>
        <button className="primary-button" disabled={busy||!apiKey.trim()} onClick={()=>void saveProviderKey()}>{busy?"Saving…":selected?.keyStored?"Replace encrypted key":"Save encrypted API key"}</button>
        {selectedProvider==="openclaw"&&<p className="ops-warning">OpenClaw also needs the HTTPS gateway URL and pinned no-tools agent configured in /etc/devone/devone.env. A gateway token can grant broad access; use a dedicated diagnostic agent.</p>}
       </div>}
      {!providerReady&&<p className="ops-warning">This provider is not connected yet. {role==="owner"?"Save a valid credential above.":"Ask the Owner to configure credentials."} For OpenClaw, the server must also have its dedicated no-tools gateway configured.</p>}
      <label className="ops-ai-label" htmlFor="ai-question">What would you like to diagnose?</label>
      <textarea id="ai-question" value={question} onChange={e=>setQuestion(e.target.value)} maxLength={1600} placeholder="For example: Which server settings should I review to reduce attack surface?"/>
      <label className="ops-ai-consent"><input type="checkbox" checked={includeSecurity} onChange={e=>setIncludeSecurity(e.target.checked)}/> Include latest sanitized Security Center findings in the question sent to this AI provider (optional).</label>
      <button className="primary-button" disabled={!providerReady||busy||question.trim().length<5} onClick={()=>void diagnose()}>{busy?"Analyzing…":"Analyze with "+(selected?.label??"AI")}</button>
      </section>
      <AiActions key={selectedProvider} provider={selectedProvider} ready={providerReady}/><section className="surface-card glass ops-ai-output"><h2>Diagnostic response</h2>{answer?<div className="ops-response" aria-live="polite">{answer}</div>:<p className="ops-empty">Provider responses appear here as advice. Verify any recommendation before making changes to your server.</p>}</section>
    </div>}
  </div>;
}
