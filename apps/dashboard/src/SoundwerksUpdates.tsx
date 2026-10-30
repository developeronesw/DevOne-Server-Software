import {useEffect,useRef,useState} from 'react';
type Update={siteId:string;domain:string;state:string;revision:number;currentSha:string;
 latestSha:string;updateAvailable:boolean;approved:boolean;checks:string;workflowUrl:string|null};
type Job={id:string;state:string;error:string|null};
async function api<T>(url:string,body?:unknown):Promise<T>{
 const response=await fetch(url,{cache:'no-store',credentials:'same-origin',redirect:'error',
  ...(body?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{})});
 const data=await response.json();
 if(!response.ok)throw Error(data.error??'Request failed');
 return data;
}
const problems:Record<string,string>={
 soundwerks_update_rolled_back:'The new build failed after deployment began. The previous site and database were restored. Review the job before another attempt.',
 soundwerks_update_requires_inspection:'Automatic recovery could not be verified. The site and private backups are retained for administrator inspection.',
 soundwerks_update_build_failed:'The new source could not pass the build and TypeScript checks. Your running installation was left unchanged.',
 soundwerks_update_site_unavailable:'This installation is not ready for updating. Check Websites & Files and Activity & Jobs.',
 soundwerks_release_checks_not_passed:'The newest GitHub commit has not passed the required CI checks. Updating is blocked.',
 soundwerks_update_target_changed:'A newer commit appeared since you checked. Check for updates again.',
 soundwerks_already_current:'This installation already uses the newest approved GitHub revision.',
 soundwerks_update_check_unavailable:'DevOne could not verify the official GitHub main revision or its CI results.',
 owner_password_invalid:'The DevOne Owner password was not accepted.',
 owner_confirmation_required:'Enter your DevOne Owner password and MFA if enabled.'
};
export function SoundwerksUpdates({installationId}:{installationId:string}){
 const [details,setDetails]=useState<Update|null>(null);
 const [job,setJob]=useState<Job|null>(null);
 const [error,setError]=useState('');
 const [busy,setBusy]=useState(false);
 const [ownerPassword,setOwnerPassword]=useState('');
 const [mfaCode,setMfaCode]=useState('');
 const [confirmed,setConfirmed]=useState(false);
 const request=useRef<{sha:string;key:string}|null>(null);
 const running=Boolean(job&&['queued','running'].includes(job.state));
 async function check(){
  setBusy(true);setError('');
  try{
   const result=await api<{update:Update}>('/api/apps/soundwerks/'+installationId+'/updates');
   setDetails(result.update);
   if(!result.update.updateAvailable)request.current=null;
  }catch(e){setError(e instanceof Error?e.message:'Unable to check GitHub');}
  finally{setBusy(false);}
 }
 async function update(){
  if(!details)return;
  setBusy(true);setError('');
  try{
   if(request.current?.sha!==details.latestSha)request.current={sha:details.latestSha,key:crypto.randomUUID()};
   const result=await api<{job:Job}>('/api/apps/soundwerks/'+installationId+'/update',{
    targetSha:details.latestSha,requestKey:request.current.key,confirmed:true,
    password:ownerPassword,mfaCode:mfaCode||undefined
   });
   setJob(result.job);setConfirmed(false);
  }catch(e){setError(e instanceof Error?e.message:'Update request rejected');}
  finally{setBusy(false);setOwnerPassword('');setMfaCode('');}
 }
 useEffect(()=>{
  if(!job||!['queued','running'].includes(job.state))return;
  let active=true;
  const poll=()=>{
   void api<{job:Job}>('/api/jobs/'+job.id).then(result=>{
    if(!active)return;
    setJob(result.job);
    if(result.job.state==='succeeded')void check();
   }).catch(e=>{if(active)setError(e instanceof Error?e.message:'Job status unavailable');});
  };
  const timer=setInterval(poll,3000);
  return ()=>{active=false;clearInterval(timer);};
 },[job?.id,job?.state]);
 const canUpdate=details?.updateAvailable&&details.approved&&details.state==='ready'&&!running;
 return <section className="ops-note" aria-label="Creative Soundwerks GitHub updater">
  <div><strong>Official GitHub updates</strong>
   <p>Update this installed Creative Soundwerks site from the reviewed <code>main</code> branch.
    DevOne builds the new code separately, snapshots PostgreSQL, checks the new site, and
    attempts to restore the previous version if deployment fails.</p>
   <button type="button" disabled={busy||running} onClick={()=>void check()}>
    {busy?'Checking…':'Check for updates'}</button>
  </div>
  {details&&<div className="installer-progress">
   <p>Site: <strong>{details.domain}</strong> · {details.state}</p>
   <p>Installed source: <code>{details.currentSha.slice(0,12)}</code></p>
   <p>Official main: <code>{details.latestSha.slice(0,12)}</code> · CI: {details.checks}</p>
   {details.workflowUrl&&<a href={details.workflowUrl} target="_blank" rel="noopener noreferrer">View GitHub CI results</a>}
   {!details.updateAvailable?<p>Up to date with official main.</p>:
    !details.approved?<p className="ops-warning">Update unavailable until GitHub CI passes.</p>:
    details.state!=='ready'?<p className="ops-warning">Resolve the site's state before updating.</p>:
    <div className="installer-approval">
     <h4>Review and authorize the update</h4>
     <p>Expect a brief maintenance window while DevOne backs up and migrates PostgreSQL.
      The existing private media library and server credentials are not replaced.</p>
     <label>DevOne Owner password
      <input type="password" autoComplete="section-update current-password"
       value={ownerPassword} disabled={busy||running} onChange={e=>setOwnerPassword(e.target.value)}/></label>
     <label>MFA/recovery code, if enabled
      <input inputMode="numeric" autoComplete="one-time-code"
       value={mfaCode} disabled={busy||running} onChange={e=>setMfaCode(e.target.value)}/></label>
     <label><input type="checkbox" checked={confirmed}
      disabled={busy||running} onChange={e=>setConfirmed(e.target.checked)}/>
      I approve updating {details.domain} to the displayed CI-verified GitHub commit.</label>
     <button type="button" className="primary-button"
      disabled={!canUpdate||busy||!confirmed||!ownerPassword}
      onClick={()=>void update()}>{busy||running?'Update running…':'Update Creative Soundwerks'}</button>
    </div>}
  </div>}
  {job&&<p role="status">Update job: {job.id} — {job.state}
   {job.error&&' · '+(problems[job.error]??job.error)}</p>}
  {error&&<p role="alert" className="inline-error">{problems[error]??error}</p>}
 </section>;
}
