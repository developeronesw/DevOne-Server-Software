import type {FastifyInstance} from "fastify";
import type {JobQueue,AppInstallInput} from "./jobs.js";
export const installableApps=[
 {id:"static-starter",name:"Static website",siteType:"static",version:"1.0.0"},
 {id:"php-starter",name:"PHP website",siteType:"php",version:"1.0.0"},
 {id:"node-starter",name:"Node.js HTTP app",siteType:"node",version:"1.0.0"}
];
export function registerAppInstalls(app:FastifyInstance,deps:{jobs:JobQueue;requestUser:(r:any)=>{id:string;role:string}|null|undefined;sameOrigin:(r:any)=>boolean}){
 app.get("/api/apps",async(request,reply)=>{
  const user=deps.requestUser(request);if(!user)return reply.code(401).send({error:"unauthorized"});
  if(!["owner","admin"].includes(user.role))return reply.code(403).send({error:"forbidden"});
  return {apps:[...installableApps,...(user.role==="owner"?[{id:"devone-cms-v2",name:"DevOne CMS · preview",siteType:"node",version:"2.0.0-alpha.4"},{id:"wordpress",name:"WordPress",siteType:"php",version:"7.1.3"}]:[])],notice:"Starter apps and Owner-approved WordPress/DevOne CMS preview installers. Existing websites must be empty and use the matching runtime."};
 });
 app.post("/api/apps/install",async(request,reply)=>{
  const user=deps.requestUser(request);if(!user)return reply.code(401).send({error:"unauthorized"});
  if(!["owner","admin"].includes(user.role))return reply.code(403).send({error:"forbidden"});
  if(!request.headers.origin||!deps.sameOrigin(request))return reply.code(403).send({error:"origin_forbidden"});
  const b=request.body as Record<string,unknown>|null;
  if(!b||Array.isArray(b)||Object.keys(b).some(k=>!["appId","siteId","domain","expectedRevision","confirmed","requestKey"].includes(k))||b.confirmed!==true||typeof b.requestKey!=="string"||!installableApps.some(a=>a.id===b.appId))return reply.code(400).send({error:"invalid_app_install"});
  if(b.siteId!==undefined?typeof b.siteId!=="string"||!/^site_[a-f0-9]{16}$/.test(b.siteId)||!Number.isSafeInteger(b.expectedRevision)||Number(b.expectedRevision)<1||b.domain!==undefined: b.expectedRevision!==undefined||typeof b.domain!=="string"||b.domain.length>253||!b.domain.includes(".")||!b.domain.split(".").every(v=>/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(v))||!/[.][a-z]{2,63}$/.test(b.domain))return reply.code(400).send({error:"invalid_app_target"});
  try{return reply.code(202).send({job:deps.jobs.enqueue(user.id,b.requestKey,{appId:b.appId,siteId:b.siteId,domain:b.domain,expectedRevision:b.expectedRevision} as AppInstallInput,"app.install")});}
  catch(e){const code=e instanceof Error?e.message:"queue_error";return reply.code(code==="request_key_conflict"?409:["queue_full","queue_stopping"].includes(code)?503:400).send({error:code});}
 });
}
