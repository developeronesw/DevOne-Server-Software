import {CredentialReveal} from './CredentialReveal';
import {AdminAccountFields,adminAccountReady} from './AdminAccountFields';
import {useEffect,useRef,useState} from 'react';
type Job={id:string;state:string;error:string|null};
type Installation={id:string;domain?:string;title:string;job:Job|null};
type Progress={siteId:string;domain:string;state:string;stage:string;tls:boolean};
async function api<T>(url:string,body?:unknown):Promise<T>{const r=await fetch(url,{credentials:'same-origin',cache:'no-store',...(body?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{})});const b=await r.json();if(!r.ok)throw Error(b.error??'Request failed');return b;}
const messages:Record<string,string>={queued:'Waiting for the installation worker.',running:'Checking prerequisites and preparing the website.',database:'Creating a private database and account.',installing:'Verifying WordPress files and setting up your administrator.',publishing:'Publishing the configured website.',verifying:'Checking the live WordPress login page.',complete:'WordPress is installed and responding.'};
const errors:Record<string,string>={invalid_administrator_account:'Choose a valid administrator username and a matching 12–128 character password.',wordpress_https_required:'Enable HTTPS for this website in Websites & files before revealing its login.',wordpress_install_requires_inspection:'Setup stopped. The database and any staged files were preserved for inspection. Inspect the website and Agent journal before another attempt.',app_target_not_empty:'The selected website contains files. Choose an empty PHP website or a new domain.',wordpress_artifact_unavailable:'The verified WordPress download is unavailable. No unverified application code was installed.'};
export function WordPressInstaller({siteId,domain,expectedRevision,onBusy}:{siteId?:string;domain?:string;expectedRevision?:number;onBusy:(busy:boolean)=>void}){
 const [title,setTitle]=useState('My WordPress website'),[email,setEmail]=useState(''),[password,setPassword]=useState(''),[mfaCode,setMfaCode]=useState(''),[confirmed,setConfirmed]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(''),[job,setJob]=useState<Job|null>(null),[id,setId]=useState(''),[progress,setProgress]=useState<Progress|null>(null),[history,setHistory]=useState<Installation[]>([]);
 const [adminUsername,setAdminUsername]=useState(''),[adminPassword,setAdminPassword]=useState(''),[adminConfirm,setAdminConfirm]=useState('');
 const [revealEpoch,setRevealEpoch]=useState(0),[unlockBusy,setUnlockBusy]=useState(false);
 const reservation=useRef<{signature:string;key:string}|null>(null);
 const running=Boolean(job&&['queued','running'].includes(job.state));
 const actionBusy=busy||unlockBusy;
 useEffect(()=>{onBusy(actionBusy||running);return ()=>onBusy(false);},[actionBusy,running,onBusy]);
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
  setBusy(true);setError('');setProgress(null);setRevealEpoch(v=>v+1);
  try{const metadata={title:title.trim(),email:email.trim(),adminUsername:adminUsername.trim(),...(siteId?{siteId,expectedRevision}:{domain:domain?.trim().toLowerCase()})};
  const digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(adminPassword)))).map(x=>x.toString(16).padStart(2,'0')).join(''),signature=JSON.stringify({...metadata,credentialDigest:digest});
  if(reservation.current?.signature!==signature)reservation.current={signature,key:crypto.randomUUID()};
  const b=await api<{job:Job;installationId:string}>('/api/apps/wordpress/install',{...metadata,confirmed,requestKey:reservation.current.key,adminPassword,adminPasswordConfirm:adminConfirm,password,mfaCode:mfaCode||undefined});setJob(b.job);setId(b.installationId);void refreshHistory().catch(()=>{});}
  catch(e){setError(e instanceof Error?e.message:'Installation request failed. Check Activity & jobs before retrying.');}finally{setAdminPassword('');setAdminConfirm('');setPassword('');setMfaCode('');setBusy(false);}
 }
 return <div className="managed-installer">
 <h3>WordPress · managed installation</h3><p>DevOne checks and installs missing PHP 8.3 extensions and MariaDB through Software Center, then creates a private database, verifies WordPress 7.1.3 and checks the website. Existing files are protected.</p>
 <div className="form-grid"><label>Website title<input maxLength={120} value={title} disabled={actionBusy||running} onChange={e=>setTitle(e.target.value)}/></label><label>Administrator email<input type="email" autoComplete="email" value={email} disabled={actionBusy||running} onChange={e=>setEmail(e.target.value)}/></label></div>
 <AdminAccountFields username={adminUsername} password={adminPassword} confirm={adminConfirm} onUsername={setAdminUsername} onPassword={setAdminPassword} onConfirm={setAdminConfirm} disabled={actionBusy||running}/>
 <div className="installer-approval"><h4>Panel Owner approval</h4><p>Your panel password below authorizes this administrative action. It does not become the application password.</p>
 <label>Panel Owner password<input type="password" autoComplete="section-panel current-password" value={password} disabled={actionBusy||running} onChange={e=>setPassword(e.target.value)}/></label><label>MFA code, if enabled<input inputMode="numeric" autoComplete="one-time-code" value={mfaCode} disabled={actionBusy||running} onChange={e=>setMfaCode(e.target.value)}/></label>
 <label><input type="checkbox" checked={confirmed} disabled={actionBusy||running} onChange={e=>setConfirmed(e.target.checked)}/> I approve prerequisite package installation, a new database/account, and WordPress installation on {siteId?'the selected empty PHP website':domain||'the new website'}.</label>
 </div>
 <p className="installer-security-note">Your chosen administrator password is encrypted in the Vault and supplied only to this installation. Enable HTTPS in Websites &amp; files before signing in. Updating DevOne Server does not reset existing application accounts.</p>
 <button className="primary-button" disabled={actionBusy||running||!confirmed||!password||!title.trim()||!email.trim()||!adminAccountReady(adminUsername,adminPassword,adminConfirm)||(!siteId&&!domain?.trim())} onClick={()=>void install()}>{actionBusy||running?'Working…':'Install WordPress'}</button>
 {job&&<section className="installer-progress" aria-label="Installation progress"><div className="installer-section-heading"><div><span className="overline">INSTALLATION STATUS</span><h3>{messages[progress?.stage??job.state]??job.state}</h3>{progress&&<p>{progress.domain} · {progress.state}</p>}</div><span className={'state-chip '+(job.state==='succeeded'?'good':job.state==='failed'?'bad':'neutral')}>{job.state}</span></div><p className="installer-job-id">Job: {job.id}</p>{job.error&&<p role="alert" className="inline-error">{errors[job.error]??job.error}</p>}</section>}
 {!busy&&job?.state==='succeeded'&&<CredentialReveal key={id+':'+(siteId??domain??'')+':'+revealEpoch} product="wordpress" installationId={id} domain={progress?.domain} tls={progress?.tls} onBusy={setUnlockBusy}/>}
 {history.length>0&&<details className="installer-history"><summary>Recent WordPress installations</summary>{history.map(h=><div className="installer-history-row" key={h.id}>{h.title} · {h.domain??h.id} · {h.job?.state??'reserved'} {h.job&&<button disabled={actionBusy||running} onClick={()=>{setId(h.id);setJob(h.job);setProgress(null);setRevealEpoch(v=>v+1);}}>View installation</button>}</div>)}</details>}
 {error&&<p role="alert" className="inline-error">{errors[error]??error}</p>}
 </div>;
}
