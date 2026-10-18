import {useEffect,useMemo,useState} from "react";
import {SiteWafConsole} from "./SiteWafConsole";
import {OwnerMfaSettings} from "./OwnerMfaSettings";
import {CrowdSecStatus} from "./CrowdSecStatus";

type CatalogEntry={id:string;name:string;category:"cms"|"framework"|"platform"|"runtime";description:string;sourceUrl:string;docsUrl:string;runtime:string[];featured?:boolean;latestKnownVersion?:string;verifiedAt?:string;releaseChannel:string;deployment:string};
type Catalog={items:CatalogEntry[];installAvailable:boolean;notice:string};
type Discovery={runtimes:{name:string;installed:boolean;version:string|null}[]};
type Finding={id:string;title:string;severity:"high"|"medium"|"low"|"info";status:"pass"|"warning"|"unknown";detail:string;recommendation:string};
type Scan={checkedAt:string;findings:Finding[];summary:{warnings:number;passed:number;unknown:number};limitations:string[];mode:string};
type ScanState={latest:Scan|null;busy:boolean;scheduleHours:number};
type Status={providers:{id:string;label:string;configured:boolean}[]};

async function readApi<T>(url:string):Promise<T>{
 const r=await fetch(url,{cache:"no-store",credentials:"same-origin"});
 if(!r.ok)throw Error("Request failed ("+r.status+")");
 return r.json() as Promise<T>;
}

type RuntimeCapabilities={mode:"managed-install";installAvailable:true;options:{package:string;label:string;installAvailable:true}[];notice:string};
type RuntimeState={package:string;installed:boolean;version:string|null;serviceActive:boolean};
type InstallJob={id:string;state:string;error:string|null;operation:string};
function RuntimeManager({role}:{role:string}){
 const [capabilities,setCapabilities]=useState<RuntimeCapabilities|null>(null);
 const [packages,setPackages]=useState<RuntimeState[]>([]);
 const [choice,setChoice]=useState("php8.3-fpm");
 const [password,setPassword]=useState("");
 const [mfaCode,setMfaCode]=useState("");
 const [mfaEnabled,setMfaEnabled]=useState(false);
 const [confirmed,setConfirmed]=useState(false);
 const [busy,setBusy]=useState(false);
 const [error,setError]=useState("");
 const [job,setJob]=useState<InstallJob|null>(null);
 async function refresh(){
  const [cfg,installed]=await Promise.all([
   readApi<RuntimeCapabilities>("/api/software/capabilities"),
   readApi<{packages:RuntimeState[]}>("/api/software/status")
  ]);
  setCapabilities(cfg);setPackages(installed.packages);
 }
 useEffect(()=>{
  if(!["owner","admin"].includes(role))return;
  void refresh().catch(()=>setError("Could not load installed package status."));
  if(role==="owner")void fetch("/api/auth/mfa/status",{credentials:"same-origin"})
   .then(r=>r.ok?r.json():null).then(data=>setMfaEnabled(data?.enabled===true)).catch(()=>{});
 },[role]);
 useEffect(()=>{
  if(!job||["succeeded","failed","interrupted"].includes(job.state))return;
  const interval=setInterval(()=>{
   void readApi<{job:InstallJob}>("/api/jobs/"+encodeURIComponent(job.id)).then(async r=>{
    setJob(r.job);
    if(["succeeded","failed","interrupted"].includes(r.job.state))await refresh();
   }).catch(()=>setError("Job status unavailable. Check Activity & Jobs before retrying."));
  },2500);
  return ()=>clearInterval(interval);
 },[job?.id,job?.state]);
 async function install(){
  if(role!=="owner"||!confirmed||!password||busy)return;
  if(!window.confirm("Install "+choice+" using Ubuntu's package manager? This changes the development VPS. Existing packages are not removed automatically."))return;
  setBusy(true);setError("");setJob(null);
  try{
   const response=await fetch("/api/software/install",{
    method:"POST",credentials:"same-origin",headers:{"Content-Type":"application/json"},
    body:JSON.stringify({package:choice,confirmed:true,password,mfaCode,requestKey:crypto.randomUUID().replace(/-/g,"")})
   });
   const data=await response.json().catch(()=>({})) as {job?:InstallJob;error?:string};
   if(!response.ok||!data.job)throw Error(data.error??"Installation could not be queued");
   setJob(data.job);setPassword("");setMfaCode("");setConfirmed(false);
  }catch(e){setError(e instanceof Error?e.message:"Installation failed");}
  finally{setBusy(false);}
 }
 const selected=packages.find(p=>p.package===choice);
 const running=job&&!["succeeded","failed","interrupted"].includes(job.state);
 return <section id="managed-runtimes" className="surface-card glass ops-panel-gap" aria-label="Managed host runtimes">
  <div className="section-heading"><div><span className="overline">MANAGED SOFTWARE · UBUNTU</span>
   <h2>Install and manage host runtimes</h2><p>Install PHP-FPM or Redis from Ubuntu's signed package sources with an audited DevOne Agent job.</p>
  </div><button className="ops-secondary" disabled={busy||Boolean(running)} onClick={()=>void refresh().catch(()=>setError("Status refresh failed"))}>Refresh status</button></div>
  <div className="ops-catalog-filters"><select aria-label="Software to manage" value={choice} onChange={e=>{setChoice(e.target.value);setError("");}}>
   {(capabilities?.options??[{package:"php8.3-fpm",label:"PHP 8.3 FPM"},{package:"redis-server",label:"Redis Server"},{package:"docker.io",label:"Docker Engine"}]).map(p=><option key={p.package} value={p.package}>{p.label}</option>)}
  </select></div>
  {selected?<div className="ops-qa-status">
   <div><small>Installation</small><strong>{selected.installed?"Installed":"Not installed"}</strong></div>
   <div><small>Service</small><strong>{selected.serviceActive?"Running":selected.installed?"Stopped":"—"}</strong></div>
   <div><small>Version</small><strong>{selected.version??"—"}</strong></div>
  </div>:<p className="ops-empty">Loading installed software status…</p>}
  {role==="owner"&&!selected?.installed&&<div className="shield-form">
   <label className="shield-label" htmlFor="software-install-password">Owner password</label>
   <input id="software-install-password" type="password" autoComplete="current-password" maxLength={1024} value={password} onChange={e=>setPassword(e.target.value)} disabled={busy||Boolean(running)}/>
   {mfaEnabled&&<><label className="shield-label" htmlFor="software-install-mfa">Authenticator or recovery code</label>
    <input id="software-install-mfa" autoComplete="one-time-code" maxLength={17} value={mfaCode} onChange={e=>setMfaCode(e.target.value.trim())} disabled={busy||Boolean(running)}/></>}
   <label className="shield-consent"><input type="checkbox" checked={confirmed} onChange={e=>setConfirmed(e.target.checked)} disabled={busy||Boolean(running)}/> I approve installation of this package and its required dependencies on this development server.</label>
   <button className="primary-button" type="button" onClick={()=>void install()} disabled={!capabilities||busy||Boolean(running)||!confirmed||!password||(mfaEnabled&&!mfaCode)}>
    {running?"Installing…":busy?"Submitting…":"Install "+choice}
   </button>
  </div>}
  {job&&<p role="status" className={job.state==="succeeded"?"inline-notice":job.state==="failed"||job.state==="interrupted"?"ops-warning":"ops-subtext"}>
   Installation job {job.state}. {job.state==="interrupted"?"Outcome uncertain; inspect package status before retrying.":job.state==="failed"?"Review Activity & Jobs and server logs.":""}
  </p>}
  {error&&<p role="alert" className="inline-error">{error}</p>}
  <p className="ops-note">Only these two Ubuntu runtimes are managed here. Installed services can be started, stopped or restarted under Services. This does not install WordPress, DevOne CMS, or other catalog applications. Package removal and automatic dependency rollback are not available yet.</p>
 </section>;
}
export function AppCatalog({role}:{role:string}){
 const [catalog,setCatalog]=useState<Catalog|null>(null);
 const [discovery,setDiscovery]=useState<Discovery|null>(null);
 const [search,setSearch]=useState("");
 const [category,setCategory]=useState("all");
 const [selected,setSelected]=useState<string|null>(null);
 const [error,setError]=useState("");
 useEffect(()=>{void Promise.allSettled([readApi<Catalog>("/api/catalog"),readApi<Discovery>("/api/discovery")]).then(values=>{
  if(values[0].status==="fulfilled")setCatalog(values[0].value); else setError("Catalog unavailable; check DevOne API.");
  if(values[1].status==="fulfilled")setDiscovery(values[1].value);
 });},[]);
 const items=useMemo(()=>catalog?.items.filter(item=>(category==="all"||item.category===category)&&[item.name,item.description,...item.runtime].join(" ").toLowerCase().includes(search.toLowerCase())).sort((a,b)=>Number(Boolean(b.featured))-Number(Boolean(a.featured)))??[],[catalog,search,category]);
 const current=catalog?.items.find(item=>item.id===selected);
 useEffect(()=>{
   if(selected)requestAnimationFrame(()=>document.getElementById("catalog-details")?.scrollIntoView({behavior:"smooth",block:"start"}));
 },[selected]);
 const runtimeNames=new Set(discovery?.runtimes.filter(x=>x.installed).map(x=>x.name.toLowerCase())??[]);
 return <div className="app-catalog">
   <div className="ops-catalog-intro glass"><div><span className="overline">DEVONE SOFTWARE CENTER</span><h2>Launch your next project.</h2><p>Install the supported Ubuntu host runtimes below. Other catalog applications require their individual deployment adapters.</p></div><span className="catalog-count">{catalog?.items.length??"—"} catalog entries</span></div>
   {["owner","admin"].includes(role)&&<RuntimeManager role={role}/>}
   <div className="ops-catalog-filters"><input aria-label="Search software and frameworks" value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search CMS, frameworks, runtimes…"/><select aria-label="Filter software by category" value={category} onChange={e=>setCategory(e.target.value)}><option value="all">All software</option><option value="cms">CMS platforms</option><option value="framework">Frameworks</option><option value="runtime">Runtimes</option><option value="platform">Platforms</option></select></div>
   {error&&<p role="alert" className="inline-error">{error}</p>}
   <div className="ops-catalog-grid">{items.map(item=><article key={item.id} className={"catalog-card glass "+(item.featured?"featured":"")}><div className="catalog-card-heading"><div className="catalog-icon">{item.name.slice(0,1)}</div><span className="catalog-type">{item.category}</span></div><h3>{item.name} {item.featured&&<span className="catalog-featured">Featured</span>}</h3><p>{item.description}</p><div className="catalog-meta">{item.latestKnownVersion&&<span>Reference: {item.latestKnownVersion}</span>}<span>{item.releaseChannel}</span></div><div className="catalog-card-actions"><button onClick={()=>{if(item.id==="php"&&["owner","admin"].includes(role)){document.getElementById("managed-runtimes")?.scrollIntoView({behavior:"smooth",block:"start"});}else setSelected(item.id);}}>{item.id==="php"&&["owner","admin"].includes(role)?"Manage PHP 8.3":"View requirements"} <span aria-hidden="true">→</span></button><a href={item.sourceUrl} target="_blank" rel="noopener noreferrer">Official source ↗</a></div></article>)}</div>
   {!catalog&&!error&&<p className="ops-empty">Loading verified software catalog…</p>}
   {catalog&&items.length===0&&<p className="ops-empty">No software matches your search.</p>}
   {current&&<section id="catalog-details" className="surface-card glass catalog-details" aria-label={"Deployment planning for "+current.name}><div className="section-heading"><div><span className="overline">DEPLOYMENT READINESS</span><h2>{current.name}</h2></div><button className="ops-secondary" onClick={()=>setSelected(null)}>Close</button></div><p>{current.description}</p>
    {current.verifiedAt&&<p className="ops-subtext">Reference verified {current.verifiedAt}. Check upstream for newer releases.</p>}
    <h3>Required technology</h3><div className="catalog-requirements">{current.runtime.map(name=><span key={name}>{runtimeNames.has(name.toLowerCase())?"✓ ":""}{name}</span>)}</div>
    <p className="ops-warning">Installation not yet enabled. DevOne cannot safely provision this product until its runtime, domain, database, permissions and rollback adapter are implemented. A checked runtime is not proof that the application is deployed.</p>
    <div className="catalog-resource-links"><a href={current.docsUrl} rel="noopener noreferrer" target="_blank">Official installation guide ↗</a><a href={current.sourceUrl} rel="noopener noreferrer" target="_blank">Verified source repository ↗</a></div>
   </section>}
   <p className="ops-note">The catalog does not download or execute untrusted software. WordPress release references are version snapshots, not a live-update promise. For static projects, Websites & Files already supports managed hosting.</p>
 </div>;
}
export function SecurityCenter({onAi,role}:{onAi:()=>void;role:string}){
 const [data,setData]=useState<ScanState|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState(""),[notice,setNotice]=useState("");
 async function refresh(){setData(await readApi<ScanState>("/api/security"));}
 useEffect(()=>{void refresh().catch(e=>setError(String(e)));const timer=setInterval(()=>{void refresh().catch(()=>{});},30000);return()=>clearInterval(timer);},[]);
 async function scan(){
  setBusy(true);setError("");setNotice("");
  try{
   const r=await fetch("/api/security/scan",{method:"POST",headers:{"Content-Type":"application/json"},body:"{}",credentials:"same-origin"});
   const value=await r.json() as {error?:string;report?:Scan};
   if(!r.ok)throw Error(value.error??"Scan failed");
   setNotice("Passive server configuration checks completed. Unknown checks require manual verification.");
   await refresh();
  }catch(e){setError(e instanceof Error?e.message:"Security check failed");}
  finally{setBusy(false);}
 }
 const scanResult=data?.latest;
 return <div className="security-center">
  <OwnerMfaSettings role={role}/>
  <CrowdSecStatus/>
  <SiteWafConsole role={role}/>
  <article className="surface-card glass"><div className="section-heading"><div><h2>Read-only server posture check</h2><p>Automatically at startup and every six hours · No intrusive probes</p></div><button className="primary-button" disabled={busy||data?.busy} onClick={()=>void scan()}>{busy||data?.busy?"Scanning…":"Scan server now"}</button></div>
   <div className="ops-qa-status"><div><small>Needs review</small><strong>{scanResult?.summary.warnings??"—"}</strong></div><div><small>Checks passed</small><strong>{scanResult?.summary.passed??"—"}</strong></div><div><small>Unverified</small><strong>{scanResult?.summary.unknown??"—"}</strong></div></div>
   {scanResult&&<p className="ops-subtext">Last completed {new Date(scanResult.checkedAt).toLocaleString()}</p>}
   <p className="ops-note">This scan checks SSH, firewall, public TCP listeners, encryption-key access and APT upgrade metadata. It is not a CVE database scan, penetration test or guarantee against compromise.</p>
   {error&&<p role="alert" className="inline-error">{error}</p>}{notice&&<p role="status" className="inline-notice">{notice}</p>}
  </article>
  <article className="surface-card glass ops-panel-gap"><div className="section-heading"><div><h2>Findings and recommendations</h2><p>Every result includes the evidence limitation and a suggested next step</p></div><button className="text-action" onClick={onAi}>Discuss with DevOne AI →</button></div>
   {scanResult?<div className="security-findings">{scanResult.findings.map(f=><div key={f.id} className="security-finding"><div className="security-finding-heading"><strong>{f.title}</strong><span className={"state-chip "+(f.status==="pass"?"good":f.status==="warning"?"bad":"neutral")}>{f.status==="warning"?f.severity+" · review":f.status}</span></div><p>{f.detail}</p><small>{f.recommendation}</small></div>)}</div>:<p className="ops-empty">A first-run scan will be recorded shortly. You can start one now.</p>}
   {scanResult&&<p className="ops-note">{scanResult.limitations.join(" ")}</p>}
  </article>
 </div>;
}
export function DashboardInsights({onAi,onSecurity,onApps}:{onAi:()=>void;onSecurity:()=>void;onApps:()=>void}){
 const [providers,setProviders]=useState<Status["providers"]>([]),[security,setSecurity]=useState<ScanState|null>(null);
 useEffect(()=>{void readApi<Status>("/api/ai/status").then(x=>setProviders(x.providers)).catch(()=>{});void readApi<ScanState>("/api/security").then(setSecurity).catch(()=>{});},[]);
 const count=providers.filter(x=>x.configured).length;
 return <section className="dashboard-insights"><article className="surface-card glass insight-card"><div className="insight-icon">✧</div><div><span className="overline">DEVONE AI</span><h2>Your AI infrastructure assistant</h2><p>{count?count+" AI provider"+(count===1?"":"s")+" connected":"Connect Gemini, OpenAI, DeepSeek or OpenClaw"}. Diagnose host health and review security findings.</p><button className="text-action" onClick={onAi}>Open DevOne AI →</button></div></article>
 <article className="surface-card glass insight-card"><div className="insight-icon security">⌑</div><div><span className="overline">SECURITY CENTER</span><h2>Security posture</h2><p>{security?.latest?security.latest.summary.warnings+" findings need review · "+security.latest.summary.unknown+" unknown checks":"Waiting for your first server security scan."}</p><button className="text-action" onClick={onSecurity}>Open security center →</button></div></article>
 <article className="surface-card glass insight-card"><div className="insight-icon apps">◈</div><div><span className="overline">SOFTWARE CENTER</span><h2>DevOne CMS v2 & more</h2><p>Explore WordPress, Next.js and modern development frameworks.</p><button className="text-action" onClick={onApps}>Explore software →</button></div></article></section>;
}
