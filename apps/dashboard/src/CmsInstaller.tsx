import {CredentialReveal} from './CredentialReveal';
import {AdminAccountFields,adminAccountReady} from './AdminAccountFields';
import {useEffect,useRef,useState} from 'react';
type Job={id:string;state:string;error:string|null};
type Installation={id:string;domain?:string;title:string;job:Job|null};
type Progress={siteId:string;domain:string;state:string;stage:string;tls:boolean};
async function api<T>(url:string,body?:unknown):Promise<T>{const r=await fetch(url,{credentials:'same-origin',cache:'no-store',...(body?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{})});const b=await r.json();if(!r.ok)throw Error(b.error??'Request failed');return b;}
const messages:Record<string,string>={queued:'Waiting for the installation worker.',running:'Checking prerequisites and preparing the website.',database:'Initializing private SQLite storage.',installing:'Verifying the CMS preview package and initializing your administrator.',publishing:'Publishing the configured website.',verifying:'Starting the isolated Node service and checking the dashboard.',complete:'DevOne CMS is installed and responding.'};
const errors:Record<string,string>={invalid_administrator_account:'Choose a valid administrator username and a matching 12–128 character password.',cms_local_deployment_required:'Use Local for server installation; Cloudflare has a separate guided setup.',cms_https_required:'Enable HTTPS for this website in Websites & files before revealing its login.',cms_install_requires_inspection:'Setup stopped. Private CMS data and staged files were preserved for inspection. Inspect the website and Agent journal before another attempt.',app_target_not_empty:'The selected website contains files. Choose an empty Node.js website or a new domain.',cms_artifact_unavailable:'The verified CMS package is unavailable. Inspect the installation before retrying.'};
export function CmsInstaller({siteId,domain,expectedRevision,onBusy}:{siteId?:string;domain?:string;expectedRevision?:number;onBusy:(busy:boolean)=>void}){
 const [title,setTitle]=useState('My DevOne CMS website'),[email,setEmail]=useState(''),[password,setPassword]=useState(''),[mfaCode,setMfaCode]=useState(''),[confirmed,setConfirmed]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(''),[job,setJob]=useState<Job|null>(null),[id,setId]=useState(''),[progress,setProgress]=useState<Progress|null>(null),[history,setHistory]=useState<Installation[]>([]);
 const [adminUsername,setAdminUsername]=useState(''),[adminPassword,setAdminPassword]=useState(''),[adminConfirm,setAdminConfirm]=useState('');
 const [revealEpoch,setRevealEpoch]=useState(0);
 const reservation=useRef<{signature:string;key:string}|null>(null);
 const running=Boolean(job&&['queued','running'].includes(job.state));
 useEffect(()=>{onBusy(busy||running);return ()=>onBusy(false);},[busy,running,onBusy]);
 async function refreshHistory(){setHistory((await api<{installations:Installation[]}>('/api/apps/devone-cms')).installations);}
 useEffect(()=>{void refreshHistory().catch(e=>setError(e.message));},[]);
 useEffect(()=>{
  if(!id||!job)return;
  let active=true;
  async function refresh(){try{const [j,p]=await Promise.all([api<{job:Job}>('/api/jobs/'+job!.id),api<{installation:Progress|null}>('/api/apps/devone-cms/'+id)]);if(active){setJob(j.job);setProgress(p.installation);setHistory(rows=>rows.map(row=>row.id===id?{...row,job:j.job}:row));}}catch(e){if(active)setError(e instanceof Error?e.message:'Status unavailable');}}
  void refresh();const timer=setInterval(()=>void refresh(),2500);
  return ()=>{active=false;clearInterval(timer);};
 },[id,job?.id]);
 async function install(){
  setBusy(true);setError('');setProgress(null);setRevealEpoch(v=>v+1);
  try{const metadata={title:title.trim(),email:email.trim(),adminUsername:adminUsername.trim(),deployment:'local',...(siteId?{siteId,expectedRevision}:{domain:domain?.trim().toLowerCase()})};
  const digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(adminPassword)))).map(x=>x.toString(16).padStart(2,'0')).join(''),signature=JSON.stringify({...metadata,credentialDigest:digest});
  if(reservation.current?.signature!==signature)reservation.current={signature,key:crypto.randomUUID()};
  const b=await api<{job:Job;installationId:string}>('/api/apps/devone-cms/install',{...metadata,confirmed,requestKey:reservation.current.key,adminPassword,adminPasswordConfirm:adminConfirm,password,mfaCode:mfaCode||undefined});setJob(b.job);setId(b.installationId);void refreshHistory().catch(()=>{});}
  catch(e){setError(e instanceof Error?e.message:'Installation request failed. Check Activity & jobs before retrying.');}finally{setAdminPassword('');setAdminConfirm('');setPassword('');setMfaCode('');setBusy(false);}
 }
 return <div className="managed-installer">
 <h3>DevOne CMS · preview installation</h3><p>Install the prebuilt DevOne CMS 2.0.0-alpha.5 local preview with SQLite, private storage and an isolated Node.js service. Existing files and runtime customizations are protected. This preview packages the current single-site CMS foundation; stable CMS acceptance remains open.</p>
 <div className="form-grid"><label>Website title<input maxLength={120} value={title} disabled={busy||running} onChange={e=>setTitle(e.target.value)}/></label><label>Administrator email<input type="email" autoComplete="email" value={email} disabled={busy||running} onChange={e=>setEmail(e.target.value)}/></label></div>
 <AdminAccountFields username={adminUsername} password={adminPassword} confirm={adminConfirm} onUsername={setAdminUsername} onPassword={setAdminPassword} onConfirm={setAdminConfirm} disabled={busy||running}/>
 <div className="installer-approval"><h4>Panel Owner approval</h4><p>Your panel password below authorizes this administrative action. It does not become the application password.</p>
 <label>Panel Owner password<input type="password" autoComplete="section-panel current-password" value={password} disabled={busy||running} onChange={e=>setPassword(e.target.value)}/></label><label>MFA code, if enabled<input inputMode="numeric" autoComplete="one-time-code" value={mfaCode} disabled={busy||running} onChange={e=>setMfaCode(e.target.value)}/></label>
 <label><input type="checkbox" checked={confirmed} disabled={busy||running} onChange={e=>setConfirmed(e.target.checked)}/> I approve installation of this DevOne CMS preview and its private SQLite database on {siteId?'the selected empty Node.js website':domain||'the new website'}.</label>
 </div>
 <p className="installer-security-note">Your chosen administrator password is encrypted in the Vault and supplied only to this installation. Enable HTTPS in Websites &amp; files before signing in. Updating DevOne Server does not reset existing application accounts.</p>
 <button className="primary-button" disabled={busy||running||!confirmed||!password||!title.trim()||!email.trim()||!adminAccountReady(adminUsername,adminPassword,adminConfirm)||(!siteId&&!domain?.trim())} onClick={()=>void install()}>{busy||running?'Working…':'Install DevOne CMS'}</button>
 {job&&<section className="installer-progress" aria-label="Installation progress"><div className="installer-section-heading"><div><span className="overline">INSTALLATION STATUS</span><h3>{messages[progress?.stage??job.state]??job.state}</h3>{progress&&<p>{progress.domain} · {progress.state}</p>}</div><span className={'state-chip '+(job.state==='succeeded'?'good':job.state==='failed'?'bad':'neutral')}>{job.state}</span></div><p className="installer-job-id">Job: {job.id}</p>{job.error&&<p role="alert" className="inline-error">{errors[job.error]??job.error}</p>}</section>}
 {job?.state==='succeeded'&&<CredentialReveal key={id+':'+(siteId??domain??'')+':'+revealEpoch} product="devone-cms" installationId={id} domain={progress?.domain} tls={progress?.tls} onBusy={setBusy}/>}
 {history.length>0&&<details className="installer-history"><summary>Recent DevOne CMS installations</summary>{history.map(h=><div className="installer-history-row" key={h.id}>{h.title} · {h.domain??h.id} · {h.job?.state??'reserved'} {h.job&&<button disabled={busy||running} onClick={()=>{setId(h.id);setJob(h.job);setProgress(null);setRevealEpoch(v=>v+1);}}>View installation</button>}</div>)}</details>}
 {error&&<p role="alert" className="inline-error">{errors[error]??error}</p>}
 </div>;
}
