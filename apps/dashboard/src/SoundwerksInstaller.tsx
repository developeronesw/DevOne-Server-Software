import {CredentialReveal} from './CredentialReveal';
import {SoundwerksUpdates} from './SoundwerksUpdates';
import {AdminAccountFields,adminAccountReady} from './AdminAccountFields';
import {useEffect,useRef,useState} from 'react';

type Job={id:string;state:string;error:string|null};
type Installation={id:string;domain?:string;title:string;job:Job|null};
type Progress={siteId:string;domain:string;state:string;stage:string;tls:boolean};
async function api<T>(url:string,body?:unknown):Promise<T>{
 const response=await fetch(url,{credentials:'same-origin',cache:'no-store',redirect:'error',
  ...(body?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{})});
 const data=await response.json();
 if(!response.ok)throw Error(data.error??'Request failed');
 return data;
}
const stages:Record<string,string>={
 queued:'Queued for the DevOne Agent',
 running:'Installing prerequisites and preparing isolated hosting',
 database:'Creating the PostgreSQL database and private account',
 installing:'Downloading reviewed Creative Soundwerks source and building Node.js',
 publishing:'Publishing the application into its private site',
 verifying:'Starting Node.js, creating the administrator and checking health',
 complete:'Creative Soundwerks installation completed'
};
const help:Record<string,string>={
 soundwerks_install_requires_inspection:'Installation did not complete. Inspect DevOne Jobs and the site Agent logs; partial database or files are preserved. Do not rerun blindly.',
 soundwerks_prerequisites_unavailable:'Legacy media prerequisite failure. Check DevOne Agent logs for the FFmpeg installation reason.',
 soundwerks_runtime_must_be_stopped:'Stop the selected Node website before installation.',
 app_target_not_empty:'Choose a new domain or a completely empty Node.js 22 website.',
 app_target_incompatible:'The target must be an empty DevOne Node.js 22 website.',
 soundwerks_https_required:'Enable HTTPS in Websites & Files to unlock its saved administrator login.',
 invalid_administrator_account:'Use a unique administrator name and matching strong password.'
};
const prerequisiteReasons:Record<string,string>={
 install_lock_busy:'Another managed installation is running. Inspect Activity & Jobs before retrying.',
 apt_candidate_unavailable:'The Ubuntu package is missing from current APT metadata. Check the Ubuntu repositories and refresh APT metadata.',
 candidate_sources_unavailable:'The candidate package cannot be matched to verified Ubuntu repository metadata.',
 repository_origin_unverified:'The package source could not be verified as an approved Ubuntu Noble repository. DevOne correctly refused to install it.',
 apt_simulation_failed:'Ubuntu could not resolve the package dependencies safely.',
 protected_package_change:'The proposed APT transaction would affect protected DevOne or system packages.',
 apt_transaction_failed:'The package manager reported an installation failure. Inspect the Agent journal and APT logs.',
 package_service_inactive:'The required service or FFmpeg/FFprobe binaries did not pass verification.',
 disk_space_low:'The VPS has less than 512 MiB free disk space.',
 agent_permissions:'The Agent lacks permissions required to install Ubuntu packages.',
 unsupported_ubuntu:'Managed prerequisites require Ubuntu 24.04.',
 unsupported_architecture:'Managed prerequisites require an amd64 VPS.',
 unclassified:'The installation failed without a recognized safe reason. Read the DevOne Agent journal for a sanitized diagnostic.'
};
function installationErrorMessage(code:string):string{
 const match=/^soundwerks_(ffmpeg|postgresql)_([a-z0-9_]+)$/.exec(code);
 if(match){
  const component=match[1]==='ffmpeg'?'FFmpeg / FFprobe':'PostgreSQL';
  const details=prerequisiteReasons[match[2]]??'See the sanitized installation reason in the DevOne Agent journal.';
  return component+' installation failed: '+details;
 }
 return help[code]??code;
}
export function SoundwerksInstaller({siteId,domain,expectedRevision,onBusy}:{
 siteId?:string;domain?:string;expectedRevision?:number;onBusy:(busy:boolean)=>void
}){
 const [title,setTitle]=useState('Creative Soundwerks'),[email,setEmail]=useState('');
 const [adminUsername,setAdminUsername]=useState(''),[adminPassword,setAdminPassword]=useState(''),[adminConfirm,setAdminConfirm]=useState('');
 const [password,setPassword]=useState(''),[mfaCode,setMfaCode]=useState('');
 const [confirmed,setConfirmed]=useState(false),[busy,setBusy]=useState(false),[unlockBusy,setUnlockBusy]=useState(false);
 const [error,setError]=useState(''),[job,setJob]=useState<Job|null>(null),[id,setId]=useState('');
 const [progress,setProgress]=useState<Progress|null>(null),[history,setHistory]=useState<Installation[]>([]);
 const [revealEpoch,setRevealEpoch]=useState(0);
 const reservation=useRef<{signature:string;key:string}|null>(null);
 const running=Boolean(job&&['queued','running'].includes(job.state));
 const actionBusy=busy||unlockBusy;
 useEffect(()=>{onBusy(actionBusy||running);return ()=>onBusy(false);},[actionBusy,running,onBusy]);
 async function refreshHistory(){setHistory((await api<{installations:Installation[]}>('/api/apps/soundwerks')).installations);}
 useEffect(()=>{void refreshHistory().catch(e=>setError(e.message));},[]);
 useEffect(()=>{
  if(!id||!job)return;
  let active=true;
  async function refresh(){
   try{
    const [j,p]=await Promise.all([api<{job:Job}>('/api/jobs/'+job!.id),
     api<{installation:Progress|null}>('/api/apps/soundwerks/'+id)]);
    if(active){setJob(j.job);setProgress(p.installation);setHistory(rows=>rows.map(row=>row.id===id?{...row,job:j.job}:row));}
   }catch(e){if(active)setError(e instanceof Error?e.message:'Installation status unavailable');}
  }
  void refresh();const timer=setInterval(()=>void refresh(),2500);
  return ()=>{active=false;clearInterval(timer);};
 },[id,job?.id]);
 async function install(){
  setBusy(true);setError('');setProgress(null);setRevealEpoch(n=>n+1);
  try{
   const metadata={title:title.trim(),email:email.trim(),adminUsername:adminUsername.trim(),
    ...(siteId?{siteId,expectedRevision}:{domain:domain?.trim().toLowerCase()})};
   const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(adminPassword))))
    .map(x=>x.toString(16).padStart(2,'0')).join('');
   const signature=JSON.stringify({...metadata,credentialDigest:hash});
   if(reservation.current?.signature!==signature)reservation.current={signature,key:crypto.randomUUID()};
   const data=await api<{job:Job;installationId:string}>('/api/apps/soundwerks/install',{
    ...metadata,confirmed,requestKey:reservation.current.key,adminPassword,
    adminPasswordConfirm:adminConfirm,password,mfaCode:mfaCode||undefined
   });
   setJob(data.job);setId(data.installationId);void refreshHistory().catch(()=>{});
  }catch(e){setError(e instanceof Error?e.message:'Installation request rejected. Inspect Activity & Jobs.');}
  finally{setPassword('');setMfaCode('');setAdminPassword('');setAdminConfirm('');setBusy(false);}
 }
 return <div className="managed-installer">
  <h3>Creative Soundwerks 2 · managed installer</h3>
  <p>DevOne installs required PostgreSQL and FFmpeg packages, creates an isolated Node.js 22 website and database,
   builds the reviewed Creative Soundwerks release under the website's Linux user, creates your first administrator,
   and checks that the application responds. No manual ZIP upload is necessary.</p>
  <p className="ops-warning">Developer preview. Your domain must point to this server. Enable HTTPS from Websites & Files
   before signing into Creative Soundwerks or unlocking saved credentials. Media-heavy workloads need ample storage.</p>
  <div className="form-grid">
   <label>Platform name<input maxLength={90} value={title} disabled={actionBusy||running} onChange={e=>setTitle(e.target.value)}/></label>
   <label>Administrator email<input type="email" autoComplete="email" value={email} disabled={actionBusy||running} onChange={e=>setEmail(e.target.value)}/></label>
  </div>
  <AdminAccountFields username={adminUsername} password={adminPassword} confirm={adminConfirm}
   onUsername={setAdminUsername} onPassword={setAdminPassword} onConfirm={setAdminConfirm} disabled={actionBusy||running}/>
  <div className="installer-approval">
   <h4>DevOne Owner approval</h4>
   <p>Your DevOne Server password authorizes the host changes. It is separate from the Creative Soundwerks account.</p>
   <label>DevOne Owner password<input type="password" autoComplete="section-panel current-password" value={password}
    disabled={actionBusy||running} onChange={e=>setPassword(e.target.value)}/></label>
   <label>MFA code, if enabled<input inputMode="numeric" autoComplete="one-time-code" value={mfaCode}
    disabled={actionBusy||running} onChange={e=>setMfaCode(e.target.value)}/></label>
   <label><input type="checkbox" checked={confirmed} disabled={actionBusy||running}
    onChange={e=>setConfirmed(e.target.checked)}/> I approve installing verified Ubuntu prerequisites, creating a private PostgreSQL account,
    and deploying Creative Soundwerks to {siteId?'this empty Node.js website':domain||'a new domain'}.</label>
  </div>
  <button className="primary-button" disabled={actionBusy||running||!confirmed||!password||!title.trim()||!email.trim()||
   !adminAccountReady(adminUsername,adminPassword,adminConfirm)||(!siteId&&!domain?.trim())}
   onClick={()=>void install()}>{actionBusy||running?'Installing…':'Install Creative Soundwerks'}</button>
  {job&&<section className="installer-progress" aria-label="Creative Soundwerks installation progress">
   <div className="installer-section-heading"><div><span className="overline">INSTALLATION STATUS</span>
    <h3>{stages[progress?.stage??job.state]??job.state}</h3>
    {progress&&<p>{progress.domain} · {progress.state}</p>}
   </div><span className={'state-chip '+(job.state==='succeeded'?'good':job.state==='failed'?'bad':'neutral')}>{job.state}</span></div>
   <p className="installer-job-id">Job: {job.id}</p>
   {job.error&&<p className="inline-error" role="alert">{installationErrorMessage(job.error)}</p>}
  </section>}
  {!busy&&job?.state==='succeeded'&&<CredentialReveal key={id+':'+revealEpoch}
   product="soundwerks" installationId={id} domain={progress?.domain} tls={progress?.tls} onBusy={setUnlockBusy}/>}
  {history.length>0&&<details className="installer-history"><summary>Recent Creative Soundwerks installations</summary>
   {history.map(h=><div className="installer-history-row" key={h.id}>{h.title} · {h.domain??h.id} · {h.job?.state??'reserved'}
    {h.job&&<button disabled={actionBusy||running} onClick={()=>{
     setId(h.id);setJob(h.job);setProgress(null);setRevealEpoch(n=>n+1);
    }}>View installation</button>}
    {h.job?.state==='succeeded'&&<SoundwerksUpdates installationId={h.id}/>}
   </div>)}
  </details>}
  {error&&<p role="alert" className="inline-error">{installationErrorMessage(error)}</p>}
 </div>;
}
