import { useEffect, useState, type FormEvent } from 'react';
type Site = {id:string;domain:string;user:string;webServer:string;state:string};
type Entry = {name:string;kind:'file'|'directory'|'blocked'};
async function api(path:string,body?:unknown) {
  const response = await fetch(path,body === undefined ? undefined : {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  const result = await response.json();
  if (!response.ok) throw new Error(result.error === 'file_conflict' ? 'File changed since you opened it. Keep your draft, then reopen the file to review the changes.' : result.error === 'destination_exists' ? 'That destination already exists. Choose another name.' : result.error ?? 'Request failed');
  return result;
}
function base64(bytes:Uint8Array) {
  let value = ''; for (let start = 0; start < bytes.length; start += 8192) value += String.fromCharCode(...bytes.subarray(start,start+8192));
  return btoa(value);
}
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
  function navigate(next:string) {
    if (editor && editor.draft !== editor.original && !window.confirm('Discard unsaved edits?')) return;
    setPath(next);
  }
  return <section className="file-workspace"><h4>Files · {site.domain}</h4><p>/{path} <button disabled={busy || !path} onClick={()=>navigate(path.split('/').slice(0,-1).join('/'))}>Parent folder</button> <button disabled={busy} onClick={()=>void act(refresh)}>Refresh</button></p>{error && <p role="alert">{error}</p>}<table><thead><tr><th>Name</th><th>Type</th><th>Actions</th></tr></thead><tbody>{entries.map(entry=><tr key={entry.name}><td>{entry.name}</td><td>{entry.kind}</td><td>{entry.kind === 'directory' && <button disabled={busy} onClick={()=>navigate(fullPath(entry.name))}>Open</button>}{entry.kind === 'file' && <><button disabled={busy} onClick={()=>void inspect(entry)}>Preview</button><button disabled={busy} onClick={()=>void inspect(entry,true)}>Download</button><button disabled={busy || !!editor} onClick={()=>void inspect(entry,false,true)}>Edit</button><button disabled={busy || !!editor} onClick={()=>void renameEntry(entry)}>Rename / move</button></>}{entry.kind !== 'blocked' && <button disabled={busy} onClick={()=>{if(window.confirm(`Delete ${fullPath(entry.name)}? Folders must be empty.`)) void act(()=>request('remove',{path:fullPath(entry.name),kind:entry.kind,confirmed:true}));}}>Delete</button>}</td></tr>)}</tbody></table>{!entries.length && <p>No entries loaded.</p>}{preview && <pre className="file-preview">{preview}</pre>}{editor && <form onSubmit={event=>void saveEdit(event)}><h4>Edit · {editor.path}</h4><label>File contents<textarea disabled={busy} value={editor.draft} onChange={event=>setEditor({...editor,draft:event.target.value})} /></label><button disabled={busy || editor.draft === editor.original}>Save changes</button><button type="button" disabled={busy} onClick={()=>{if(editor.draft === editor.original || window.confirm('Discard unsaved edits?')) setEditor(null);}}>Close editor</button></form>}<form onSubmit={event=>void create(event,'file')}><label>New name<input required value={name} onChange={event=>setName(event.target.value)} maxLength={255} pattern="[^/\\]+" /></label><label>New text file contents<textarea value={content} onChange={event=>setContent(event.target.value)} /></label><button disabled={busy}>Create text file</button><button type="button" disabled={busy || !name} onClick={event=>void create(event,'directory')}>Create folder</button></form><label>Upload a new file (maximum 1 MiB)<input type="file" disabled={busy} onChange={event=>{
    const file = event.target.files?.[0]; event.target.value = ''; if(!file) return;
    if(file.size > 1048576) {setError('File exceeds 1 MiB.');return;}
    void act(async()=>request('create',{path:fullPath(file.name),content:base64(new Uint8Array(await file.arrayBuffer())),confirmed:true}));
  }} /></label><p className="muted">Text edits check the version you opened. Moves never overwrite a destination. Stop external deployments or SFTP writes while editing. Symbolic links and special files are blocked.</p></section>;
}
export function SitesWorkspace() {
  const [sites,setSites] = useState<Site[]>([]), [selected,setSelected] = useState(''), [domain,setDomain] = useState('');
  const [webServer,setWebServer] = useState('nginx'), [busy,setBusy] = useState(false), [error,setError] = useState(''), [notice,setNotice] = useState('');
  async function refresh() {try {setSites((await api('/api/sites')).sites);setError('');} catch(error) {setError(error instanceof Error ? error.message : 'Sites unavailable');}}
  useEffect(()=>{void refresh();const timer=setInterval(()=>void refresh(),15000);return()=>clearInterval(timer);},[]);
  async function create(event:FormEvent) {
    event.preventDefault(); if(!window.confirm(`Create ${domain} with an isolated Linux account?`)) return;
    setBusy(true);setError('');
    try {const {job}=await api('/api/sites',{domain,webServer,confirmed:true,requestKey:crypto.randomUUID()});setNotice(`Website creation queued: ${job.id}. Track its result in Recent jobs.`);setDomain('');await refresh();}
    catch(error) {setError(error instanceof Error ? error.message : 'Creation failed');} finally {setBusy(false);}
  }
  const site = sites.find(site=>site.id === selected && site.state === 'ready');
  return <article className="card glass" id="websites"><h3>Websites and files</h3><p>Create an HTTP static website or an isolated file workspace. Runtime applications and site HTTPS are pending.</p>{error && <p role="alert">{error}</p>}{notice && <p role="status">{notice}</p>}<form onSubmit={event=>void create(event)}><label>Domain<input required value={domain} onChange={event=>setDomain(event.target.value)} placeholder="example.com" maxLength={253} /></label><label>Web server<select value={webServer} onChange={event=>setWebServer(event.target.value)}><option value="nginx">NGINX · static website</option><option value="none">Files only</option></select></label><button disabled={busy}>Create website</button></form><table><thead><tr><th>Domain</th><th>Status</th><th>Files</th></tr></thead><tbody>{sites.map(site=><tr key={site.id}><td>{site.domain}</td><td>{site.state}</td><td><button disabled={site.state !== 'ready'} onClick={()=>setSelected(site.id)}>Manage files</button></td></tr>)}</tbody></table>{site && <FileWorkspace key={site.id} site={site} />}<p className="muted">Provisioning failures require inspection. DevOne preserves partial resources for recovery.</p></article>;
}
