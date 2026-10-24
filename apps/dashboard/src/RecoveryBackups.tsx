import {useEffect,useRef,useState} from 'react';
type Bundle={id:string;createdAt:string;bytes:number;lastVerifiedAt:string|null};
export function RecoveryBackups(){
 const [bundles,setBundles]=useState<Bundle[]>([]),[selected,setSelected]=useState('');
 const [action,setAction]=useState<'create'|'verify'|'delete'>('create');
 const [password,setPassword]=useState(''),[mfa,setMfa]=useState(''),[passphrase,setPassphrase]=useState(''),[confirm,setConfirm]=useState('');
 const [approved,setApproved]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
 const [available,setAvailable]=useState(false);const active=useRef<AbortController|null>(null),mounted=useRef(true);
 async function refresh(signal?:AbortSignal){
  const response=await fetch('/api/backups/recovery',{credentials:'same-origin',cache:'no-store',redirect:'error',signal});
  if(!response.ok)throw Error(response.status===409?'Enable panel HTTPS to use encrypted recovery bundles.':'Recovery inventory could not load.');
  const result=await response.json() as {bundles:Bundle[]};if(mounted.current){setBundles(result.bundles);setAvailable(true);}
 }
 useEffect(()=>{
  mounted.current=true;const controller=new AbortController();void refresh(controller.signal).catch(e=>{if(mounted.current&&!controller.signal.aborted)setError(e instanceof Error?e.message:'Recovery unavailable.');});
  return()=>{mounted.current=false;controller.abort();active.current?.abort();};
 },[]);
 function choose(next:'create'|'verify'|'delete',id=''){
  if(busy)return;setAction(next);setSelected(id);setPassword('');setMfa('');setPassphrase('');setConfirm('');setApproved(false);setError('');setNotice('');
 }
 async function submit(event:React.FormEvent){
  event.preventDefault();if(busy||!available||!approved)return;
  if(action==='create'&&passphrase!==confirm){setError('Recovery passphrases must match.');return;}
  const controller=new AbortController();active.current=controller;const timeout=setTimeout(()=>controller.abort(),60000);
  setBusy(true);setError('');setNotice('');
  const payload={confirmed:true,password,...(mfa?{mfaCode:mfa}:{}),...(action!=='delete'?{passphrase}:{}),...(action==='create'?{passphraseConfirm:confirm}:{})};
  setPassword('');setMfa('');setPassphrase('');setConfirm('');setApproved(false);
  try{
   const url='/api/backups/recovery'+(action==='create'?'':'/'+selected+'/'+action);
   const response=await fetch(url,{method:'POST',credentials:'same-origin',cache:'no-store',redirect:'error',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload),signal:controller.signal});
   const result=await response.json() as {error?:string;id?:string;sha256?:string};
   if(!response.ok)throw Error(result.error==='recovery_verification_failed'?'Restore drill failed. Check the passphrase and bundle. The live panel was not restored.':result.error?.replaceAll('_',' ')??'Recovery operation failed.');
   if(!mounted.current)return;
   setNotice(action==='create'?'Encrypted bundle created. Download it and keep your recovery passphrase separately.':action==='verify'?'Restore drill passed: a separate copy opened successfully, encrypted vault/MFA records decrypted, sessions were removed and pending jobs were interrupted. Temporary restored files were deleted.':'Selected recovery bundle deleted.');
   if(action==='create'&&result.id)setSelected(result.id);
   await refresh(controller.signal);
  }catch(e){if(mounted.current)setError(controller.signal.aborted?'The request was interrupted. Refresh inventory before retrying; creation may have finished.':e instanceof Error?e.message:'Recovery operation failed.');}
  finally{clearTimeout(timeout);if(active.current===controller)active.current=null;if(mounted.current)setBusy(false);}
 }
 return <section className="surface-card glass recovery-workspace">
  <div className="section-heading"><div><span className="state-chip good">ENCRYPTED RECOVERY</span><h2>Protect your panel data</h2><p>Keep the control database and its vault key together in a passphrase-encrypted bundle.</p></div><button type="button" className="secondary-button" disabled={busy} onClick={()=>choose('create')}>New recovery bundle</button></div>
  <p className="ops-warning">This protects panel records and saved secrets. Website files, application databases, Agent registry, certificates and host configuration are excluded. A restore drill checks an isolated copy; it does not restore the live server.</p>
  <div className="recovery-layout"><div className="recovery-inventory"><h3>Saved recovery bundles</h3><p className="ops-note">Up to 10 bundles · 32 MiB control database limit. Download a copy to a separate device. Files stored only on this server cannot protect against losing it.</p>
   {!bundles.length&&<p className="ops-empty">No encrypted recovery bundles yet.</p>}
   {bundles.map(b=><article key={b.id} className={'recovery-item'+(selected===b.id?' selected':'')}><strong>{new Date(b.createdAt).toLocaleString()}</strong><small className="ops-subtext">{(b.bytes/1048576).toFixed(2)} MiB · {b.id}</small><small className="ops-subtext">{b.lastVerifiedAt?'Last restore drill passed '+new Date(b.lastVerifiedAt).toLocaleString():'Restore drill not yet passed'}</small><div className="recovery-item-actions"><a className="ops-download" href={'/api/backups/recovery/'+b.id+'/download'}>Download encrypted bundle</a><button type="button" disabled={busy} onClick={()=>choose('verify',b.id)}>Test restore</button><button type="button" disabled={busy} onClick={()=>choose('delete',b.id)}>Delete</button></div></article>)}
  </div><form className="recovery-form" onSubmit={event=>void submit(event)}>
   <h3>{action==='create'?'Create encrypted recovery bundle':action==='verify'?'Test a separate restored copy':'Delete saved recovery bundle'}</h3>
   {selected&&action!=='create'&&<p className="ops-subtext">Selected bundle: {selected}</p>}
   {action!=='delete'&&<><label>Recovery passphrase<input type="password" autoComplete="new-password" required minLength={16} maxLength={128} disabled={busy} value={passphrase} onChange={e=>setPassphrase(e.target.value)}/></label><p className="ops-note">{action==='create'?'Choose a separate passphrase of 16–128 characters. DevOne does not save it and cannot recover it for you.':'Enter the passphrase chosen when this bundle was created.'}</p></>}
   {action==='create'&&<label>Confirm recovery passphrase<input type="password" autoComplete="new-password" required minLength={16} maxLength={128} disabled={busy} value={confirm} onChange={e=>setConfirm(e.target.value)}/></label>}
   <div className="installer-approval"><strong>Approve with your panel account</strong><label>Panel Owner password<input type="password" autoComplete="current-password" required maxLength={1024} disabled={busy} value={password} onChange={e=>setPassword(e.target.value)}/></label><label>MFA or recovery code, if enabled<input type="text" autoComplete="one-time-code" maxLength={64} disabled={busy} value={mfa} onChange={e=>setMfa(e.target.value)}/></label></div>
   <label className="recovery-confirm"><input type="checkbox" required checked={approved} disabled={busy} onChange={e=>setApproved(e.target.checked)}/><span>{action==='create'?'I will save the passphrase separately and understand the recovery scope.':action==='verify'?'Create, test and remove a temporary restored copy; leave the live panel running.':'Permanently delete this recovery bundle from this server.'}</span></label>
   <button className="primary-button" disabled={busy||!available}>{busy?'Working…':action==='create'?'Create encrypted bundle':action==='verify'?'Run restore drill':'Delete selected bundle'}</button>
  </form></div>
  {error&&<p className="ops-warning" role="alert">{error}</p>}{notice&&<p className="inline-notice" role="status">{notice}</p>}
  <p className="ops-note">Offline recovery: use the bundled scripts/control-recovery.mjs command and the recovery guide. It writes into a new private directory, invalidates sessions and interrupts pending jobs. Activation and host reconciliation require a separate recovery procedure.</p>
 </section>;
}
