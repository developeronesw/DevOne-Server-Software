import type {FastifyInstance} from "fastify";
import type {DatabaseSync} from "node:sqlite";
import {randomUUID} from "node:crypto";

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
