import {useEffect,useRef,useState} from "react";
type Plan={id:string;tool:string;parameters:Record<string,unknown>;description:string;expiresAt:string};
type Message={id:string;role:"user"|"assistant";content:string;context?:boolean;plan?:Plan;state?:"pending"|"running"|"cancelled"|"submitted"|"expired";approved?:boolean};
type Job={id:string;state:string;error:string|null};
async function post<T>(url:string,body:unknown):Promise<T>{const r=await fetch(url,{method:"POST",credentials:"same-origin",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)});const d=await r.json();if(!r.ok)throw Error(d.error??"Request failed");return d;}
export function AiActions({provider,ready}:{provider:string;ready:boolean}){
 const [question,setQuestion]=useState(""),[share,setShare]=useState(false),[busy,setBusy]=useState(false),[messages,setMessages]=useState<Message[]>([]),[jobs,setJobs]=useState<Job[]>([]),[now,setNow]=useState(Date.now()),[nextSend,setNextSend]=useState(0);
 const thread=useRef<HTMLDivElement>(null),lock=useRef(false);
 const add=(m:Omit<Message,"id">)=>setMessages(old=>[...old,{...m,id:crypto.randomUUID()}].slice(-60));
 const change=(id:string,update:Partial<Message>)=>setMessages(old=>old.map(m=>m.id===id?{...m,...update}:m));
 useEffect(()=>{if(thread.current)thread.current.scrollTop=thread.current.scrollHeight;},[messages,jobs]);
 useEffect(()=>{const timer=setInterval(()=>setNow(Date.now()),1000);return ()=>clearInterval(timer);},[]);
 useEffect(()=>{
  const pending=jobs.filter(j=>["queued","running"].includes(j.state));if(!pending.length)return;
  let live=true;
  const timer=setInterval(()=>{for(const job of pending)void fetch("/api/jobs/"+encodeURIComponent(job.id),{credentials:"same-origin",cache:"no-store"}).then(async r=>{if(!r.ok)throw Error();return r.json() as Promise<{job:Job}>;}).then(d=>{if(live)setJobs(old=>old.map(j=>j.id===job.id?d.job:j));}).catch(()=>{});},2500);
  return ()=>{live=false;clearInterval(timer);};
 },[jobs]);
 async function cancel(message:Message){
  if(!message.plan||lock.current)return;
  lock.current=true;setBusy(true);
  try{await post("/api/ai/actions/cancel",{planId:message.plan.id});change(message.id,{state:"cancelled",approved:false});}
  catch(e){add({role:"assistant",content:e instanceof Error?e.message:"Cancellation unavailable"});}
  finally{lock.current=false;setBusy(false);}
 }
 async function send(){
  if(lock.current||!ready||question.trim().length<1||Date.now()<nextSend)return;
  lock.current=true;setBusy(true);const text=question.trim();setQuestion("");
  // Only conversational text is shared. Tool results, files and job output stay local.
  const history=messages.filter(m=>m.context).slice(-6).map(({role,content})=>({role,content:content.slice(0,1600)}));
  while(history.length&&new TextEncoder().encode(JSON.stringify(history)).length>11000)history.shift();
  add({role:"user",content:text,context:true});
  try{
   // Supersede pending proposals before asking for another one.
   for(const m of messages.filter(m=>m.state==="pending"&&m.plan)){
    try{await post("/api/ai/actions/cancel",{planId:m.plan!.id});change(m.id,{state:"cancelled",approved:false});}
    catch(e){if(e instanceof Error&&e.message==="ai_plan_expired_or_used")change(m.id,{state:"expired",approved:false});else throw e;}
   }
   setNextSend(Date.now()+15000);
   const d=await post<{plan?:Plan;message?:string}>("/api/ai/actions/plan",{provider,question:text,history,shareSiteInventory:share});
   if(d.plan)add({role:"assistant",content:"Review this proposed action. Nothing has been executed.",plan:d.plan,state:"pending"});
   else add({role:"assistant",content:d.message??"Please describe the task and target website.",context:true});
  }catch(e){add({role:"assistant",content:e instanceof Error?e.message:"AI unavailable. Your request was not executed."});}
  finally{lock.current=false;setBusy(false);}
 }
 async function execute(message:Message){
  if(lock.current||!message.plan||!message.approved||Date.parse(message.plan.expiresAt)<=Date.now())return;
  lock.current=true;setBusy(true);change(message.id,{state:"running",approved:false});
  try{
   const d=await post<{message:string;statusCode:number;result:{job?:Job;[key:string]:unknown}}>("/api/ai/actions/execute",{planId:message.plan.id,confirmed:true});
   change(message.id,{state:"submitted"});
   add({role:"assistant",content:d.message+"\n"+JSON.stringify(d.result,null,2)});
   if(d.result.job?.id)setJobs(old=>[...old.filter(j=>j.id!==d.result.job!.id),d.result.job!].slice(-20));
  }catch(e){change(message.id,{state:"submitted"});add({role:"assistant",content:(e instanceof Error?e.message:"Action outcome unavailable")+". Check Activity & jobs before repeating the request."});}
  finally{lock.current=false;setBusy(false);}
 }
 return <section className="surface-card glass ai-chat" aria-label="DevOne AI chat"><div className="section-heading"><div><span className="overline">DEVONE AI CHAT</span><h2>What would you like to do?</h2></div><span className={"state-chip "+(ready?"good":"neutral")}>{ready?"Connected":"Connect a provider"}</span></div>
 <p>Describe your task, answer follow-up questions, then review and confirm each action here. Your role and the normal dashboard permissions apply.</p>
 <div ref={thread} className="ai-chat-thread" role="log" aria-label="Conversation" aria-live="polite" aria-relevant="additions text">
 {!messages.length&&<div className="ai-chat-welcome"><strong>Your server, in conversation.</strong><p>Try “Create a Node.js starter at app.example.com” or “Show my managed websites.”</p></div>}
 {messages.map(m=>{const expired=Boolean(m.plan&&Date.parse(m.plan.expiresAt)<=now);return <article key={m.id} className={"ai-chat-message "+m.role}><strong>{m.role==="user"?"You":"DevOne AI"}</strong><pre>{m.content}</pre>
 {m.plan&&<div className="ai-chat-plan"><h3>{m.plan.tool}</h3><p>{m.plan.description}</p><pre>{JSON.stringify(m.plan.parameters,null,2)}</pre><p>{m.state==="pending"&&expired?"Expired — ask for a new proposal.":m.state==="pending"?"Awaiting your permission · expires "+new Date(m.plan.expiresAt).toLocaleTimeString():m.state==="submitted"?"Request submitted — see the response and job status below.":m.state}</p>
 {m.state==="pending"&&!expired&&<><label className="ops-ai-consent"><input type="checkbox" disabled={busy} checked={Boolean(m.approved)} onChange={e=>change(m.id,{approved:e.target.checked})}/> I approve this exact target and action.</label><div className="ai-chat-actions"><button className="primary-button" disabled={busy||!m.approved} onClick={()=>void execute(m)}>Confirm & run</button><button disabled={busy} onClick={()=>void cancel(m)}>Deny action</button></div></>}
 </div>}
 </article>;})}
 </div>
 {jobs.map(j=><p className="ai-chat-job" role="status" key={j.id}>Job {j.id}: <strong>{j.state}</strong>{j.error?" — "+j.error:""}{["queued","running"].includes(j.state)?" · Waiting for completion; check Activity & jobs if status stops updating.":""}</p>)}
 <form onSubmit={e=>{e.preventDefault();void send();}}><label htmlFor={"ai-chat-input-"+provider}>Message DevOne AI</label><textarea id={"ai-chat-input-"+provider} disabled={busy} maxLength={1600} value={question} onChange={e=>setQuestion(e.target.value)} placeholder="Tell DevOne what to do…"/><label className="ops-ai-consent"><input type="checkbox" checked={share} disabled={busy} onChange={e=>setShare(e.target.checked)}/> Include website names, IDs, types, states and revisions in requests sent to this provider.</label><button className="primary-button" type="submit" disabled={busy||!ready||question.trim().length<1||now<nextSend}>{busy?"Working…":now<nextSend?"Send in "+Math.ceil((nextSend-now)/1000)+"s":"Send message"}</button></form>
 <p className="ops-note">Recent conversational messages go to your selected provider. Results stay local. Never enter passwords or keys in chat. Sensitive operations outside the supported action set use their dedicated dashboard forms. This conversation stays in memory and clears when you leave this page or reload.</p>
 </section>;
}
export function DashboardAiChat({onSetup}:{onSetup:()=>void}){
 const [providers,setProviders]=useState<{id:string;label:string;configured:boolean}[]>([]),[selected,setSelected]=useState(""),[error,setError]=useState("");
 useEffect(()=>{let live=true;void fetch("/api/ai/status",{credentials:"same-origin",cache:"no-store"}).then(async r=>{if(!r.ok)throw Error("AI connections unavailable");return r.json();}).then(d=>{if(live){setProviders(d.providers);setSelected(d.providers.find((p:{configured:boolean})=>p.configured)?.id??d.providers[0]?.id??"");}}).catch(e=>{if(live)setError(e.message);});return ()=>{live=false;};},[]);
 return <div className="dashboard-ai-chat"><div className="ai-chat-toolbar"><label>AI connection <select value={selected} onChange={e=>setSelected(e.target.value)}>{providers.map(p=><option key={p.id} value={p.id}>{p.label}{p.configured?"":" · needs setup"}</option>)}</select></label><button onClick={onSetup}>Manage AI connection</button></div>{error&&<p role="alert" className="inline-error">{error}</p>}<AiActions key={selected} provider={selected} ready={Boolean(providers.find(p=>p.id===selected)?.configured)}/></div>;
}
