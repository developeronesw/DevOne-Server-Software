import type {FastifyInstance} from "fastify";
import type {DatabaseSync} from "node:sqlite";
import {randomUUID} from "node:crypto";
import {verifyOwnerPassword} from "./auth.js";

type User={id:string;role:string};
type Dependencies={db:DatabaseSync;agentUrl:string;agentToken:string;requestUser:(r:any)=>User|null|undefined;sameOrigin:(r:any)=>boolean;audit:(id:string|null,event:string,detail?:unknown)=>void};
export type SecurityReport={checkedAt:string;mode:string;findings:Array<{id:string;title:string;severity:"high"|"medium"|"low"|"info";status:"pass"|"warning"|"unknown";detail:string;recommendation:string}>;summary:{warnings:number;passed:number;unknown:number};limitations:string[]};
export function registerSecurityRoutes(app:FastifyInstance,deps:Dependencies){
 const {db,agentUrl,agentToken,requestUser,sameOrigin,audit}=deps;
 db.exec("CREATE TABLE IF NOT EXISTS security_reports(id TEXT PRIMARY KEY, checked_at TEXT NOT NULL, results TEXT NOT NULL)");
 function authorized(r:any,reply:any,mutation=false){
   const user=requestUser(r);
   if(!user){reply.code(401).send({error:"unauthorized"});return null;}
   if(user.role!=="owner"&&user.role!=="admin"){reply.code(403).send({error:"forbidden"});return null;}
   if(mutation&&(!r.headers.origin||!sameOrigin(r))){reply.code(403).send({error:"origin_forbidden"});return null;}
   return user;
 }
 const getLatest=():SecurityReport|null=>{
   const row=db.prepare("SELECT results FROM security_reports ORDER BY checked_at DESC LIMIT 1").get() as {results:string}|undefined;
   return row?JSON.parse(row.results) as SecurityReport:null;
 };
 let busy=false,lastRun=0,stopped=false;
 async function scan(actor?:string){
   if(busy)throw Error("scan_busy");
   busy=true;lastRun=Date.now();
   try{
     if(!agentToken)throw Error("agent_unconfigured");
     const response=await fetch(agentUrl+"/v1/security/scan",{headers:{Authorization:"Bearer "+agentToken},signal:AbortSignal.timeout(18000)});
     if(!response.ok)throw Error("agent_unavailable");
     const report=await response.json() as SecurityReport;
     if(!report||report.mode!=="passive-local-baseline"||!Array.isArray(report.findings)||report.findings.length>30||typeof report.checkedAt!=="string")throw Error("invalid_scan");
     const id=randomUUID();
     db.prepare("INSERT INTO security_reports(id,checked_at,results) VALUES(?,?,?)").run(id,new Date().toISOString(),JSON.stringify(report));
     db.prepare("DELETE FROM security_reports WHERE id NOT IN (SELECT id FROM security_reports ORDER BY checked_at DESC LIMIT 30)").run();
     if(actor)audit(actor,"security.scan_requested",{id,warnings:report.summary?.warnings??null});
     return report;
   }finally{busy=false;}
 }
 const timer=setInterval(()=>{if(!stopped&&!busy)void scan().catch(()=>{});},6*3600000);
 timer.unref();
 const startup=setTimeout(()=>{if(!stopped)void scan().catch(()=>{});},20000);
 startup.unref();
 app.addHook("onClose",async()=>{stopped=true;clearInterval(timer);clearTimeout(startup);});

 async function agentGet(path:string){
   if(!agentToken)throw Error("agent_unconfigured");
   const response=await fetch(agentUrl+path,{headers:{Authorization:"Bearer "+agentToken},signal:AbortSignal.timeout(6000)});
   if(!response.ok)throw Error("agent_unavailable");
   return response.json() as Promise<any>;
 }
 app.get("/api/shield",async(r,reply)=>{
   if(!authorized(r,reply))return;
   reply.header("Cache-Control","no-store");
   try{
     const data=await agentGet("/v1/sites");
     if(!Array.isArray(data.sites))throw Error("invalid_sites");
     return {
       sites:data.sites.map((s:any)=>({siteId:s.id,domain:s.domain,webServer:s.webServer,state:s.state,revision:s.revision,
         policy:s.waf??{mode:"off",requestsPerSecond:10,burst:20},
         available:s.webServer==="nginx"&&s.state==="ready"})),
       engine:"nginx-native-rate-limit",webApplicationFirewall:false,
       globalPanelWaf:false,
       disclaimer:"Per-site NGINX request-rate protection only. Does not inspect payloads or mitigate volumetric DDoS. CrowdSec/AppSec is not yet installed.",
       modes:["off","monitor","enforce"]
     };
   }catch{return reply.code(503).send({error:"shield_unavailable"});}
 });
 const changeAttempts=new Map<string,{count:number;reset:number}>();
 app.post<{Params:{siteId:string}}>("/api/shield/sites/:siteId",async(r,reply)=>{
   const user=authorized(r,reply,true);if(!user)return;
   if(user.role!=="owner")return reply.code(403).send({error:"owner_required"});
   const raw=r.body as {expectedRevision?:unknown;policy?:unknown;confirmed?:unknown;password?:unknown}|null;
   if(!/^site_[a-f0-9]{16}$/.test(r.params.siteId)||raw?.confirmed!==true||
     !Number.isSafeInteger(raw.expectedRevision)||Number(raw.expectedRevision)<1||
     typeof raw.password!=="string"||raw.password.length>1024||
     !raw.policy||typeof raw.policy!=="object"||Array.isArray(raw.policy))
     return reply.code(400).send({error:"invalid_shield_request"});
   const p=raw.policy as Record<string,unknown>;
   if(Object.keys(p).some(key=>!["mode","requestsPerSecond","burst"].includes(key))||
      !["off","monitor","enforce"].includes(p.mode as string)||
      !Number.isInteger(p.requestsPerSecond)||Number(p.requestsPerSecond)<1||Number(p.requestsPerSecond)>50||
      !Number.isInteger(p.burst)||Number(p.burst)<1||Number(p.burst)>100)
      return reply.code(400).send({error:"invalid_shield_policy"});
   const current=Date.now(),entry=changeAttempts.get(user.id)??{count:0,reset:current+60000};
   if(current>entry.reset){entry.count=0;entry.reset=current+60000;}
   if(entry.count>=5)return reply.code(429).send({error:"shield_rate_limited"});
   entry.count++;changeAttempts.set(user.id,entry);
   if(!verifyOwnerPassword(user.id,raw.password))return reply.code(403).send({error:"owner_password_invalid"});
   if(!agentToken)return reply.code(503).send({error:"agent_unavailable"});
   try{
     const response=await fetch(agentUrl+"/v1/sites/waf",{
       method:"POST",
       headers:{"Authorization":"Bearer "+agentToken,"Content-Type":"application/json"},
       body:JSON.stringify({siteId:r.params.siteId,expectedRevision:raw.expectedRevision,policy:p}),
       signal:AbortSignal.timeout(20000)
     });
     const result=await response.json().catch(()=>({})) as {error?:string;[key:string]:unknown};
     if(!response.ok){
       const allowed=["site_revision_conflict","site_config_changed","site_not_ready","invalid_waf_policy","invalid_waf_action"];
       return reply.code(response.status===409?409:response.status===400?400:503).send({error:allowed.includes(result.error??"")?result.error:"shield_apply_failed"});
     }
     audit(user.id,"shield.site_policy_updated",{siteId:r.params.siteId,mode:p.mode,rate:p.requestsPerSecond,burst:p.burst});
     return {site:result};
   }catch{return reply.code(503).send({error:"shield_result_requires_inspection"});}
 });
 app.get("/api/security",async(r,reply)=>{
   if(!authorized(r,reply))return;
   reply.header("Cache-Control","no-store");
   return {latest:getLatest(),busy,scheduleHours:6,scope:"passive-local-baseline",cveScan:false};
 });
 app.post("/api/security/scan",async(r,reply)=>{
   const user=authorized(r,reply,true);if(!user)return;
   if(busy)return reply.code(409).send({error:"scan_busy"});
   if(Date.now()-lastRun<60000)return reply.code(429).send({error:"scan_rate_limited"});
   try{return {report:await scan(user.id)};}
   catch{return reply.code(503).send({error:"scan_unavailable"});}
 });
}
