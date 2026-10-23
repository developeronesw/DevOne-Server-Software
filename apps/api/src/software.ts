import type {FastifyInstance} from "fastify";
import type {JobQueue} from "./jobs.js";
import {verifyOwnerStepUp} from "./auth.js";

type User={id:string;role:string};
type Deps={
 agentUrl:string;agentToken:string;jobs:JobQueue;
 requestUser:(request:any)=>User|null|undefined;
 sameOrigin:(request:any)=>boolean;
 audit:(id:string|null,event:string,details?:unknown)=>void;
};
const packages=["php8.3-fpm","redis-server","docker.io","mariadb-server","postgresql"] as const;
const validPackage=(p:unknown):p is (typeof packages)[number]=>packages.includes(p as any);
export function registerSoftwareRoutes(app:FastifyInstance,deps:Deps){
 const attempts=new Map<string,{count:number;reset:number}>();
 function authorize(request:any,reply:any,mutation=false):User|null{
  const user=deps.requestUser(request);
  if(!user){reply.code(401).send({error:"unauthorized"});return null;}
  if(!["owner","admin"].includes(user.role)){reply.code(403).send({error:"forbidden"});return null;}
  if(mutation&&(!request.headers.origin||!deps.sameOrigin(request))){
   reply.code(403).send({error:"origin_forbidden"});return null;
  }
  return user;
 }
 async function agent(path:string){
  if(!deps.agentToken)throw Error("agent_unconfigured");
  const response=await fetch(deps.agentUrl+path,{
   headers:{Authorization:"Bearer "+deps.agentToken},
   signal:AbortSignal.timeout(12000),
   redirect:"error"
  });
  if(!response.ok)throw Error("agent_unavailable");
  return response.json() as Promise<any>;
 }
 app.get("/api/software/capabilities",async(request,reply)=>{
  if(!authorize(request,reply))return;
  reply.header("Cache-Control","no-store");
  try{
   const data=await agent("/v1/software/capabilities");
   if(data?.mode!=="managed-install"||data?.installAvailable!==true||
     !Array.isArray(data.options)||data.options.length!==packages.length||
     data.options.some((p:any,i:number)=>p.package!==packages[i]||p.installAvailable!==true))
      throw Error("invalid_capabilities");
   return data;
  }catch{return reply.code(503).send({error:"software_capabilities_unavailable"});}
 });
 app.get("/api/software/status",async(request,reply)=>{
  if(!authorize(request,reply))return;
  reply.header("Cache-Control","no-store");
  try{
   const data=await agent("/v1/software/status");
   if(data?.installAvailable!==true||!Array.isArray(data.packages)||data.packages.length!==packages.length||
     data.packages.some((p:any,i:number)=>p.package!==packages[i]||typeof p.installed!=="boolean"||
       typeof p.serviceActive!=="boolean"||(p.version!==null&&typeof p.version!=="string")))
    throw Error("invalid_software_status");
   return data;
  }catch{return reply.code(503).send({error:"software_status_unavailable"});}
 });
 app.post("/api/software/install",async(request,reply)=>{
  const user=authorize(request,reply,true);
  if(!user)return;
  if(user.role!=="owner")return reply.code(403).send({error:"owner_required"});
  const body=request.body as {package?:unknown;requestKey?:unknown;confirmed?:unknown;password?:unknown;mfaCode?:unknown}|null;
  if(!body||typeof body!=="object"||Array.isArray(body)||
    Object.keys(body).some(k=>!["package","requestKey","confirmed","password","mfaCode"].includes(k))||
    !validPackage(body.package)||body.confirmed!==true||
    typeof body.requestKey!=="string"||!/^[a-zA-Z0-9_-]{16,128}$/.test(body.requestKey)||
    typeof body.password!=="string"||body.password.length>1024||
    (body.mfaCode!==undefined&&typeof body.mfaCode!=="string"))
    return reply.code(400).send({error:"invalid_software_install"});
  const now=Date.now(),entry=attempts.get(user.id)??{count:0,reset:now+60000};
  if(now>entry.reset){entry.count=0;entry.reset=now+60000;}
  if(entry.count>=3)return reply.code(429).send({error:"software_install_rate_limited"});
  entry.count++;attempts.set(user.id,entry);
  const step=verifyOwnerStepUp(user.id,body.password,body.mfaCode);
  if(step!=="ok")return reply.code(403).send({error:step==="password_invalid"?"owner_password_invalid":step});
  try{
   const job=deps.jobs.enqueue(user.id,body.requestKey,{package:body.package,confirmed:true},"software.install");
   deps.audit(user.id,"software.install_authorized",{jobId:job.id,package:body.package});
   return reply.code(202).send({job});
  }catch(e){
   const code=e instanceof Error?e.message:"queue_unavailable";
   return reply.code(code==="request_key_conflict"?409:503).send({error:code==="request_key_conflict"?code:"software_queue_unavailable"});
  }
 });
}
