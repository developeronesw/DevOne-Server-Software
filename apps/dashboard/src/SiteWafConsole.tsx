import {useEffect,useState} from "react";
type Policy={mode:"off"|"monitor"|"enforce";requestsPerSecond:number;burst:number};
type Site={siteId:string;domain:string;webServer:string;state:string;revision:number;available:boolean;policy:Policy};
type Shield={sites:Site[];engine:string;webApplicationFirewall:boolean;globalPanelWaf:boolean;disclaimer:string};
async function api<T>(path:string,init?:RequestInit):Promise<T>{
 const response=await fetch(path,{credentials:"same-origin",cache:"no-store",...init});
 const data=await response.json().catch(()=>({})) as T & {error?:string};
 if(!response.ok)throw Error(data.error??"Service unavailable");
 return data;
}
export function SiteWafConsole({role}:{role:string}){
 const [data,setData]=useState<Shield|null>(null),[selected,setSelected]=useState("");
 const [policy,setPolicy]=useState<Policy>({mode:"off",requestsPerSecond:10,burst:20});
 const [password,setPassword]=useState("");
 const [confirm,setConfirm]=useState(false);
 const [loading,setLoading]=useState(true),[busy,setBusy]=useState(false),[error,setError]=useState(""),[message,setMessage]=useState("");
 const site=data?.sites.find(s=>s.siteId===selected);
 const enabled=site?.available===true&&role==="owner";
 const update=(next:Site)=>{setSelected(next.siteId);setPolicy({...next.policy});setPassword("");setConfirm(false);setMessage("");setError("");};
 async function refresh(resetSelection=false){
  try{
   const next=await api<Shield>("/api/shield");
   setData(next);
   const target=next.sites.find(s=>s.siteId===selected)??next.sites[0];
   if(target&&(resetSelection||!selected||!next.sites.some(s=>s.siteId===selected)))update(target);
   setLoading(false);
  }catch(e){setLoading(false);setError(e instanceof Error?e.message:"Could not load sites");}
 }
 useEffect(()=>{void refresh(true);},[]);
 async function save(){
  if(!site||!enabled||!confirm||!password)return;
  if(!window.confirm("Apply "+policy.mode.toUpperCase()+" HTTP rate protection to "+site.domain+"? NGINX will be tested and reloaded. This may affect visitors."))return;
  setBusy(true);setError("");setMessage("");
  try{
   await api("/api/shield/sites/"+encodeURIComponent(site.siteId),{
    method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({expectedRevision:site.revision,policy,password,confirmed:true})
   });
   setPassword("");setConfirm(false);
   setMessage("Rate protection updated. NGINX configuration passed validation and reload.");
   const result=await api<Shield>("/api/shield");
   setData(result);
   const updated=result.sites.find(s=>s.siteId===site.siteId);
   if(updated)setPolicy({...updated.policy});
  }catch(e){
   const code=e instanceof Error?e.message:"Unable to apply site protection";
   setError(({site_revision_conflict:"This site's configuration changed. Refresh before making changes.",site_config_changed:"This NGINX file was modified outside DevOne; manual inspection is required.",site_not_ready:"This website is not ready for security changes.",owner_password_invalid:"Incorrect Owner password.",shield_result_requires_inspection:"The Agent might have completed the operation despite the API error. Refresh and inspect state before trying again."} as Record<string,string>)[code]??code);
  }finally{setBusy(false);}
 }
 return <article className="surface-card glass shield-console">
  <div className="section-heading"><div><h2>Per-site HTTP protection</h2><p>Independent NGINX policies. Each website can monitor or enforce its own request-rate limits.</p></div><span className="state-chip neutral">NGINX rate protection</span></div>
  <p className="ops-note">This first layer handles excessive HTTP request rates. It is not yet a complete WAF: SQL injection detection, crawler fingerprinting, CAPTCHA challenges, threat intelligence and DDoS mitigation are not included. No global rules will be changed.</p>
  {loading?<p className="ops-empty">Checking website security policies…</p>:data?.sites.length===0?<p className="ops-empty">Create a managed website to configure its protection.</p>:<>
   <label className="shield-label" htmlFor="shield-site">Website</label>
   <select id="shield-site" value={selected} onChange={e=>{const item=data?.sites.find(s=>s.siteId===e.target.value);if(item)update(item);}}>
    {data?.sites.map(s=><option key={s.siteId} value={s.siteId}>{s.domain} — {s.state==="ready"&&s.webServer==="nginx"?"configurable":s.webServer==="none"?"private workspace":s.state}</option>)}
   </select>
   <div className="shield-stat"><div><small>Website state</small><strong>{site?.state??"—"}</strong></div><div><small>Security mode</small><strong>{site?.policy.mode??"off"}</strong></div><div><small>Config revision</small><strong>{site?.revision??"—"}</strong></div></div>
   {site&&!site.available?<p className="ops-warning">Only ready NGINX websites support site rate protection. Private file workspaces and sites needing inspection cannot be updated.</p>:<>
    <div className="shield-form">
     <label>Security mode<select disabled={!enabled||busy} value={policy.mode} onChange={e=>setPolicy({...policy,mode:e.target.value as Policy["mode"]})}><option value="off">Off — no rate restriction</option><option value="monitor">Monitor — log over-limit requests without blocking</option><option value="enforce">Enforce — respond with HTTP 429 to over-limit requests</option></select></label>
     <label>Per-IP request rate<select disabled={!enabled||busy} value={policy.requestsPerSecond} onChange={e=>setPolicy({...policy,requestsPerSecond:Number(e.target.value)})}>{[1,2,5,10,15,20,30,50].map(x=><option key={x} value={x}>{x} requests / second</option>)}</select></label>
     <label>Allowed burst<select disabled={!enabled||busy} value={policy.burst} onChange={e=>setPolicy({...policy,burst:Number(e.target.value)})}>{[1,5,10,20,30,50,100].map(x=><option key={x} value={x}>{x} extra requests</option>)}</select></label>
    </div>
    {policy.mode==="enforce"&&<p className="ops-warning">Enforcement may affect legitimate users behind shared IPs, NAT or reverse proxies (including Cloudflare). Without a correctly configured, tightly trusted NGINX real-IP chain, every visitor behind a proxy may share one rate-limit identity. Start with Monitor; validate client IP detection and traffic before enabling blocking.</p>}
    {role==="owner"&&<>
     <label className="shield-label" htmlFor="shield-password">Owner password to apply this change</label>
     <input id="shield-password" disabled={!enabled||busy} type="password" autoComplete="current-password" maxLength={1024} value={password} onChange={e=>setPassword(e.target.value)} placeholder="Enter your Owner password"/>
     <label className="shield-consent"><input type="checkbox" disabled={!enabled||busy} checked={confirm} onChange={e=>setConfirm(e.target.checked)}/> I understand NGINX will be validated and reloaded for this site's security policy.</label>
     <div className="shield-actions"><button className="primary-button" disabled={!enabled||busy||!confirm||!password||JSON.stringify(policy)===JSON.stringify(site?.policy)} onClick={()=>void save()}>{busy?"Applying…":"Apply security policy"}</button><button className="ops-secondary" disabled={busy} onClick={()=>void refresh(true)}>Refresh policies</button></div>
    </>}
    {role!=="owner"&&<p className="ops-note">Security policy changes are restricted to the Owner account. Administrators may inspect policies.</p>}
   </>}
  </>}
  {error&&<p role="alert" className="inline-error">{error}</p>}{message&&<p role="status" className="inline-notice">{message}</p>}
 </article>;
}
