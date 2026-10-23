import {useEffect,useRef,useState} from 'react';
type Job={id:string;state:string;error:string|null};
type Installation={id:string;domain?:string;title:string;job:Job|null};
type Progress={siteId:string;domain:string;state:string;stage:string;tls:boolean};
async function api<T>(url:string,body?:unknown):Promise<T>{const r=await fetch(url,{credentials:'same-origin',cache:'no-store',...(body?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{})});const b=await r.json();if(!r.ok)throw Error(b.error??'Request failed');return b;}
const messages:Record<string,string>={queued:'Waiting for the installation worker.',running:'Checking prerequisites and preparing the website.',database:'Creating a private database and account.',installing:'Verifying WordPress files and setting up your administrator.',publishing:'Publishing the configured website.',verifying:'Checking the live WordPress login page.',complete:'WordPress is installed and responding.'};
const errors:Record<string,string>={wordpress_https_required:'Enable HTTPS for this website in Websites & files before revealing its login.',wordpress_install_requires_inspection:'Setup stopped. The database and any staged files were preserved for inspection. Inspect the website and Agent journal before another attempt.',app_target_not_empty:'The selected website contains files. Choose an empty PHP website or a new domain.',wordpress_artifact_unavailable:'The verified WordPress download is unavailable. No unverified application code was installed.'};
export function WordPressInstaller({siteId,domain,expectedRevision,onBusy}:{siteId?:string;domain?:string;expectedRevision?:number;onBusy:(busy:boolean)=>void}){
 const [title,setTitle]=useState('My WordPress website'),[email,setEmail]=useState(''),[password,setPassword]=useState(''),[mfaCode,setMfaCode]=useState(''),[confirmed,setConfirmed]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(''),[job,setJob]=useState<Job|null>(null),[id,setId]=useState(''),[progress,setProgress]=useState<Progress|null>(null),[history,setHistory]=useState<Installation[]>([]),[credentials,setCredentials]=useState<{username:string;password:string;loginUrl:string}|null>(null);
 const reservation=useRef<{signature:string;key:string}|null>(null);
 const running=Boolean(job&&['queued','running'].includes(job.state));
 useEffect(()=>{setCredentials(null);},[siteId,domain]);
 useEffect(()=>{if(!credentials)return;const timer=setTimeout(()=>setCredentials(null),60000);return ()=>clearTimeout(timer);},[credentials]);
 useEffect(()=>{onBusy(busy||running);return ()=>onBusy(false);},[busy,running,onBusy]);
 async function refreshHistory(){setHistory((await api<{installations:Installation[]}>('/api/apps/wordpress')).installations);}
 useEffect(()=>{void refreshHistory().catch(e=>setError(e.message));},[]);
 useEffect(()=>{
  if(!id||!job)return;
  let active=true;
  async function refresh(){try{const [j,p]=await Promise.all([api<{job:Job}>('/api/jobs/'+job!.id),api<{installation:Progress|null}>('/api/apps/wordpress/'+id)]);if(active){setJob(j.job);setProgress(p.installation);setHistory(rows=>rows.map(row=>row.id===id?{...row,job:j.job}:row));}}catch(e){if(active)setError(e instanceof Error?e.message:'Status unavailable');}}
  void refresh();const timer=setInterval(()=>void refresh(),2500);
  return ()=>{active=false;clearInterval(timer);};
 },[id,job?.id]);
 async function install(){
  setBusy(true);setError('');setCredentials(null);setProgress(null);
  const metadata={title:title.trim(),email:email.trim(),...(siteId?{siteId,expectedRevision}:{domain:domain?.trim().toLowerCase()})},signature=JSON.stringify(metadata);
  if(reservation.current?.signature!==signature)reservation.current={signature,key:crypto.randomUUID()};
  try{const b=await api<{job:Job;installationId:string}>('/api/apps/wordpress/install',{...metadata,confirmed,requestKey:reservation.current.key,password,mfaCode:mfaCode||undefined});setJob(b.job);setId(b.installationId);void refreshHistory().catch(()=>{});}
  catch(e){setError(e instanceof Error?e.message:'Installation request failed. Check Activity & jobs before retrying.');}finally{setPassword('');setMfaCode('');setBusy(false);}
 }
 async function reveal(){setBusy(true);setError('');setCredentials(null);try{setCredentials(await api('/api/apps/wordpress/'+id+'/credentials',{confirmed:true,password,mfaCode:mfaCode||undefined}));}catch(e){setError(e instanceof Error?e.message:'Credentials unavailable');}finally{setPassword('');setMfaCode('');setBusy(false);}}
 return <div className="surface-card">
 <h3>WordPress · managed installation</h3><p>DevOne checks and installs missing PHP 8.3 extensions and MariaDB through Software Center, then creates a private database, verifies WordPress 7.1.3 and checks the website. Existing files are protected.</p>
 <div className="form-grid"><label>Website title<input maxLength={120} value={title} disabled={busy||running} onChange={e=>setTitle(e.target.value)}/></label><label>Administrator email<input type="email" autoComplete="email" value={email} disabled={busy||running} onChange={e=>setEmail(e.target.value)}/></label></div>
 <label>Owner password<input type="password" autoComplete="current-password" value={password} disabled={busy||running} onChange={e=>setPassword(e.target.value)}/></label><label>MFA code, if enabled<input inputMode="numeric" autoComplete="one-time-code" value={mfaCode} disabled={busy||running} onChange={e=>setMfaCode(e.target.value)}/></label>
 <label><input type="checkbox" checked={confirmed} disabled={busy||running} onChange={e=>setConfirmed(e.target.checked)}/> I approve prerequisite package installation, a new database/account, and WordPress installation on {siteId?'the selected empty PHP website':domain||'the new website'}.</label>
 <p>Administrator: <strong>devone_admin</strong>. DevOne generates and encrypts its password. Point DNS at this server and enable HTTPS in Websites &amp; files before revealing credentials or signing in. Core security/minor updates use WordPress’s background updater.</p>
 <button className="primary-button" disabled={busy||running||!confirmed||!password||!title.trim()||!email.trim()||(!siteId&&!domain?.trim())} onClick={()=>void install()}>{busy||running?'Installing…':'Install WordPress'}</button>
 {job&&<div role="status"><p>{messages[progress?.stage??job.state]??job.state} Job: {job.id} · {job.state}</p>{progress&&<p>Website: {progress.domain} · {progress.state}</p>}{job.error&&<p className="inline-error">{errors[job.error]??job.error}</p>}{job.state==='succeeded'&&<><p>Enable HTTPS, then enter your Owner password/MFA again to reveal the generated login.</p><button disabled={busy||!password} onClick={()=>void reveal()}>Reveal administrator login</button></>}</div>}
 {credentials&&<div role="status"><a href={credentials.loginUrl} target="_blank" rel="noreferrer">Open WordPress login</a><p>Username: <code>{credentials.username}</code></p><p>Password: <code>{credentials.password}</code></p><button onClick={()=>setCredentials(null)}>Hide credentials</button></div>}
 {history.length>0&&<details><summary>Recent WordPress installations</summary>{history.map(h=><p key={h.id}>{h.title} · {h.domain??h.id} · {h.job?.state??'reserved'} {h.job&&<button disabled={busy||running} onClick={()=>{setId(h.id);setJob(h.job);setCredentials(null);setProgress(null);}}>View installation</button>}</p>)}</details>}
 {error&&<p role="alert" className="inline-error">{errors[error]??error}</p>}
 </div>;
}
