import type {FastifyInstance} from "fastify";
import {verifyOwnerStepUp} from "./auth.js";
type User={id:string;role:string};
type Deps={agentUrl:string;agentToken:string;requestUser:(request:any)=>User|null|undefined;sameOrigin:(request:any)=>boolean;audit:(actor:string|null,event:string,details?:unknown)=>void};
export function registerDisposableQaRoutes(app:FastifyInstance,deps:Deps){
 let lastStart=0;
 function owner(request:any,reply:any,mutating=false){
  const user=deps.requestUser(request);
  if(!user){reply.code(401).send({error:"unauthorized"});return null;}
  if(user.role!=="owner"){reply.code(403).send({error:"owner_required"});return null;}
  if(mutating&&(!request.headers.origin||!deps.sameOrigin(request))){reply.code(403).send({error:"origin_forbidden"});return null;}
  return user;
 }
 async function agent(path:string,method:"GET"|"POST",body?:unknown){
  if(!deps.agentToken)throw Error("agent_unavailable");
  const response=await fetch(deps.agentUrl+path,{
   method,headers:{Authorization:"Bearer "+deps.agentToken,...(method==="POST"?{"Content-Type":"application/json"}:{})},
   ...(method==="POST"?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(12000),redirect:"error"
  });
  if(!response.ok){
   const v=await response.json().catch(()=>({})) as {error?:string};
   throw Error(v.error==="qa_disposable_busy"?"qa_disposable_busy":"agent_unavailable");
  }
  return response.json() as Promise<any>;
 }
 app.get("/api/qa/disposable",async(request,reply)=>{
  if(!owner(request,reply))return;
  reply.header("Cache-Control","no-store");
  try{
   const state=await agent("/v1/qa/disposable/status","GET");
   if(!Array.isArray(state.results)||!["not_run","running","passed","failed"].includes(state.state))throw Error("invalid_state");
   return state;
  }catch{return reply.code(503).send({error:"qa_disposable_unavailable"});}
 });
 app.post("/api/qa/disposable/start",async(request,reply)=>{
  const user=owner(request,reply,true);
  if(!user)return;
  const body=request.body as {confirmed?:unknown;password?:unknown;mfaCode?:unknown}|null;
  if(!body||typeof body!=="object"||Array.isArray(body)||
     Object.keys(body).some(x=>!["confirmed","password","mfaCode"].includes(x))||
     body.confirmed!==true||typeof body.password!=="string"||body.password.length>1024||
     body.password.length<1||(body.mfaCode!==undefined&&typeof body.mfaCode!=="string"))
    return reply.code(400).send({error:"qa_confirmation_required"});
  if(Date.now()-lastStart<60000)return reply.code(429).send({error:"qa_disposable_rate_limited"});
  const verified=verifyOwnerStepUp(user.id,body.password,body.mfaCode);
  if(verified!=="ok")return reply.code(403).send({error:verified==="password_invalid"?"owner_password_invalid":verified});
  try{
   const run=await agent("/v1/qa/disposable/start","POST",{confirmed:true});
   if(run?.state!=="running"||typeof run.id!=="string")throw Error("invalid_start");
   lastStart=Date.now();
   deps.audit(user.id,"qa.disposable_started",{id:run.id});
   return reply.code(202).send(run);
  }catch(e){return reply.code(e instanceof Error&&e.message==="qa_disposable_busy"?409:503).send({error:e instanceof Error&&e.message==="qa_disposable_busy"?"qa_disposable_busy":"qa_disposable_unavailable"});}
 });
}
