import {CmsInstaller} from "./CmsInstaller";
import {WordPressInstaller} from "./WordPressInstaller";
import {useEffect,useState} from "react";
type App={id:string;name:string;siteType:string;version:string};
type Site={id:string;domain:string;siteType:string;revision:number;state:string};
type Job={id:string;state:string;error:string|null};
async function api<T>(url:string,body?:unknown):Promise<T>{
 const r=await fetch(url,{credentials:"same-origin",cache:"no-store",...(body?{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)}:{})});
 const data=await r.json();if(!r.ok)throw Error(data.error??"Request failed");return data;
}
export function AppInstaller({selectionRequest,onBusyChange}:{selectionRequest?:{appId:"wordpress"|"devone-cms-v2";requestId:number};onBusyChange?:(busy:boolean)=>void}={}){
 const [apps,setApps]=useState<App[]>([]),[sites,setSites]=useState<Site[]>([]),[appId,setAppId]=useState("static-starter"),[target,setTarget]=useState("new"),[domain,setDomain]=useState(""),[error,setError]=useState(""),[busy,setBusy]=useState(false),[job,setJob]=useState<Job|null>(null);
 const [deployment,setDeployment]=useState<'local'|'cloudflare'>('local');
 async function refresh(){const [a,s]=await Promise.all([api<{apps:App[]}>("/api/apps"),api<{sites:Site[]}>("/api/sites")]);setApps(a.apps);setSites(s.sites);}
 useEffect(()=>{void refresh().catch(e=>setError(e.message));},[]);
 useEffect(()=>{
  if(!job||["succeeded","failed","interrupted"].includes(job.state))return;
  const timer=setInterval(()=>{void api<{job:Job}>("/api/jobs/"+job.id).then(d=>{setJob(d.job);if(d.job.state==="succeeded")void refresh().catch(()=>{});}).catch(e=>setError(e.message));},2500);
  return ()=>clearInterval(timer);
 },[job]);
 const selected=apps.find(a=>a.id===appId),site=sites.find(s=>s.id===target);
 const running=busy||Boolean(job&&["queued","running"].includes(job.state));
 useEffect(()=>{onBusyChange?.(running);},[running,onBusyChange]);
 useEffect(()=>{
  if(selectionRequest&&!running){setAppId(selectionRequest.appId);setTarget("new");setDeployment("local");setJob(null);setError("");}
 },[selectionRequest]);
 async function install(){
  setBusy(true);setError("");
  try{const data=await api<{job:Job}>("/api/apps/install",{appId,confirmed:true,requestKey:crypto.randomUUID(),...(target==="new"?{domain:domain.trim().toLowerCase()}:{siteId:site?.id,expectedRevision:site?.revision??1})});setJob(data.job);}
  catch(e){setError(e instanceof Error?e.message:"Installation request failed. Check Activity & jobs before retrying.");}finally{setBusy(false);}
 }
 return <section className="surface-card glass"><span className="overline">INSTALL AN APP</span><h2>From an idea to a running website.</h2><p>Launch a built-in starter in one step. Existing sites must be empty; DevOne checks again before writing files. Node apps start automatically. Owners can also install WordPress or the DevOne CMS local preview with your chosen administrator account.</p>
 <label>Application <select disabled={running} value={appId} onChange={e=>{setAppId(e.target.value);setTarget("new");setDeployment("local");}}>{apps.map(a=><option key={a.id} value={a.id}>{a.name} · {a.version}</option>)}</select></label>{" "}
 {appId==="devone-cms-v2"&&<label>Installation type <select disabled={running} value={deployment} onChange={e=>setDeployment(e.target.value as 'local'|'cloudflare')}><option value="local">Local · install on this server</option><option value="cloudflare">Cloudflare Workers · guided setup</option></select></label>}
 {appId==="wordpress"&&<p className="ops-note">Installation type: Local server · PHP and MariaDB. Cloudflare DNS/proxy can sit in front of this site; Cloudflare Workers cannot run this WordPress PHP package.</p>}
 {(appId!=="devone-cms-v2"||deployment==='local')&&<><label>Destination <select disabled={running} value={target} onChange={e=>setTarget(e.target.value)}><option value="new">Create a new website</option>{sites.filter(s=>s.state==="ready"&&s.siteType===selected?.siteType).map(s=><option key={s.id} value={s.id}>{s.domain}</option>)}</select></label>
 {target==="new"&&<label> Domain <input disabled={running} value={domain} onChange={e=>setDomain(e.target.value)} placeholder="app.example.com"/></label>}
 </>}
 {(appId!=="devone-cms-v2"||deployment==='local')&&<p>Uses the site's isolated user and managed runtime. Point the domain's DNS at this server, then issue HTTPS from Websites &amp; files.</p>}
 {appId==="devone-cms-v2"&&deployment==='cloudflare'?<section className="installer-account"><h3>Cloudflare Workers deployment</h3><p>This choice runs in your Cloudflare account using D1, KV and R2, rather than on this VPS. Automated Cloudflare provisioning from this panel is not implemented yet.</p><ol><li>Deploy the CMS Cloudflare package in your own account using its deployment guide.</li><li>Open that deployed CMS URL and choose Cloudflare in its setup wizard.</li><li>Create your administrator username, email and password there, then complete the resource checks.</li></ol><p>No local site, job, account or Cloudflare resource is created by selecting this option. Keep Cloudflare API credentials out of this form.</p><a href="https://github.com/developeronesw/DevOneCMS-v2#cloudflare-deployment" target="_blank" rel="noopener noreferrer">Open Cloudflare deployment guide ↗</a></section>:appId==="wordpress"?<WordPressInstaller siteId={target!=="new"?site?.id:undefined} expectedRevision={site?.revision??1} domain={target==="new"?domain:undefined} onBusy={setBusy}/>:appId==="devone-cms-v2"?<CmsInstaller siteId={target!=="new"?site?.id:undefined} expectedRevision={site?.revision??1} domain={target==="new"?domain:undefined} onBusy={setBusy}/>:<><button className="primary-button" disabled={running||!selected||(target==="new"?!domain.trim():!site)} onClick={()=>void install()}>{running?"Installing…":target==="new"?"Create website & install":"Install on selected website"}</button>
 </>}
 {!["wordpress","devone-cms-v2"].includes(appId)&&job&&<p role="status">Installation {job.state}. Job: {job.id}{job.state==="succeeded"?" — Open Websites & files to manage your app.":""}{job.error?" — "+job.error+". Inspect the site and Agent journal before retrying.":""}</p>}{error&&<p role="alert" className="inline-error">{error}</p>}
 </section>;
}
