import type {FastifyInstance} from "fastify";

type User={id:string;role:string};
type Deps={
  agentUrl:string;agentToken:string;
  requestUser:(request:any)=>User|null|undefined;
  sameOrigin:(request:any)=>boolean;
  audit:(id:string|null,event:string,details?:unknown)=>void;
};
const allowed=new Set(["php8.3-fpm","redis-server"]);

export function registerSoftwareRoutes(app:FastifyInstance,deps:Deps){
  const attempts=new Map<string,{count:number;reset:number}>();
  function authorize(request:any,reply:any,mutation=false):User|null{
    const user=deps.requestUser(request);
    if(!user){reply.code(401).send({error:"unauthorized"});return null;}
    if(!["owner","admin"].includes(user.role)){reply.code(403).send({error:"forbidden"});return null;}
    if(mutation && (!request.headers.origin || !deps.sameOrigin(request))){
      reply.code(403).send({error:"origin_forbidden"});return null;
    }
    return user;
  }
  async function agent(path:string,method:"GET"|"POST",body?:unknown){
    if(!deps.agentToken)throw Error("agent_unconfigured");
    const response=await fetch(deps.agentUrl+path,{
      method,
      headers:{"Authorization":"Bearer "+deps.agentToken,...(method==="POST"?{"Content-Type":"application/json"}:{})},
      ...(method==="POST"?{body:JSON.stringify(body)}:{}),
      signal:AbortSignal.timeout(50000),
      redirect:"error"
    });
    if(!response.ok)throw Error("agent_unavailable");
    return response.json() as Promise<any>;
  }
  app.get("/api/software/capabilities",async(request,reply)=>{
    if(!authorize(request,reply))return;
    reply.header("Cache-Control","no-store");
    try{
      const result=await agent("/v1/software/capabilities","GET");
      if(result?.installAvailable!==false||result?.mode!=="read-only-preflight"||!Array.isArray(result.options))
        throw Error("agent_invalid_capabilities");
      return result;
    }catch{return reply.code(503).send({error:"software_capabilities_unavailable"});}
  });
  app.post("/api/software/preflight",async(request,reply)=>{
    const user=authorize(request,reply,true);
    if(!user)return;
    const body=request.body as {package?:unknown}|null;
    if(!body||typeof body!=="object"||Array.isArray(body)||Object.keys(body).length!==1||
       !allowed.has(body.package as string))
      return reply.code(400).send({error:"invalid_software_preflight"});
    const now=Date.now(),entry=attempts.get(user.id)??{count:0,reset:now+60000};
    if(now>entry.reset){entry.count=0;entry.reset=now+60000;}
    if(entry.count>=3)return reply.code(429).send({error:"software_preflight_rate_limited"});
    entry.count++;attempts.set(user.id,entry);
    reply.header("Cache-Control","no-store");
    try{
      const result=await agent("/v1/software/preflight","POST",{package:body.package});
      if(result?.package!==body.package||!["ready","blocked"].includes(result?.status)||result?.installAvailable!==false)
        throw Error("agent_invalid_preflight");
      deps.audit(user.id,"software.preflight",{package:body.package,status:result.status});
      return result;
    }catch{return reply.code(503).send({error:"software_preflight_unavailable"});}
  });
}
