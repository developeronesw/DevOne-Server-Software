import {useCallback,useEffect,useRef,useState,type KeyboardEvent} from "react";
type Site={id:string;domain:string};
type Entry={name:string;kind:"file"|"directory"|"blocked"};
type Doc={path:string;revision:string;original:string;draft:string};
type AiProvider={id:string;label:string;configured:boolean};
function encodeText(value:string){
 const bytes=new TextEncoder().encode(value);let binary="";
 for(let offset=0;offset<bytes.length;offset+=8192)binary+=String.fromCharCode(...bytes.subarray(offset,offset+8192));
 return btoa(binary);
}
function decodeText(value:string){
 const binary=atob(value);
 const bytes=Uint8Array.from(binary,c=>c.charCodeAt(0));
 const text=new TextDecoder("utf-8",{fatal:true,ignoreBOM:true}).decode(bytes);
 if(text.includes("\0"))throw Error("Binary data cannot be opened in Code Studio.");
 return text;
}
function language(path:string){
 const suffix=path.split(".").at(-1)?.toLowerCase();
 return ({html:"HTML",css:"CSS",js:"JavaScript",jsx:"JSX",mjs:"JavaScript",ts:"TypeScript",tsx:"TSX",json:"JSON",md:"Markdown",py:"Python",php:"PHP",yaml:"YAML",yml:"YAML",sh:"Shell",sql:"SQL"} as Record<string,string>)[suffix??""]??"Plain text";
}
export function CodeStudio({site,onClose}:{site:Site;onClose:()=>void}){
 const [cwd,setCwd]=useState(""),[entries,setEntries]=useState<Entry[]>([]);
 const [tabs,setTabs]=useState<Doc[]>([]),[active,setActive]=useState("");
 const [loading,setLoading]=useState(false),[error,setError]=useState(""),[message,setMessage]=useState("");
 const [filter,setFilter]=useState(""),[aiProvider,setAiProvider]=useState(""),[providers,setProviders]=useState<AiProvider[]>([]);
 const [aiTask,setAiTask]=useState("review"),[aiResult,setAiResult]=useState(""),[aiBusy,setAiBusy]=useState(false),[confirmAi,setConfirmAi]=useState(false);
 const editor=useRef<HTMLTextAreaElement>(null);
 const current=tabs.find(t=>t.path===active);
 const dirty=tabs.some(t=>t.draft!==t.original);
 const request=useCallback(async(operation:string,extra:Record<string,unknown>={})=>{
   const response=await fetch("/api/sites/files",{method:"POST",credentials:"same-origin",headers:{"Content-Type":"application/json"},body:JSON.stringify({siteId:site.id,operation,path:cwd,...extra})});
   const value=await response.json() as any;
   if(!response.ok)throw Error(value.error==="file_conflict"?"File changed outside Code Studio. Reopen and compare before saving.":value.error??"File operation failed.");
   return value;
 },[site.id,cwd]);
 const loadFiles=useCallback(async()=>{
  try{const next=await request("list");setEntries(Array.isArray(next)?next:[]);setError("");}
  catch(e){setError(e instanceof Error?e.message:"File list unavailable");}
 },[request]);
 useEffect(()=>{void loadFiles();},[loadFiles]);
 useEffect(()=>{void fetch("/api/ai/status",{credentials:"same-origin"}).then(r=>r.ok?r.json():null).then(x=>{if(x?.providers){setProviders(x.providers);setAiProvider((prev:string)=>prev||x.providers.find((p:AiProvider)=>p.configured)?.id||"");}}).catch(()=>{});},[]);
 const full=(name:string)=>cwd?cwd+"/"+name:name;
 async function openFile(path:string){
  if(tabs.some(t=>t.path===path)){setActive(path);return;}
  setLoading(true);setError("");
  try{
   const result=await request("read",{path});
   const content=decodeText(result.content);
   const doc={path,revision:result.revision,original:content,draft:content};
   setTabs(prev=>prev.some(t=>t.path===path)?prev:[...prev,doc]);
   setActive(path);setAiResult("");setConfirmAi(false);
  }catch(e){setError(e instanceof Error?e.message:"Unable to open file.");}
  finally{setLoading(false);}
 }
 function closeTab(path:string){
  const t=tabs.find(x=>x.path===path);
  if(t&&t.original!==t.draft&&!window.confirm("Discard unsaved changes in "+path+"?"))return;
  const remaining=tabs.filter(x=>x.path!==path);
  setTabs(remaining);if(active===path)setActive(remaining.at(-1)?.path??"");
 }
 function setDraft(text:string){setTabs(prev=>prev.map(t=>t.path===active?{...t,draft:text}:t));}
 async function saveFile(){
  if(!current||current.draft===current.original)return;
  if(!window.confirm("Save changes to "+current.path+"?"))return;
  const toSave=current;setLoading(true);setError("");
  try{
   const bytes=new TextEncoder().encode(toSave.draft);
   if(bytes.length>1048576)throw Error("Code Studio supports files up to 1 MiB.");
   const result=await request("replace",{path:toSave.path,content:encodeText(toSave.draft),expectedRevision:toSave.revision,confirmed:true});
   setTabs(prev=>prev.map(t=>t.path===toSave.path?{...t,revision:result.revision,original:toSave.draft}:t));
   setMessage("Saved "+toSave.path);setAiResult("");
  }catch(e){setError(e instanceof Error?e.message:"Save failed");}
  finally{setLoading(false);}
 }
 function handleKeys(event:KeyboardEvent<HTMLTextAreaElement>){
  if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==="s"){event.preventDefault();void saveFile();}
  if(event.key==="Tab"){event.preventDefault();const element=event.currentTarget;const start=element.selectionStart,end=element.selectionEnd;setDraft((current?.draft??"").slice(0,start)+"  "+(current?.draft??"").slice(end));requestAnimationFrame(()=>{element.selectionStart=start+2;element.selectionEnd=start+2;});}
 }
 async function newFile(){
  const name=window.prompt("New file path relative to this folder (e.g. app.js):");
  if(!name||name.includes("/")||name==="."||name==="..")return;
  setLoading(true);setError("");
  try{await request("create",{path:full(name),content:encodeText(""),confirmed:true});await loadFiles();await openFile(full(name));}
  catch(e){setError(e instanceof Error?e.message:"Create failed");}
  finally{setLoading(false);}
 }
 async function askAi(){
  if(!current||!confirmAi||!aiProvider)return;
  setAiBusy(true);setError("");setAiResult("");
  try{
   if(new TextEncoder().encode(current.draft).length>12000)throw Error("Only 12 KB of explicitly approved code can be sent for AI review.");
   const response=await fetch("/api/ai/code-assist",{method:"POST",headers:{"Content-Type":"application/json"},credentials:"same-origin",body:JSON.stringify({provider:aiProvider,task:aiTask,path:current.path,source:current.draft,confirmed:true})});
   const result=await response.json() as {answer?:string;error?:string};
   if(!response.ok)throw Error(result.error??"AI review failed.");
   setAiResult(result.answer??"The provider returned no text.");setConfirmAi(false);
  }catch(e){setError(e instanceof Error?e.message:"AI request failed");}
  finally{setAiBusy(false);}
 }
 const lines=(current?.draft.split("\n").length??0);
 return <section className="code-studio glass" aria-label={"DevOne Code Studio for "+site.domain}>
  <header className="code-studio-header"><div><span className="overline">DEVONE CODE STUDIO</span><h3>{site.domain}</h3><p>Sandboxed file workspace · revision-safe saves · {dirty?"Unsaved changes":"All changes saved"}</p></div><div className="code-studio-actions"><button onClick={()=>void loadFiles()} disabled={loading}>Refresh</button><button onClick={()=>void newFile()} disabled={loading}>New file</button><button onClick={()=>{if(dirty&&!window.confirm("Close Code Studio with unsaved changes?"))return;onClose();}}>Close studio</button></div></header>
  <div className="code-studio-main"><aside className="code-studio-files"><strong>EXPLORER</strong><label htmlFor="studio-search" className="sr-only">Filter files</label><input id="studio-search" placeholder="Filter files…" value={filter} onChange={e=>setFilter(e.target.value)}/><div className="code-studio-breadcrumb"><button disabled={!cwd} onClick={()=>setCwd(cwd.split("/").slice(0,-1).join("/"))}>↑</button><span>/{cwd||"public"}</span></div>
  {entries.filter(e=>e.name.toLowerCase().includes(filter.toLowerCase())).map(e=><button key={e.name} disabled={loading||e.kind==="blocked"} className={"code-studio-file "+(active===full(e.name)?"selected":"")} onClick={()=>{if(e.kind==="directory")setCwd(full(e.name));else void openFile(full(e.name));}}><span aria-hidden="true">{e.kind==="directory"?"▸":"◇"}</span><span>{e.name}</span></button>)}
  {!entries.length&&<p>No files in this directory. Create a file to start.</p>}
  </aside>
  <div className="code-studio-body"><nav className="code-studio-tabs" aria-label="Open files">{tabs.map(t=><div key={t.path} className={"code-studio-tab "+(active===t.path?"active":"")}><button onClick={()=>setActive(t.path)}>{t.path.split("/").at(-1)}{t.draft!==t.original?" •":""}</button><button aria-label={"Close "+t.path} onClick={()=>closeTab(t.path)}>×</button></div>)}</nav>
  {current?<><div className="code-studio-toolbar"><span>{language(current.path)}</span><span>{lines} lines · UTF-8</span><button disabled={loading||current.draft===current.original} onClick={()=>void saveFile()}>Save <kbd>Ctrl S</kbd></button></div><div className="code-studio-editor"><div className="code-studio-lines" aria-hidden="true">{Array.from({length:Math.min(lines,1000)},(_,i)=><div key={i}>{i+1}</div>)}</div><textarea ref={editor} aria-label={"Editing "+current.path} autoCapitalize="off" autoCorrect="off" spellCheck={false} value={current.draft} onChange={e=>setDraft(e.target.value)} onKeyDown={handleKeys}/></div></>:<div className="code-studio-placeholder"><strong>Open a project file</strong><p>Choose a file from Explorer to edit it. This uses DevOne's secure file API, not a root shell.</p></div>}
  {error&&<p className="inline-error" role="alert">{error}</p>}{message&&<p className="inline-notice" role="status">{message}</p>}
  </div><aside className="code-studio-ai"><h4>AI Coding Assistant</h4><p>Review code with your configured DevOne AI provider. No changes are applied automatically.</p><label>Provider<select value={aiProvider} onChange={e=>setAiProvider(e.target.value)}><option value="">Choose configured provider</option>{providers.filter(p=>p.configured).map(p=><option key={p.id} value={p.id}>{p.label}</option>)}</select></label><label>Task<select value={aiTask} onChange={e=>setAiTask(e.target.value)}><option value="review">Review code</option><option value="explain">Explain code</option><option value="refactor">Suggest refactor</option><option value="tests">Suggest tests</option><option value="security">Security review</option></select></label><label className="code-studio-consent"><input type="checkbox" checked={confirmAi} onChange={e=>setConfirmAi(e.target.checked)}/> I consent to sending this open file's contents to the selected AI provider.</label><button disabled={!current||!aiProvider||!confirmAi||aiBusy} onClick={()=>void askAi()}>{aiBusy?"Analyzing…":"Ask AI about this file"}</button>{aiResult&&<div className="code-studio-ai-result" aria-live="polite">{aiResult}</div>}<p className="muted">Do not send passwords, secrets or private customer data. This editor is not the full VS Code extension host.</p></aside></div>
 </section>;
}
