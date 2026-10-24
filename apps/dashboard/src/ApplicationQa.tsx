import {useEffect,useState} from 'react';
type Installed={siteId:string;domain:string;appId:string;version:string;state:string;stage:string;tls:boolean};
type Report={siteId:string;domain:string;state:string;checkedAt:string;notice:string;checks:{name:string;status:string;detail:string}[];pending:string[]};
export function ApplicationQa(){
 const [apps,setApps]=useState<Installed[]>([]),[selected,setSelected]=useState(''),[report,setReport]=useState<Report|null>(null);
 const [busy,setBusy]=useState(false),[loading,setLoading]=useState(true),[error,setError]=useState('');
 async function refresh(){
  setLoading(true);setError('');
  try{const r=await fetch('/api/qa/applications',{credentials:'same-origin',cache:'no-store'});if(!r.ok)throw Error('Could not load managed applications.');const b=await r.json() as {applications:Installed[]};setApps(b.applications);setSelected(previous=>b.applications.some(a=>a.siteId===previous)?previous:b.applications[0]?.siteId??'');setReport(null);}
  catch(e){setError(e instanceof Error?e.message:'Application list unavailable.');}finally{setLoading(false);}
 }
 useEffect(()=>{void refresh();},[]);
 async function check(){
  setBusy(true);setError('');setReport(null);
  try{const r=await fetch('/api/qa/applications/check',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({siteId:selected})});const b=await r.json();if(!r.ok)throw Error(b.error??'Application checks unavailable.');setReport(b as Report);}
  catch(e){setError(e instanceof Error?e.message:'Application checks failed.');}finally{setBusy(false);}
 }
 return <article className="surface-card glass ops-panel-gap" aria-label="Installed application checks">
  <div className="section-heading"><div><span className="overline">WORDPRESS & DEVONE CMS</span><h2>Installed application checks</h2><p>Check an app on this server after installing it through Websites & files → Install an app.</p></div><button className="primary-button" disabled={loading||busy} onClick={()=>void refresh()}>Refresh apps</button></div>
  <p className="ops-note">Checks availability, app identity and private HTTP paths. Enable HTTPS on the site for certificate and secure-routing checks. Apps, content and databases are kept. Administrator login, content changes and restore testing remain separate.</p>
  {error&&<p className="inline-error" role="alert">{error}</p>}
  {loading?<p className="ops-empty">Loading managed applications…</p>:apps.length?<div className="shield-form">
   <label className="shield-label">Installed application<select value={selected} disabled={busy} onChange={e=>{setSelected(e.target.value);setReport(null);}}>{apps.map(a=><option key={a.siteId} value={a.siteId}>{a.domain} · {a.appId==='wordpress'?'WordPress':'DevOne CMS preview'} {a.version} · {a.state}</option>)}</select></label>
   <button className="primary-button" disabled={busy||!selected} onClick={()=>void check()}>{busy?'Checking application…':'Run read-only app checks'}</button>
  </div>:<p className="ops-empty">No managed apps found. Install WordPress or DevOne CMS on a dedicated test domain, enable HTTPS, then refresh this list.</p>}
  {report&&<><p role="status" className="ops-subtext">{report.domain} · {report.state} · {new Date(report.checkedAt).toLocaleString()}</p><div className="ops-table-wrap"><table className="ops-table"><thead><tr><th>Check</th><th>Result</th><th>Verification</th></tr></thead><tbody>{report.checks.map(c=><tr key={c.name}><td><strong>{c.name}</strong></td><td><span className={'state-chip '+(c.status==='pass'?'good':c.status==='fail'?'bad':'neutral')}>{c.status}</span></td><td>{c.detail}</td></tr>)}</tbody></table></div><p className="ops-note">{report.notice}</p><p className="ops-subtext">Still required: {report.pending.join('; ')}. Results apply to this check and are cleared on refresh.</p></>}
 </article>;
}
