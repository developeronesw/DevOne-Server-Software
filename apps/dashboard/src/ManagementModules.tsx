import {useEffect,useMemo,useState} from "react";
import {SiteWafConsole} from "./SiteWafConsole";

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

export function AppCatalog(){
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
 const runtimeNames=new Set(discovery?.runtimes.filter(x=>x.installed).map(x=>x.name.toLowerCase())??[]);
 return <div className="app-catalog">
   <div className="ops-catalog-intro glass"><div><span className="overline">DEVONE SOFTWARE CENTER</span><h2>Launch your next project.</h2><p>Explore trusted software sources, compare prerequisites and plan an installation. Host-managed one-click deployments will become available after isolation and rollback testing.</p></div><span className="catalog-count">{catalog?.items.length??"—"} catalog entries</span></div>
   <div className="ops-catalog-filters"><input aria-label="Search software and frameworks" value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search CMS, frameworks, runtimes…"/><select aria-label="Filter software by category" value={category} onChange={e=>setCategory(e.target.value)}><option value="all">All software</option><option value="cms">CMS platforms</option><option value="framework">Frameworks</option><option value="runtime">Runtimes</option><option value="platform">Platforms</option></select></div>
   {error&&<p role="alert" className="inline-error">{error}</p>}
   <div className="ops-catalog-grid">{items.map(item=><article key={item.id} className={"catalog-card glass "+(item.featured?"featured":"")}><div className="catalog-card-heading"><div className="catalog-icon">{item.name.slice(0,1)}</div><span className="catalog-type">{item.category}</span></div><h3>{item.name} {item.featured&&<span className="catalog-featured">Featured</span>}</h3><p>{item.description}</p><div className="catalog-meta">{item.latestKnownVersion&&<span>Reference: {item.latestKnownVersion}</span>}<span>{item.releaseChannel}</span></div><div className="catalog-card-actions"><button onClick={()=>setSelected(item.id)}>View requirements <span aria-hidden="true">→</span></button><a href={item.sourceUrl} target="_blank" rel="noopener noreferrer">Official source ↗</a></div></article>)}</div>
   {!catalog&&!error&&<p className="ops-empty">Loading verified software catalog…</p>}
   {catalog&&items.length===0&&<p className="ops-empty">No software matches your search.</p>}
   {current&&<section className="surface-card glass catalog-details" aria-label={"Deployment planning for "+current.name}><div className="section-heading"><div><span className="overline">DEPLOYMENT READINESS</span><h2>{current.name}</h2></div><button className="ops-secondary" onClick={()=>setSelected(null)}>Close</button></div><p>{current.description}</p>
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
