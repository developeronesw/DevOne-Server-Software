import type {FastifyInstance} from 'fastify';
type Deps={agentUrl:string;agentToken:string;requestUser:(request:any)=>{id:string;role:string}|null|undefined;sameOrigin:(request:any)=>boolean;audit:(actor:string|null,event:string,details?:unknown)=>void};
export function registerApplicationQa(app:FastifyInstance,deps:Deps){
 let last=0;
 const owner=(r:any,p:any,post=false)=>{const u=deps.requestUser(r);if(!u){p.code(401).send({error:'unauthorized'});return null;}if(u.role!=='owner'){p.code(403).send({error:'owner_required'});return null;}if(post&&(!r.headers.origin||!deps.sameOrigin(r))){p.code(403).send({error:'origin_forbidden'});return null;}return u;};
 async function agent(path:string,body?:unknown){
  if(!deps.agentToken)throw Error('application_qa_unavailable');
  const r=await fetch(deps.agentUrl+path,{method:body?'POST':'GET',headers:{Authorization:'Bearer '+deps.agentToken,...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(10000),redirect:'error'});
  if(!r.ok){const b=await r.json().catch(()=>({})) as {error?:string};throw Error(['application_qa_busy','application_qa_not_found'].includes(b.error??'')?b.error:'application_qa_unavailable');}return r.json();
 }
 app.get('/api/qa/applications',async(r,p)=>{if(!owner(r,p))return;p.header('Cache-Control','no-store');try{return await agent('/v1/qa/applications');}catch{return p.code(503).send({error:'application_qa_unavailable'});}});
 app.post('/api/qa/applications/check',async(r,p)=>{
  const u=owner(r,p,true);if(!u)return;
  const b=r.body as {siteId?:unknown}|null;
  if(!b||typeof b!=='object'||Array.isArray(b)||Object.keys(b).length!==1||typeof b.siteId!=='string'||!/^site_[a-f0-9]{16}$/.test(b.siteId))return p.code(400).send({error:'invalid_application_qa'});
  if(Date.now()-last<5000)return p.code(429).send({error:'application_qa_rate_limited'});last=Date.now();
  p.header('Cache-Control','no-store');
  try{const result=await agent('/v1/qa/applications/check',b);deps.audit(u.id,'qa.application_checked',{siteId:b.siteId,scope:'read-only'});return result;}
  catch(e){const code=e instanceof Error?e.message:'';return p.code(code==='application_qa_busy'?409:code==='application_qa_not_found'?404:503).send({error:code||'application_qa_unavailable'});}
 });
}
