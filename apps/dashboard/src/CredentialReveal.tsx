import {useEffect,useRef,useState,type FormEvent} from 'react';
type Credentials={username:string;password:string;loginUrl:string};
const problems:Record<string,string>={owner_password_invalid:'That panel Owner password was not accepted.',mfa_required:'Enter your authenticator or recovery code.',mfa_invalid:'That authenticator or recovery code was not accepted.',cms_https_required:'Enable HTTPS for this website before revealing its login.',wordpress_https_required:'Enable HTTPS for this website before revealing its login.',cms_rate_limited:'Too many attempts. Wait a minute before trying again.',wordpress_rate_limited:'Too many attempts. Wait a minute before trying again.'};
export function CredentialReveal({product,installationId,domain,tls,onBusy}:{product:'devone-cms'|'wordpress';installationId:string;domain?:string;tls?:boolean;onBusy:(busy:boolean)=>void}){
 const [password,setPassword]=useState(''),[mfa,setMfa]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState(''),[credentials,setCredentials]=useState<Credentials|null>(null);
 const current=useRef<AbortController|null>(null);
 useEffect(()=>{setPassword('');setMfa('');setError('');setCredentials(null);setBusy(false);onBusy(false);return()=>{current.current?.abort();current.current=null;onBusy(false);};},[installationId,domain,onBusy]);
 useEffect(()=>{if(!credentials)return;const timer=setTimeout(()=>setCredentials(null),60000);return()=>clearTimeout(timer);},[credentials]);
 async function reveal(event:FormEvent){
  event.preventDefault();if(current.current||tls!==true||!password)return;
  const controller=new AbortController();current.current=controller;setBusy(true);onBusy(true);setError('');setCredentials(null);
  const timer=setTimeout(()=>controller.abort(),15000);
  try{
   const r=await fetch('/api/apps/'+product+'/'+encodeURIComponent(installationId)+'/credentials',{method:'POST',credentials:'same-origin',cache:'no-store',redirect:'error',headers:{'Content-Type':'application/json'},signal:controller.signal,body:JSON.stringify({confirmed:true,password,mfaCode:mfa||undefined})});
   const b=await r.json();if(!r.ok)throw Error(problems[b.error]??'The saved login could not be unlocked. Check the installation status and try again.');
   if(typeof b.username!=='string'||typeof b.password!=='string'||typeof b.loginUrl!=='string'||!b.loginUrl.startsWith('https://'))throw Error('The saved login response was incomplete.');
   if(current.current===controller&&!controller.signal.aborted)setCredentials(b as Credentials);
  }catch(e){if(current.current===controller)setError(controller.signal.aborted?'The request timed out. Please try again.':e instanceof Error?e.message:'The saved login could not be unlocked.');}
  finally{clearTimeout(timer);if(current.current===controller){current.current=null;setPassword('');setMfa('');setBusy(false);onBusy(false);}}
 }
 return <section className="credential-unlock" aria-label="Unlock saved application login">
  <div className="installer-section-heading"><span className="installer-section-icon" aria-hidden="true">↗</span><div><span className="overline">SAVED APPLICATION ACCOUNT</span><h3>Unlock saved login</h3><p>{domain??'Selected installation'} · {product==='wordpress'?'WordPress':'DevOne CMS'}</p></div><span className={'state-chip '+(tls===true?'good':'neutral')}>{tls===true?'HTTPS enabled':tls===false?'HTTPS required':'Checking HTTPS'}</span></div>
  <p>Enter the password you use to sign in to <strong>DevOne Server</strong>. This unlocks the website’s saved administrator login without reinstalling it.</p>
  {tls!==true&&<p className="ops-warning" role="status">{tls===false?'Enable HTTPS for this domain in Websites & Files, then return here.':'Checking this installation’s HTTPS status…'}</p>}
  <form className="credential-unlock-form" onSubmit={event=>void reveal(event)}>
   <label>Panel Owner password<input type="password" name="reveal-owner-password" autoComplete="section-reveal current-password" required maxLength={1024} disabled={busy||tls!==true} value={password} onChange={e=>setPassword(e.target.value)} placeholder="Your DevOne Server password"/></label>
   <label>MFA or recovery code <small>Only if enabled</small><input name="reveal-mfa" autoComplete="one-time-code" maxLength={17} disabled={busy||tls!==true} value={mfa} onChange={e=>setMfa(e.target.value)} placeholder="Authenticator or recovery code"/></label>
   <div className="credential-unlock-footer"><span>Fresh Owner verification is required for every reveal.</span><button type="submit" className="primary-button" disabled={busy||tls!==true}>{busy?'Unlocking…':'Reveal saved login'}</button></div>
  </form>
  {error&&<p className="inline-error" role="alert">{error}</p>}
  {credentials&&<div className="credential-result" role="status"><div className="installer-section-heading"><div><h4>Your application login</h4><p>Hidden automatically after 60 seconds.</p></div><button type="button" className="ops-secondary" onClick={()=>setCredentials(null)}>Hide credentials</button></div><dl><div><dt>Administrator username</dt><dd><code>{credentials.username}</code></dd></div><div><dt>Administrator password</dt><dd><code>{credentials.password}</code></dd></div></dl><a className="installer-login-link" href={credentials.loginUrl} target="_blank" rel="noopener noreferrer">Open {product==='wordpress'?'WordPress':'DevOne CMS'} login <span aria-hidden="true">↗</span></a><p className="ops-note">If you changed the password inside the app, this saved initial password may be outdated.</p></div>}
 </section>;
}
