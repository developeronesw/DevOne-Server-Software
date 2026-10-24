import { useEffect, useState, type FormEvent } from 'react';
import { CodeStudio } from './CodeStudio';
type Site = {id:string;domain:string;user:string;webServer:string;siteType?:string;state:string;aliases?:string[];revision?:number;tls?:boolean;runtimeVersion?:string;appActive?:boolean;application?:{appId:string;version:string}};
type Preset={id:string;label:string;description:string;webServers:string[];versions:string[];runtime:string|null;root:string;available:boolean;reason?:string;initialContent:"empty"};
type PresetReply={presets:Preset[];defaultPreset:string;initialContent:string};
type Entry = {name:string;kind:'file'|'directory'|'blocked'};
async function api(path:string,body?:unknown) {
  const response = await fetch(path,body === undefined ? undefined : {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  const result = await response.json();
  if (!response.ok) throw new Error(result.error === 'file_conflict' ? 'File changed since you opened it. Keep your draft, then reopen the file to review the changes.' : result.error === 'destination_exists' ? 'That destination already exists. Choose another name.' : result.error ?? 'Request failed');
  return result;
}
async function waitForJob(id:string) {
  const deadline=Date.now()+300000;
  while(Date.now()<deadline) {
    const {job}=await api(`/api/jobs/${encodeURIComponent(id)}`);
    if(job.state === 'succeeded') return;
    if(['failed','interrupted'].includes(job.state)) throw new Error(`Operation ${job.state}: ${job.error??'see Activity & Jobs'}. ${['node_entry_missing','runtime_entry_missing'].includes(job.error??'')?'Upload the required entry file (Node: server.mjs, Python: app.py, Docker: index.html), then start the app.':'Review Recent jobs before retrying.'}`);
    await new Promise(resolve=>setTimeout(resolve,1000));
  }
  throw new Error('Operation is still pending. Check Recent jobs before requesting another change.');
}
function base64(bytes:Uint8Array) {
  let value = ''; for (let start = 0; start < bytes.length; start += 8192) value += String.fromCharCode(...bytes.subarray(start,start+8192));
  return btoa(value);
}
function HostingIcon({name}:{name:'globe'|'plus'|'folder'|'code'|'lock'|'arrow'|'server'|'search'|'more'}) {
 const paths={globe:<><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a19 19 0 0 1 0 18 19 19 0 0 1 0-18Z"/></>,plus:<path d="M12 5v14M5 12h14"/>,folder:<path d="M3 7a2 2 0 0 1 2-2h5l2 3h7a2 2 0 0 1 2 2v9H3Z"/>,code:<path d="m8 7-5 5 5 5m8-10 5 5-5 5m-3-13-2 16"/>,lock:<><rect x="5" y="10" width="14" height="11" rx="3"/><path d="M8 10V7a4 4 0 0 1 8 0v3m-4 5v2"/></>,arrow:<path d="M7 17 17 7M7 7h10v10"/>,server:<><rect x="3" y="3" width="18" height="7" rx="2"/><rect x="3" y="14" width="18" height="7" rx="2"/><path d="M7 6.5h.01M7 17.5h.01M11 6.5h6m-6 11h6"/></>,search:<><circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/></>,more:<><circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/></>};
 return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>;
}
function runtimeLabel(site:Site){return site.siteType==='node'?'Node.js '+(site.runtimeVersion??'22'):site.siteType==='php'?'PHP '+(site.runtimeVersion??'8.3'):site.siteType==='python'?'Python '+(site.runtimeVersion??'3.12'):site.siteType==='container'?'Docker':site.siteType==='files'?'Files only':'Static HTML';}
function FileWorkspace({site}:{site:Site}) {
  const [path,setPath] = useState(''), [entries,setEntries] = useState<Entry[]>([]), [name,setName] = useState('');
  const [content,setContent] = useState(''), [preview,setPreview] = useState(''), [error,setError] = useState(''), [busy,setBusy] = useState(false);
  const [editor,setEditor] = useState<{path:string;revision:string;original:string;draft:string} | null>(null);
  const fullPath = (name:string) => path ? `${path}/${name}` : name;
  const request = (operation:string, extra:Record<string,unknown> = {}) => api('/api/sites/files',{siteId:site.id,operation,path,...extra});
  async function refresh() { const result = await request('list'); setEntries(result); }
  useEffect(() => {
    let active = true; setEntries([]); setPreview(''); setEditor(null); setError('');
    void request('list').then(result => { if (active) setEntries(result); }).catch(error => {if(active) setError(error.message);});
    return () => { active = false; };
  },[path,site.id]);
  async function act(work:()=>Promise<unknown>) {
    setBusy(true); setError('');
    try { await work(); await refresh(); } catch(error) { setError(error instanceof Error ? error.message : 'File operation failed'); }
    finally { setBusy(false); }
  }
  async function create(event:FormEvent,kind:'file'|'directory') {
    event.preventDefault();
    await act(() => request(kind === 'file' ? 'create' : 'mkdir',{path:fullPath(name),content:base64(new TextEncoder().encode(content)),confirmed:true}));
  }
  async function inspect(entry:Entry,download=false,edit=false) {
    await act(async () => {
      const result = await request('read',{path:fullPath(entry.name)});
      const bytes = Uint8Array.from(atob(result.content),character => character.charCodeAt(0));
      if (download) {
        const url = URL.createObjectURL(new Blob([bytes])); const anchor = document.createElement('a'); anchor.href = url; anchor.download = entry.name; anchor.click(); setTimeout(()=>URL.revokeObjectURL(url),10000);
      } else {
        try { const text = new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(bytes); if (edit && text.includes('\0')) throw new Error('binary'); if (edit) setEditor({path:fullPath(entry.name),revision:result.revision,original:text,draft:text}); else setPreview(text); }
        catch { if (edit) throw new Error('Binary files cannot be edited as text.'); setPreview('Binary file. Use Download to save it.'); }
      }
    });
  }
  async function saveEdit(event:FormEvent) {
    event.preventDefault(); if (!editor || !window.confirm(`Save changes to ${editor.path}?`)) return;
    const snapshot = editor;
    await act(async()=>{
      const bytes = new TextEncoder().encode(snapshot.draft);
      if (bytes.length > 1048576) throw new Error('File exceeds 1 MiB.');
      const result = await request('replace',{path:snapshot.path,content:base64(bytes),expectedRevision:snapshot.revision,confirmed:true});
      setEditor({...snapshot,revision:result.revision,original:snapshot.draft});
    });
  }
  async function renameEntry(entry:Entry) {
    const destination = window.prompt(`New relative path for ${fullPath(entry.name)}:`,fullPath(entry.name));
    if (!destination || destination === fullPath(entry.name)) return;
    if (!window.confirm(`Move ${fullPath(entry.name)} to ${destination}?`)) return;
    await act(async()=>{
      const current = await request('read',{path:fullPath(entry.name)});
      await request('rename',{path:fullPath(entry.name),destination,expectedRevision:current.revision,confirmed:true});
      setEditor(null);
    });
  }
  async function copyEntry(entry:Entry) {
    const from=fullPath(entry.name);
    const destination=window.prompt(`Copy ${from} to (new relative path):`,fullPath(`copy-${entry.name}`));
    if (!destination || destination === from) return;
    if (!window.confirm(`Copy ${from} to ${destination}? Existing files will not be overwritten.`)) return;
    await act(async()=>{
      const current=await request('read',{path:from});
      await request('copy',{path:from,destination,expectedRevision:current.revision,confirmed:true});
    });
  }
  function navigate(next:string) {
    if (editor && editor.draft !== editor.original && !window.confirm('Discard unsaved edits?')) return;
    setPath(next);
  }
  return <section className="file-workspace"><h4>Files · {site.domain}</h4><p>/{path} <button disabled={busy || !path} onClick={()=>navigate(path.split('/').slice(0,-1).join('/'))}>Parent folder</button> <button disabled={busy} onClick={()=>void act(refresh)}>Refresh</button></p>{error && <p role="alert">{error}</p>}<table><thead><tr><th>Name</th><th>Type</th><th>Actions</th></tr></thead><tbody>{entries.map(entry=><tr key={entry.name}><td>{entry.name}</td><td>{entry.kind}</td><td>{entry.kind === 'directory' && <button disabled={busy} onClick={()=>navigate(fullPath(entry.name))}>Open</button>}{entry.kind === 'file' && <><button disabled={busy} onClick={()=>void inspect(entry)}>Preview</button><button disabled={busy} onClick={()=>void inspect(entry,true)}>Download</button><button disabled={busy || !!editor} onClick={()=>void inspect(entry,false,true)}>Edit</button><button disabled={busy || !!editor} onClick={()=>void renameEntry(entry)}>Rename / move</button><button disabled={busy || !!editor} onClick={()=>void copyEntry(entry)}>Copy</button></>}{entry.kind !== 'blocked' && <button disabled={busy} onClick={()=>{if(window.confirm(`Delete ${fullPath(entry.name)}? Folders must be empty.`)) void act(()=>request('remove',{path:fullPath(entry.name),kind:entry.kind,confirmed:true}));}}>Delete</button>}</td></tr>)}</tbody></table>{!entries.length && <p>No entries loaded.</p>}{preview && <pre className="file-preview">{preview}</pre>}{editor && <form onSubmit={event=>void saveEdit(event)}><h4>Edit · {editor.path}</h4><label>File contents<textarea disabled={busy} value={editor.draft} onChange={event=>setEditor({...editor,draft:event.target.value})} /></label><button disabled={busy || editor.draft === editor.original}>Save changes</button><button type="button" disabled={busy} onClick={()=>{if(editor.draft === editor.original || window.confirm('Discard unsaved edits?')) setEditor(null);}}>Close editor</button></form>}<form onSubmit={event=>void create(event,'file')}><label>New name<input required value={name} onChange={event=>setName(event.target.value)} maxLength={255} pattern="[^/\\]+" /></label><label>New text file contents<textarea value={content} onChange={event=>setContent(event.target.value)} /></label><button disabled={busy}>Create text file</button><button type="button" disabled={busy || !name} onClick={event=>void create(event,'directory')}>Create folder</button></form><label>Upload a new file (maximum 1 MiB)<input type="file" disabled={busy} onChange={event=>{
    const file = event.target.files?.[0]; event.target.value = ''; if(!file) return;
    if(file.size > 1048576) {setError('File exceeds 1 MiB.');return;}
    void act(async()=>request('create',{path:fullPath(file.name),content:base64(new Uint8Array(await file.arrayBuffer())),confirmed:true}));
  }} /></label><p className="muted">Text edits check the version you opened. Moves never overwrite a destination. Stop external deployments or SFTP writes while editing. Symbolic links and special files are blocked.</p></section>;
}
export function SitesWorkspace() {
  const [search,setSearch]=useState(''),[showCreate,setShowCreate]=useState(false);
  const [sites,setSites] = useState<Site[]>([]), [selected,setSelected] = useState(''), [domain,setDomain] = useState('');
  const [webServer,setWebServer] = useState('nginx'), [presetId,setPresetId]=useState('static'), [runtimeVersion,setRuntimeVersion]=useState(''), [presets,setPresets]=useState<Preset[]>([]), [studioOpen,setStudioOpen]=useState(false), [busy,setBusy] = useState(false), [error,setError] = useState(''), [notice,setNotice] = useState('');
  async function refresh() {try {setSites((await api('/api/sites')).sites);setError('');} catch(error) {setError(error instanceof Error ? error.message : 'Sites unavailable');}}
  useEffect(()=>{void refresh();void fetch('/api/sites/presets',{credentials:'same-origin'}).then(r=>r.ok?r.json():null).then((data:PresetReply|null)=>{if(data?.presets)setPresets(data.presets);}).catch(()=>{});const timer=setInterval(()=>void refresh(),15000);return()=>clearInterval(timer);},[]);
  async function create(event:FormEvent) {
    event.preventDefault();
    setBusy(true);setError('');
    try {if(!currentPreset?.available)throw new Error('The selected hosting runtime is not available. Choose an enabled preset.');await api('/api/sites/preflight',{domain,webServer,siteType:presetId,runtimeVersion});if(!window.confirm(`Create ${domain} as an empty ${currentPreset.label} workspace with its own isolated Linux account? No starter code will be generated.`)) return;const {job}=await api('/api/sites',{domain,webServer,siteType:presetId,runtimeVersion,confirmed:true,requestKey:crypto.randomUUID()});setNotice(`Website creation queued: ${job.id}. Track its result in Recent jobs.`);setDomain('');await waitForJob(job.id);setNotice('Website created.');await refresh();}
    catch(error) {setError(error instanceof Error ? error.message : 'Creation failed');} finally {setBusy(false);}
  }
  async function siteAction(site:Site,action:string) {
    const input:Record<string,unknown>={siteId:site.id,action,expectedRevision:site.revision ?? 1,confirmed:true,requestKey:crypto.randomUUID()};
    if(action === 'update') {
      const domain=window.prompt('Primary domain:',site.domain);if(!domain) return;
      const aliases=window.prompt('Aliases/subdomains (comma separated, maximum 20):',(site.aliases ?? []).join(', '));if(aliases === null) return;
      input.domain=domain.trim();input.aliases=aliases.split(',').map(value=>value.trim()).filter(Boolean);
    }
    if(action === 'delete') {
      const typed=window.prompt(`Permanently delete ${site.domain}, its Linux account and all site files? Type ${site.domain} to confirm. Take a backup first.`);
      if(typed !== site.domain) return;input.confirmDomain=typed;
    } else if(!window.confirm(`${action} ${site.domain}?`)) return;
    setBusy(true);setError('');
    try {if(action === 'update') await api('/api/sites/preflight',{domain:input.domain,aliases:input.aliases,webServer:site.webServer,siteId:site.id,expectedRevision:site.revision ?? 1});const {job}=await api('/api/sites/action',input);setNotice(`Website operation queued: ${job.id}. Track its result in Recent jobs.`);if(action === 'delete') setSelected('');await waitForJob(job.id);setNotice(`Website ${action} completed.`);await refresh();}
    catch(error) {setError(error instanceof Error ? error.message : 'Site operation failed');}finally{setBusy(false);}
  }
  async function tlsAction(site:Site,action:string) {
    const input:Record<string,unknown>={siteId:site.id,action,expectedRevision:site.revision ?? 1,confirmed:true,requestKey:crypto.randomUUID()};
    if(action === 'issue') {
      const email=window.prompt('Certificate contact email:');if(!email) return;
      if(!window.confirm('Agree to the Let’s Encrypt Subscriber Agreement and request a certificate for the primary domain and aliases? DNS must point here and port 80 must be reachable.')) return;
      input.email=email;input.agreeTerms=true;
    } else if(!window.confirm(`${action} HTTPS for ${site.domain}?`)) return;
    setBusy(true);setError('');
    try {const {job}=await api('/api/sites/tls',input);setNotice(`Certificate operation queued: ${job.id}. Track its result in Recent jobs.`);await waitForJob(job.id);setNotice('Certificate operation completed.');await refresh();}
    catch(error){setError(error instanceof Error ? error.message : 'TLS operation failed');}finally{setBusy(false);}
  }
  const [certificate,setCertificate]=useState<{status:string;enabled:boolean;expiresAt:string|null;daysRemaining:number|null}|null>(null);
  useEffect(()=>{
    let active=true;setCertificate(null);
    if(selected) void api(`/api/sites/${encodeURIComponent(selected)}/tls/status`).then(result=>{if(active)setCertificate(result);}).catch(()=>{if(active)setCertificate({status:'unavailable',enabled:false,expiresAt:null,daysRemaining:null});});
    return ()=>{active=false;};
  },[selected,sites]);
  const site = sites.find(site=>site.id === selected);
  const currentPreset:Preset|undefined = presets.find(item=>item.id===presetId) ?? (presetId==='static'?{id:'static',label:'Static HTML / CSS / JavaScript',description:'Empty static NGINX website.',webServers:['nginx'],versions:[],runtime:null,root:'public',available:true,initialContent:'empty'}:undefined);
  const availableOptions = currentPreset?.webServers ?? ['nginx'];
  const visibleSites=sites.filter(item=>[item.domain,...(item.aliases??[]),runtimeLabel(item)].join(' ').toLowerCase().includes(search.toLowerCase()));
  return <div className="hosting-workspace" id="websites">
  <div className="hosting-overview">
   <div><span className="hosting-stat-icon violet"><HostingIcon name="globe"/></span><div><strong>{sites.length}</strong><span>Websites & workspaces</span></div></div>
   <div><span className="hosting-stat-icon green"><HostingIcon name="lock"/></span><div><strong>{sites.filter(s=>s.tls).length}<small> / {sites.filter(s=>s.webServer==='nginx').length}</small></strong><span>Websites with HTTPS enabled</span></div></div>
   <div><span className="hosting-stat-icon blue"><HostingIcon name="server"/></span><div><strong>{sites.filter(s=>s.appActive).length}</strong><span>Running Node, Python & Docker apps</span></div></div>
  </div>
  {error&&<p className="inline-error hosting-message" role="alert">{error}</p>}{notice&&<p className="inline-notice hosting-message" role="status">{notice}</p>}
  <section className="hosting-collection" aria-label="Your websites">
   <div className="hosting-section-heading"><div><span className="overline">YOUR HOSTING SPACE</span><h2>Your websites<span>{sites.length}</span></h2><p>A clear view of every project, from files to HTTPS.</p></div><button className="primary-button" disabled={busy} onClick={()=>setShowCreate(v=>!v)}><HostingIcon name="plus"/>{showCreate?'Close creation form':'New website'}</button></div>
   {sites.length>0&&<label className="hosting-search"><HostingIcon name="search"/><input type="search" aria-label="Search websites" placeholder="Search domains or runtimes…" value={search} onChange={e=>setSearch(e.target.value)}/><span>{visibleSites.length} {visibleSites.length===1?'project':'projects'}</span></label>}
   <div className="hosting-site-grid">{visibleSites.map(item=><article className={'hosting-site-card'+(item.id===selected?' selected':'')} key={item.id}>
    <div className="hosting-site-top"><span className="hosting-domain-icon"><HostingIcon name={item.siteType==='files'?'folder':'globe'}/></span><span className={'state-chip '+(item.state==='ready'?'good':item.state==='needs_inspection'?'bad':'neutral')}>{item.state==='ready'?'Ready':item.state==='needs_inspection'?'Needs inspection':item.state.charAt(0).toUpperCase()+item.state.slice(1)}</span></div>
    <h3>{item.domain}</h3><p className="hosting-site-runtime">{runtimeLabel(item)}<span>·</span>{item.webServer==='none'?'Private workspace':item.webServer.toUpperCase()}{item.application&&<><span>·</span>{item.application.appId==='wordpress'?'WordPress':'DevOne CMS preview'}</>}</p>
    {Boolean(item.aliases?.length)&&<p className="hosting-aliases">Aliases: {item.aliases!.join(', ')}</p>}
    <div className="hosting-site-signals">{item.webServer==='nginx'&&<span className={item.tls?'secure':'pending'}><HostingIcon name="lock"/>{item.tls?'HTTPS enabled':'HTTPS not configured'}</span>}{['node','python','container'].includes(item.siteType??'')&&<span className={item.appActive?'secure':'pending'}><i/>{item.appActive?'Application running':'Application stopped'}</span>}</div>
    <div className="hosting-site-primary"><button className="hosting-button emphasized" disabled={busy||!['ready','disabled'].includes(item.state)} onClick={()=>{setStudioOpen(false);setSelected(item.id);}}><HostingIcon name="folder"/>Manage files</button><button className="hosting-button" disabled={busy||!['ready','disabled'].includes(item.state)} onClick={()=>{setSelected(item.id);setStudioOpen(true);}}><HostingIcon name="code"/>Code Studio</button>{item.webServer==='nginx'&&item.state==='ready'&&<a className="hosting-visit" href={(item.tls?'https':'http')+'://'+item.domain} target="_blank" rel="noopener noreferrer" aria-label={'Visit '+item.domain+(item.tls?' over HTTPS':' over HTTP')}>Visit<HostingIcon name="arrow"/></a>}</div>
    <div className="hosting-site-footer"><span>{item.webServer==='nginx'?(item.tls?'HTTPS routing configured':'Enable HTTPS before sharing your site'):'Private files · no public web server'}</span>
     {['ready','disabled'].includes(item.state)&&<details className="hosting-actions"><summary><HostingIcon name="more"/>Actions<span className="hosting-sr-only"> for {item.domain}</span></summary><div className="hosting-actions-menu"><button disabled={busy} onClick={()=>void siteAction(item,'update')}>Edit domains & aliases</button>{['node','python','container'].includes(item.siteType??'')&&item.state==='ready'&&<button disabled={busy} onClick={()=>void siteAction(item,item.appActive?'stop':'start')}>{item.appActive?'Stop application':'Start application'}</button>}{item.webServer==='nginx'&&item.state==='ready'&&<><button disabled={busy} onClick={()=>void tlsAction(item,item.tls?'renew':'issue')}>{item.tls?'Check certificate renewal':'Enable HTTPS'}</button>{item.tls&&<button disabled={busy} onClick={()=>void tlsAction(item,'disable')}>Disable HTTPS</button>}</>}<button disabled={busy} onClick={()=>void siteAction(item,item.state==='ready'?'disable':'enable')}>{item.state==='ready'?'Disable website':'Enable website'}</button><button className="danger" disabled={busy} onClick={()=>void siteAction(item,'delete')}>Delete website</button></div></details>}
    </div>
   </article>)}</div>
   {!visibleSites.length&&<div className="hosting-empty"><span className="hosting-domain-icon"><HostingIcon name="globe"/></span><h3>{sites.length?'No matching websites':'A home for your next project'}</h3><p>{sites.length?'Try another domain or runtime name.':'Create an empty website environment, then upload your files or install an app from Apps & Runtimes.'}</p></div>}
  </section>
  {showCreate&&<section className="surface-card glass hosting-create" aria-label="Create a website"><div className="hosting-section-heading"><div><span className="overline">A FRESH START</span><h2>Create a website</h2><p>Choose your domain and runtime. Your files stay isolated in their own workspace.</p></div><span className="hosting-form-step">Empty workspace</span></div>
  <form className="website-preset-form" onSubmit={event=>void create(event)}>
    <label>Domain<input required value={domain} onChange={event=>setDomain(event.target.value)} placeholder="example.com" maxLength={253}/></label>
    <label>Website type<select aria-label="Website infrastructure preset" value={presetId} onChange={event=>{
       const id=event.target.value,chosen=presets.find(p=>p.id===id);setPresetId(id);
       setWebServer(chosen?.webServers[0]??(id==='files'?'none':'nginx'));
       setRuntimeVersion(chosen?.versions[0]??'');
    }}>{(presets.length?presets:[{id:'static',label:'Static HTML / CSS / JavaScript',available:true},{id:'files',label:'Files only',available:true}]).map(item=><option key={item.id} value={item.id}>{item.label}{item.available?' · Ready':' · Adapter required'}</option>)}</select></label>
    <label>Web server<select aria-label="Web server choice" value={webServer} onChange={event=>setWebServer(event.target.value)}>{availableOptions.map(value=><option key={value} value={value}>{({nginx:'NGINX',apache:'Apache HTTP Server',openlitespeed:'OpenLiteSpeed',litespeed:'LiteSpeed Enterprise',none:'None · private workspace'} as Record<string,string>)[value]??value}</option>)}</select></label>
    {currentPreset?.runtime&&<label>{currentPreset.runtime} version<select aria-label="Application runtime version" value={runtimeVersion} onChange={event=>setRuntimeVersion(event.target.value)}>{currentPreset.versions.map(version=><option key={version} value={version}>{version}</option>)}</select></label>}
    <div className="website-preset-summary"><strong>Your website environment</strong><p>{currentPreset?.description??'Select a website type.'}</p><dl><div><dt>Domain</dt><dd>{domain||'your-domain.example'}</dd></div><div><dt>Web server</dt><dd>{webServer}</dd></div><div><dt>Runtime</dt><dd>{currentPreset?.runtime ? currentPreset.runtime+' '+runtimeVersion:'None (static files)'}</dd></div><div><dt>Starting point</dt><dd>Empty workspace · ready for your files</dd></div></dl></div>
    {currentPreset&&!currentPreset.available&&<p className="ops-warning">Installation adapter not ready: {currentPreset.reason}. This adapter is unavailable; select an enabled runtime.</p>}
    <div className="hosting-create-footer"><p><HostingIcon name="lock"/>Dedicated Linux account · Isolated files</p><button className="primary-button" disabled={busy||!currentPreset?.available}><HostingIcon name="plus"/>{busy?'Working…':'Create website'}</button></div>
  </form></section>}
  {site&&<section className="hosting-selected surface-card glass"><div className="hosting-section-heading"><div><span className="overline">PROJECT WORKSPACE</span><h2>{site.domain}</h2><p>{runtimeLabel(site)} · {studioOpen?'Code Studio':'File manager'}</p></div><button className="hosting-button" disabled={busy||!['ready','disabled'].includes(site.state)} onClick={()=>setStudioOpen(v=>!v)}><HostingIcon name={studioOpen?'folder':'code'}/>{studioOpen?'File manager':'Code Studio'}</button></div>
  {site.webServer==='nginx'&&<p role="status" className="hosting-certificate"><HostingIcon name="lock"/>HTTPS {site.tls?'enabled':'not configured'}<span>·</span>{certificate?certificate.status+(certificate.expiresAt?' · Expires '+new Date(certificate.expiresAt).toLocaleDateString():''):'Checking certificate…'}</p>}
  {!site.application&&['node','python','container'].includes(site.siteType??'')&&<p className="ops-note">{site.siteType==='node'?'Upload server.mjs, then choose Start application. The managed service provides HOST and PORT.':site.siteType==='python'?'Upload app.py listening on the provided HOST and PORT, then choose Start application.':'Upload index.html, then choose Start application to launch the managed Docker web container.'}</p>}
  {site&&studioOpen&&<CodeStudio key={site.id} site={site} onClose={()=>setStudioOpen(false)}/>}
  {site && !studioOpen && <fieldset disabled={busy || !["ready","disabled"].includes(site.state)} style={{border:0,padding:0,margin:0}}><FileWorkspace key={site.id} site={site} /></fieldset>}</section>}<p className="hosting-footnote">Provisioning failures are preserved for inspection. <a href="https://letsencrypt.org/repository/" target="_blank" rel="noopener noreferrer">Certificate terms ↗</a></p></div>;
}
