import type {FastifyInstance} from 'fastify';
type User={id:string;role:string};
type Deps={requestUser:(r:any)=>User|null|undefined;sameOrigin:(r:any)=>boolean;agentUrl:string;agentToken:string;audit:(actor:string|null,action:string,details?:unknown)=>void};
export function registerDiagnostics(app:FastifyInstance,deps:Deps){
 const attempts=new Map<string,{count:number;reset:number}>();
 const cleanup=setInterval(()=>{for(const [id,v] of attempts)if(v.reset<Date.now())attempts.delete(id);},60000);cleanup.unref();app.addHook('onClose',async()=>clearInterval(cleanup));
 function owner(r:any,reply:any,mutation=false){
  const user=deps.requestUser(r);if(!user){reply.code(401).send({error:'unauthorized'});return null;}
  if(user.role!=='owner'){reply.code(403).send({error:'owner_required'});return null;}
  if(mutation&&(!r.headers.origin||!deps.sameOrigin(r))){reply.code(403).send({error:'origin_forbidden'});return null;}
  reply.header('Cache-Control','no-store');return user;
 }
 async function agent(path:string,payload?:unknown){
  if(!deps.agentToken)throw Error('agent_unconfigured');
  const r=await fetch(deps.agentUrl+path,{method:payload?'POST':'GET',headers:{Authorization:'Bearer '+deps.agentToken,...(payload?{'Content-Type':'application/json'}:{})},...(payload?{body:JSON.stringify(payload)}:{}),redirect:'error',signal:AbortSignal.timeout(10000)});
  if(!r.ok)throw Error(r.status===400?'invalid_diagnostic':r.status===409?'diagnostics_busy':'diagnostics_unavailable');return r.json();
 }
 app.get('/api/resources',async(r,reply)=>{if(!owner(r,reply))return;try{return await agent('/v1/resources');}catch{return reply.code(503).send({error:'resources_unavailable'});}});
 app.get('/api/diagnostics/tools',async(r,reply)=>{if(!owner(r,reply))return;try{return await agent('/v1/diagnostics/tools');}catch{return reply.code(503).send({error:'diagnostics_unavailable'});}});
 app.post('/api/diagnostics/run',async(r,reply)=>{
  const user=owner(r,reply,true);if(!user)return;
  const b=r.body as {toolId?:unknown}|null;
  if(!b||Array.isArray(b)||Object.keys(b).length!==1||typeof b.toolId!=='string'||!/^[a-z-]{3,40}$/.test(b.toolId))return reply.code(400).send({error:'invalid_diagnostic'});
  const now=Date.now(),a=attempts.get(user.id)??{count:0,reset:now+60000};if(a.reset<=now){a.count=0;a.reset=now+60000;}
  if(a.count>=20)return reply.code(429).send({error:'diagnostics_rate_limited'});a.count++;attempts.set(user.id,a);
  deps.audit(user.id,'diagnostic.requested',{toolId:b.toolId});
  try{const result=await agent('/v1/diagnostics/run',{toolId:b.toolId});deps.audit(user.id,'diagnostic.executed',{toolId:b.toolId});return result;}
  catch(e){const code=e instanceof Error?e.message:'';return reply.code(code==='invalid_diagnostic'?400:code==='diagnostics_busy'?409:503).send({error:['invalid_diagnostic','diagnostics_busy'].includes(code)?code:'diagnostics_unavailable'});}
 });
}
