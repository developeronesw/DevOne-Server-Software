import {useEffect,useRef,useState} from 'react';
type Database={id:string;siteId:string;engine:string;name:string;username:string;host:string;state:string;verifiedAt?:string};
type Site={id:string;domain:string;state:string};
type Job={id:string;state:string;error:string|null};
type Credentials={database:string;username:string;host:string;port:number;password:string};
async function api<T>(url:string,body?:unknown):Promise<T>{const r=await fetch(url,{credentials:'same-origin',cache:'no-store',...(body?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{})});const d=await r.json();if(!r.ok)throw Error(d.error??'Request failed');return d;}
export function DatabaseWorkspace({onApps}:{onApps:()=>void}){
 const [databases,setDatabases]=useState<Database[]|null>(null),[sites,setSites]=useState<Site[]>([]),[siteId,setSiteId]=useState(''),[engine,setEngine]=useState('mariadb'),[password,setPassword]=useState(''),[mfa,setMfa]=useState(''),[confirmed,setConfirmed]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(''),[job,setJob]=useState<Job|null>(null),[credentials,setCredentials]=useState<Credentials|null>(null),[visible,setVisible]=useState(false);
 const request=useRef<{target:string;key:string}|null>(null),lock=useRef(false);
 async function refresh(){const [d,s]=await Promise.all([api<{databases:Database[]}>('/api/databases'),api<{sites:Site[]}>('/api/sites')]);setDatabases(d.databases);setSites(s.sites);setSiteId(old=>old||s.sites.find(s=>s.state==='ready')?.id||'');}
 useEffect(()=>{void refresh().catch(e=>setError(e.message));},[]);
 useEffect(()=>{if(!credentials)return;const timer=setTimeout(()=>{setCredentials(null);setVisible(false);},60000);return ()=>clearTimeout(timer);},[credentials]);
 useEffect(()=>{
  if(!job||!['queued','running'].includes(job.state))return;
  let live=true;const timer=setInterval(()=>{void api<{job:Job}>('/api/jobs/'+job.id).then(d=>{if(live){setJob(d.job);if(!['queued','running'].includes(d.job.state))void refresh().catch(e=>setError(e.message));}}).catch(()=>{if(live)setError('Job status unavailable. Inspect Activity & jobs before retrying.');});},2500);return ()=>{live=false;clearInterval(timer);};
 },[job]);
 async function create(){
  if(lock.current)return;lock.current=true;setBusy(true);setError('');setCredentials(null);setVisible(false);
  const target=siteId+':'+engine;if(request.current?.target!==target)request.current={target,key:crypto.randomUUID()};
  try{const d=await api<{job:Job}>('/api/databases',{siteId,engine,confirmed:true,requestKey:request.current.key,password,mfaCode:mfa||undefined});setJob(d.job);}
  catch(e){setError((e instanceof Error?e.message:'Database request failed')+'. Check Activity & jobs before repeating.');}
  finally{setPassword('');setMfa('');setConfirmed(false);setBusy(false);lock.current=false;}
 }
 async function reveal(id:string){
  if(lock.current)return;lock.current=true;setBusy(true);setError('');setCredentials(null);setVisible(false);
  try{setCredentials(await api<Credentials>('/api/databases/'+id+'/credentials',{password,mfaCode:mfa||undefined,confirmed:true}));}
  catch(e){setError(e instanceof Error?e.message:'Credentials unavailable');}
  finally{setPassword('');setMfa('');setBusy(false);lock.current=false;}
 }
 const running=busy||Boolean(job&&['queued','running'].includes(job.state));
 return <section className="surface-card glass"><div className="section-heading"><div><span className="overline">MANAGED APPLICATION DATABASES</span><h2>A dedicated database for each application.</h2></div><button onClick={onApps}>Install database engines</button></div>
 <p>Create a MariaDB database with a localhost-only application account, or a PostgreSQL database with a restricted login role. DevOne generates the password, encrypts it in the vault, and verifies a login before reporting the database ready. Install the selected engine through Apps & runtimes first.</p>
 <div className="shield-form"><label className="shield-label">Website<select disabled={running} value={siteId} onChange={e=>setSiteId(e.target.value)}><option value="">Select a ready website</option>{sites.filter(s=>s.state==='ready').map(s=><option key={s.id} value={s.id}>{s.domain}</option>)}</select></label><label className="shield-label">Database engine<select disabled={running} value={engine} onChange={e=>setEngine(e.target.value)}><option value="mariadb">MariaDB</option><option value="postgresql">PostgreSQL</option></select></label>
 <label className="shield-label">Owner password<input type="password" autoComplete="current-password" value={password} onChange={e=>setPassword(e.target.value)}/></label><label className="shield-label">MFA code, if enabled<input autoComplete="one-time-code" maxLength={17} value={mfa} onChange={e=>setMfa(e.target.value)}/></label>
 <label className="shield-consent"><input type="checkbox" checked={confirmed} onChange={e=>setConfirmed(e.target.checked)}/> Create a database and application account on the selected engine for this website.</label><button className="primary-button" disabled={running||!siteId||!password||!confirmed||Boolean(job)} onClick={()=>void create()}>{running?'Provisioning…':'Create database & account'}</button>
 {job&&<p role="status">Job {job.id}: <strong>{job.state}</strong>{job.error?' — '+job.error+'. Inspect the engine and retained database record before recovery.':''}{job.state==='succeeded'?' — Credentials and connection verified.':''}</p>}
 {job?.state==='succeeded'&&<button onClick={()=>{setJob(null);request.current=null;}}>Create another database</button>}
 </div>
 <p className="ops-note">The Owner password/MFA fields above also authorize a credential reveal below. Passwords never appear in job history or AI prompts. Failed or interrupted provisioning is retained for inspection; DevOne does not automatically drop or overwrite database objects. Deleting a website does not delete its databases.</p>
 {error&&<p className="inline-error" role="alert">{error}</p>}
 {credentials&&<div className="ops-panel-gap"><h3>Application connection details</h3><p>Host: {credentials.host}:{credentials.port} · Database: {credentials.database} · User: {credentials.username}</p><label>Generated password <input readOnly type={visible?'text':'password'} value={credentials.password} autoComplete="off"/></label><button onClick={()=>setVisible(v=>!v)}>{visible?'Hide':'Show password'}</button><button onClick={()=>{setCredentials(null);setVisible(false);}}>Clear details</button><p className="ops-note">Details clear after 60 seconds or when you leave this page. Use them only in your application's protected configuration.</p></div>}
 <div className="ops-table-wrap"><table className="ops-table"><thead><tr><th>Database</th><th>Website</th><th>Engine / account</th><th>Provisioning</th><th>Credentials</th></tr></thead><tbody>{databases?.map(d=><tr key={d.id}><td><strong>{d.name}</strong><small className="ops-subtext">{d.id}</small></td><td>{sites.find(s=>s.id===d.siteId)?.domain??d.siteId}</td><td>{d.engine}<small className="ops-subtext">{d.username} · {d.host}</small></td><td>{d.state}<small className="ops-subtext">{d.verifiedAt?'Login verified '+new Date(d.verifiedAt).toLocaleString():'Not verified'}</small></td><td><button disabled={busy||!password||d.state!=='ready'} onClick={()=>void reveal(d.id)}>Reveal with Owner approval</button></td></tr>)}</tbody></table>{databases?.length===0&&<p>No managed application databases yet.</p>}{databases===null&&!error&&<p>Loading managed databases…</p>}</div><p className="ops-note">Database deletion, credential rotation, backup/restore and SQL administration are separate unfinished workflows. This list records the last verified provision, not continuous database health.</p>
 </section>;
}
