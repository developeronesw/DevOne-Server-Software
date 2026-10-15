import {useEffect,useState} from "react";
type Status={enabled:boolean;pending:boolean;remainingRecoveryCodes:number};
type Enrollment={manualKey:string;otpauthUrl:string;expiresInSeconds:number};
async function call<T>(path:string,method:"GET"|"POST"="GET",body?:unknown):Promise<T>{
 const response=await fetch(path,{method,credentials:"same-origin",cache:"no-store",headers:method==="POST"?{"Content-Type":"application/json"}:undefined,body:method==="POST"?JSON.stringify(body):undefined});
 const result=await response.json().catch(()=>({})) as T & {error?:string};
 if(!response.ok)throw Error(result.error??"Request failed");
 return result;
}
export function OwnerMfaSettings({role}:{role:string}){
 const [status,setStatus]=useState<Status|null>(null),[enrollment,setEnrollment]=useState<Enrollment|null>(null);
 const [codes,setCodes]=useState<string[]>([]);
 const [password,setPassword]=useState(""),[code,setCode]=useState("");
 const [busy,setBusy]=useState(false),[error,setError]=useState(""),[notice,setNotice]=useState("");
 async function refresh(){setStatus(await call<Status>("/api/auth/mfa/status"));}
 useEffect(()=>{if(role==="owner")void refresh().catch(()=>setError("MFA status unavailable"));},[role]);
 async function begin(){
  setBusy(true);setError("");setNotice("");
  try{setEnrollment(await call<Enrollment>("/api/auth/mfa/begin","POST",{password}));setPassword("");setCodes([]);setCode("");}
  catch(e){setError(e instanceof Error?e.message:"MFA setup failed");}finally{setBusy(false);}
 }
 async function confirm(){
  setBusy(true);setError("");
  try{
   const result=await call<{enabled:boolean;recoveryCodes:string[]}>("/api/auth/mfa/confirm","POST",{code});
   setCodes(result.recoveryCodes);setEnrollment(null);setCode("");setNotice("Authenticator MFA enabled. Save recovery codes now; DevOne will not display them again.");
   await refresh();
  }catch(e){setError(e instanceof Error?e.message:"Invalid verification code");}finally{setBusy(false);}
 }
 async function disable(){
  if(!window.confirm("Disable your Owner account's authenticator MFA? All previous login sessions will be revoked."))return;
  setBusy(true);setError("");
  try{await call("/api/auth/mfa/disable","POST",{password,code});setPassword("");setCode("");setEnrollment(null);setCodes([]);setNotice("MFA disabled. Your session was rotated.");await refresh();}
  catch(e){setError(e instanceof Error?e.message:"Could not disable MFA");}finally{setBusy(false);}
 }
 if(role!=="owner")return null;
 return <article className="surface-card glass mfa-panel"><div className="section-heading"><div><h2>Owner authenticator MFA</h2><p>Require a time-based code or a one-time recovery code after your password.</p></div><span className={"state-chip "+(status?.enabled?"good":"neutral")}>{status?.enabled?"Enabled":"Not enabled"}</span></div>
 <p className="ops-note">Use a compatible authenticator app. The authenticator key is encrypted in the DevOne database; backup codes are stored as one-way hashes. Enable MFA only after confirming your server backups are secure.</p>
 {!status?.enabled&&!enrollment&&!codes.length&&<><label htmlFor="mfa-enroll-password" className="shield-label">Re-enter Owner password</label><input id="mfa-enroll-password" type="password" autoComplete="current-password" value={password} onChange={e=>setPassword(e.target.value)} maxLength={1024}/><div><button className="primary-button" disabled={busy||!password} onClick={()=>void begin()}>{busy?"Preparing…":"Set up MFA"}</button></div></>}
 {enrollment&&<div className="mfa-setup"><h3>Connect an authenticator app</h3><p>Choose “Enter setup key” in your authenticator. The key expires as a setup session after 10 minutes.</p><div className="mfa-code-key">{enrollment.manualKey}<button onClick={()=>void navigator.clipboard.writeText(enrollment.manualKey)}>Copy</button></div><p className="ops-note">Alternatively use the authenticator's import-by-URI option. Never share this key or a screenshot of it.</p><label htmlFor="mfa-setup-code" className="shield-label">Enter the six-digit code from your authenticator</label><input id="mfa-setup-code" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={e=>setCode(e.target.value)}/><button className="primary-button" disabled={busy||!/^[0-9]{6}$/.test(code)} onClick={()=>void confirm()}>{busy?"Verifying…":"Verify and enable MFA"}</button></div>}
 {codes.length>0&&<div className="mfa-recovery"><h3>Save these recovery codes now</h3><p>These one-time codes are shown only once. Store them offline in a secure password manager. Each code can replace one authenticator code at login.</p><div className="mfa-codes">{codes.map(c=><code key={c}>{c}</code>)}</div><button onClick={()=>{void navigator.clipboard.writeText(codes.join("\n"));}}>Copy recovery codes</button><button className="ops-secondary" onClick={()=>{if(window.confirm("Have you securely saved all recovery codes? They will not be shown again."))setCodes([]);}}>I saved my codes</button></div>}
 {status?.enabled&&!codes.length&&<div className="mfa-disable"><p className="ops-subtext">{status.remainingRecoveryCodes} unused recovery codes remain. Disabling requires your password and a current authenticator/recovery code.</p><div className="mfa-fields"><label>Owner password<input type="password" autoComplete="current-password" value={password} onChange={e=>setPassword(e.target.value)}/></label><label>Current MFA or recovery code<input autoComplete="one-time-code" value={code} onChange={e=>setCode(e.target.value)}/></label></div><button className="ops-secondary" disabled={busy||!password||!code} onClick={()=>void disable()}>Disable MFA</button></div>}
 {error&&<p role="alert" className="inline-error">{error}</p>}{notice&&<p role="status" className="inline-notice">{notice}</p>}
 </article>;
}
