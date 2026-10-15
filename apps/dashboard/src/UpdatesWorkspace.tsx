import {useEffect,useState,type FormEvent} from "react";
type Gate={name:string;status:string;conclusion:string|null};
type UpdateRun={state:"queued"|"running"|"succeeded"|"failed";target:string;updatedAt:string};
type Status={currentSha:string;latestSha:string|null;updateAvailable:boolean;approved:boolean;checks:Gate[];checkedAt:string|null;workerInstalled:boolean;update:UpdateRun|null;error:string|null};
const short=(sha:string|null)=>sha?sha.slice(0,10):"Unavailable";
function problem(code:string){
 return ({
  update_worker_missing:"Update worker is not installed. Install this release once using the in-place updater.",
  release_checks_not_passed:"This GitHub commit has not passed both required CI jobs.",
  update_busy:"An update is already running. Wait for it to finish.",
  update_target_changed:"The latest GitHub commit changed. Check for updates again.",
  owner_password_invalid:"Owner password is incorrect.",
  update_auth_rate_limited:"Too many password attempts. Try again after a minute.",
  github_rate_limited:"GitHub API rate limit reached. Try again later.",
  github_unavailable:"GitHub could not be reached from the server.",
  update_result_requires_inspection:"The request may have started. Refresh status before retrying."
 } as Record<string,string>)[code]??"Update request could not be completed. ("+code+")";
}
export function UpdatesWorkspace({onDashboard}:{onDashboard?:()=>void}){
 const [state,setState]=useState<Status|null>(null),[loading,setLoading]=useState(true);
 const [checking,setChecking]=useState(false),[sending,setSending]=useState(false);
 const [approved,setApproved]=useState(false),[password,setPassword]=useState("");
 const [error,setError]=useState(""),[message,setMessage]=useState("");
 const refresh=async(show=false)=>{
  if(show)setChecking(true);
  try{
   const res=await fetch("/api/updates",{credentials:"same-origin",cache:"no-store"});
   const data=await res.json().catch(()=>({})) as Partial<Status>&{error?:string|null};
   if(!res.ok)throw Error(problem(data.error??"update_status_unavailable"));
   setState(data as Status);setError("");
  }catch(e){
   setError(e instanceof Error?e.message:"Update status unavailable.");
  }finally{setLoading(false);if(show)setChecking(false);}
 };
 useEffect(()=>{
  void refresh();
  const id=setInterval(()=>{void refresh();},10000);
  return()=>clearInterval(id);
 },[]);
 const isRunning=state?.update?.state==="queued"||state?.update?.state==="running";
 const canInstall=!!state?.updateAvailable&&!!state?.approved&&!!state?.workerInstalled&&!isRunning&&!sending;
 async function submit(e:FormEvent){
  e.preventDefault();
  if(!state?.latestSha||!canInstall||!approved)return;
  if(!window.confirm("Install verified DevOne commit "+short(state.latestSha)+"? This will briefly restart the control panel and Agent. Backups and rollback are attempted automatically."))return;
  setSending(true);setMessage("");setError("");
  const target=state.latestSha;
  try{
   const res=await fetch("/api/updates/apply",{method:"POST",credentials:"same-origin",headers:{"Content-Type":"application/json"},body:JSON.stringify({targetSha:target,password,confirmed:true})});
   const result=await res.json().catch(()=>({})) as {error?:string};
   if(!res.ok)throw Error(problem(result.error??"update_failed"));
   setMessage("Update accepted. The panel will briefly disconnect. Keep this page open to watch the result.");
   setPassword("");setApproved(false);
   void refresh();
  }catch(e){setError(e instanceof Error?e.message:"Update not started. Check status before retrying.");}
  finally{setSending(false);}
 }
 return <section className="updates-workspace">
  <div className="page-heading"><span className="overline">DEVONE RELEASE MANAGEMENT</span><h1>Software Updates</h1><p>Check the official DevOne Server repository, review automated QA and update your panel without SSH.</p></div>
  {error&&<p role="alert" className="inline-error">{error}</p>}
  {message&&<p role="status" className="inline-notice">{message}</p>}
  <div className="update-overview">
   <article className="surface-card glass"><div className="update-stat"><span>Currently installed</span><strong>{short(state?.currentSha??null)}</strong><small>{state?.currentSha??"Reading server revision…"}</small></div></article>
   <article className="surface-card glass"><div className="update-stat"><span>Latest GitHub main</span><strong>{short(state?.latestSha??null)}</strong><small>{state?.latestSha??(state?.error??"Checking for releases…")}</small></div></article>
   <article className="surface-card glass"><div className="update-stat"><span>Update status</span><strong>{loading?"Checking…":isRunning?"Updating…":state?.updateAvailable?"Available":"Current"}</strong><small>{state?.checkedAt?"Checked "+new Date(state.checkedAt).toLocaleString():"Live comparison pending"}</small></div></article>
  </div>
  <article className="surface-card glass update-panel">
   <div className="section-heading"><div><h2>Release verification</h2><p>Only the official main branch, with both required GitHub Actions checks passed, is eligible.</p></div><button className="primary-button" disabled={checking||sending} onClick={()=>void refresh(true)}>{checking?"Checking…":"Check for Updates"}</button></div>
   <div className="update-gates">{["validate","installer"].map(name=>{
     const gate=state?.checks.find(c=>c.name===name);const ok=gate?.status==="completed"&&gate.conclusion==="success";
     return <div key={name} className="update-gate"><span>{name==="validate"?"Build and regression QA":"Installer validation"}</span><strong className={ok?"passed":"pending"}>{gate?(ok?"Passed":gate.status==="in_progress"?"Running":gate.conclusion??"Pending"):"Not verified"}</strong></div>;
   })}</div>
   {state?.updateAvailable&&!state.approved&&<p className="ops-warning">A newer commit exists, but both required CI checks must pass before DevOne will install it.</p>}
   {!state?.workerInstalled&&state&&<p className="ops-warning">Dashboard updates are not yet enabled on this host. One in-place SSH update is needed to install the root-owned worker.</p>}
   {state?.approved&&state?.updateAvailable&&<p className="ops-note">This release passed the checked build and installer workflows. That does not replace full production acceptance or complete legacy feature parity.</p>}
   {state?.error&&<p className="ops-warning">GitHub verification unavailable: {problem(state.error)}</p>}
  </article>
  <article className="surface-card glass update-panel">
   <div className="section-heading"><div><h2>Install verified update</h2><p>Owner confirmation is required. The update uses the same rollback-aware installer that was verified on your VPS.</p></div></div>
   {isRunning?<div className="update-progress"><span className="update-spinner" aria-hidden="true"/><div><strong>{state?.update?.state==="queued"?"Update queued":"Installing update"}</strong><p>The panel may briefly disconnect. Do not start another update or restart services manually.</p></div></div>:
    <form className="update-install-form" onSubmit={e=>void submit(e)}>
      <div className="update-preflight"><span>1. Root-owned worker {state?.workerInstalled?"ready":"not installed"}</span><span>2. Both CI checks {state?.approved?"passed":"not passed"}</span><span>3. Update target {short(state?.latestSha??null)}</span></div>
      <label htmlFor="update-password">Confirm with your Owner password</label>
      <input id="update-password" type="password" autoComplete="current-password" maxLength={1024} disabled={!canInstall} value={password} onChange={e=>setPassword(e.target.value)} placeholder="Enter your existing Owner password" />
      <label className="update-confirm"><input type="checkbox" checked={approved} disabled={!canInstall} onChange={e=>setApproved(e.target.checked)}/> I understand DevOne will briefly restart and the update may require rollback or operator inspection if it fails.</label>
      <button type="submit" className="primary-button" disabled={!canInstall||!approved||!password||sending}>{sending?"Requesting…":"Install Update"}</button>
    </form>}
   <p className="ops-note">Updates include a private SQLite backup, a permissions preflight, and health checks. They do not delete hosted websites or re-run the initial installer. A failed update can still require manual recovery.</p>
  </article>
  {state?.update&&<article className="surface-card glass update-panel"><h2>Last update attempt</h2><div className="update-run"><strong className={state.update.state==="succeeded"?"passed":state.update.state==="failed"?"failed":"pending"}>{state.update.state}</strong><span>{short(state.update.target)}</span><span>{new Date(state.update.updatedAt).toLocaleString()}</span></div>{state.update.state==="failed"&&<p className="ops-warning">Update failed. The updater attempted to restore previous application files. Verify the panel and host health before retrying.</p>}{state.update.state==="succeeded"&&<p className="inline-notice">Update succeeded. Refresh your browser to load the newest interface.</p>}</article>}
  {onDashboard&&<button className="ops-secondary" onClick={onDashboard}>Return to dashboard</button>}
 </section>;
}
