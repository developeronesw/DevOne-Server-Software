import type { FastifyInstance } from "fastify";
import type { DatabaseSync } from "node:sqlite";
import { backup } from "node:sqlite";
import { randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import type { Vault } from "./vault.js";
import { readMasterKey } from "./vault.js";

type User = { id:string; role:string };
type Deps = {
  db:DatabaseSync; vault:Vault; agentUrl:string; agentToken:string;
  requestUser:(request:any)=>User|null|undefined;
  sameOrigin:(request:any)=>boolean;
  audit:(id:string|null,action:string,detail?:unknown)=>void;
};
type Metric = {hostname?:string;cpuCount?:number;load?:number[];memoryTotal?:number;memoryFree?:number;uptime?:number;ok?:boolean};
type QaResult = {check:string;status:"pass"|"fail";detail:string};
const backupFolder = process.env.DEVONE_BACKUP_DIR ?? "/var/lib/devone/backups";
const model = process.env.DEVONE_AI_MODEL ?? "gemini-2.5-flash";

export function registerControlRoutes(app:FastifyInstance,deps:Deps) {
  const {db,vault,agentUrl,agentToken,requestUser,sameOrigin,audit} = deps;
  db.exec(\`
    CREATE TABLE IF NOT EXISTS metric_samples(
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      checked_at TEXT NOT NULL,
      load1 REAL NOT NULL, load5 REAL NOT NULL,
      memory_percent REAL NOT NULL, cpu_cores INTEGER NOT NULL,
      uptime_seconds REAL NOT NULL
    );
    CREATE TABLE IF NOT EXISTS qa_reports(
      id TEXT PRIMARY KEY, checked_at TEXT NOT NULL,
      passed INTEGER NOT NULL, results TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS qa_reports_time ON qa_reports(checked_at DESC);
  \`);
  const authorize=(request:any,reply:any,ownerOnly=false,mutation=false):User|null=>{
    const user=requestUser(request);
    if(!user){ reply.code(401).send({error:"unauthorized"});return null; }
    if(ownerOnly && user.role!=="owner"){ reply.code(403).send({error:"forbidden"});return null; }
    if(mutation && (!request.headers.origin || !sameOrigin(request))){ reply.code(403).send({error:"origin_forbidden"});return null; }
    return user;
  };
  async function agent(path:string,timeout=4000):Promise<any>{
    if(!agentToken)throw Error("agent_unconfigured");
    const response=await fetch(agentUrl+path,{headers:{Authorization:"Bearer "+agentToken},signal:AbortSignal.timeout(timeout)});
    if(!response.ok)throw Error("agent_unavailable");
    return response.json();
  }
  async function sample(){
    const metrics=await agent("/v1/metrics") as Metric;
    if(!metrics.ok || !Array.isArray(metrics.load) || !Number.isFinite(metrics.memoryTotal) || !metrics.memoryTotal || !Number.isFinite(metrics.memoryFree))throw Error("invalid_metrics");
    const percentage=Math.max(0,Math.min(100,100*(metrics.memoryTotal!-metrics.memoryFree!)/metrics.memoryTotal!));
    const row={load1:metrics.load[0]??0,load5:metrics.load[1]??0,memoryPercent:Number(percentage.toFixed(1)),cpuCores:metrics.cpuCount??0,uptimeSeconds:metrics.uptime??0};
    db.prepare("INSERT INTO metric_samples(checked_at,load1,load5,memory_percent,cpu_cores,uptime_seconds) VALUES (?,?,?,?,?,?)")
      .run(new Date().toISOString(),row.load1,row.load5,row.memoryPercent,row.cpuCores,row.uptimeSeconds);
    // Keep 24 hours of 1-minute snapshots; bounded history, not unbounded storage.
    db.prepare("DELETE FROM metric_samples WHERE checked_at < ?").run(new Date(Date.now()-86400000).toISOString());
    return row;
  }
  let sampling=false,qaBusy=false,lastQaStart=0,lastAiStart=new Map<string,number>(),stopped=false;
  const runSampling=async()=>{if(sampling||stopped)return;sampling=true;try{await sample();}catch{}finally{sampling=false;}};
  const metricsTimer=setInterval(()=>{void runSampling();},60000);
  metricsTimer.unref();
  const startingMetrics=setTimeout(()=>{void runSampling();},1500);
  startingMetrics.unref();

  async function runQa() {
    if(qaBusy)throw Error("qa_busy");
    qaBusy=true;lastQaStart=Date.now();
    const results:QaResult[]=[];
    async function check(name:string,fn:()=>Promise<boolean>,detail:string){
      try{results.push({check:name,status:await fn()?"pass":"fail",detail});}
      catch{results.push({check:name,status:"fail",detail});}
    }
    try{
      await check("api.database",async()=>{const row=db.prepare("PRAGMA integrity_check").get() as {integrity_check?:string};return row.integrity_check==="ok";},"SQLite integrity check");
      await check("api.owner",async()=>{const row=db.prepare("SELECT COUNT(*) AS total FROM users WHERE role='owner'").get() as {total:number};return row.total===1;},"Exactly one initial Owner account");
      await check("api.vault",async()=>{const key=readMasterKey(process.env.DEVONE_MASTER_KEY_FILE??"/etc/devone/secrets.key");try{return key.length===32;}finally{key.fill(0);}},"Encryption master key present with safe permissions");
      await check("agent.health",async()=>Boolean((await agent("/v1/health")).ok),"Authenticated agent health endpoint");
      await check("agent.metrics",async()=>Boolean((await agent("/v1/metrics")).ok),"Readable live system metrics");
      await check("agent.services",async()=>Array.isArray(await agent("/v1/services")),"Allowlisted system service inventory");
      await check("agent.sites",async()=>Array.isArray((await agent("/v1/sites")).sites),"Hosted site registry readable");
      const passed=results.every(x=>x.status==="pass");
      const id=randomUUID(),at=new Date().toISOString();
      db.prepare("INSERT INTO qa_reports(id,checked_at,passed,results) VALUES(?,?,?,?)").run(id,at,passed?1:0,JSON.stringify(results));
      db.prepare("DELETE FROM qa_reports WHERE id NOT IN (SELECT id FROM qa_reports ORDER BY checked_at DESC LIMIT 100)").run();
      return {id,checkedAt:at,passed,results,scope:"live-read-only",productionReady:false};
    }finally{qaBusy=false;}
  }
  const qaTimer=setInterval(()=>{if(!stopped&&!qaBusy)void runQa().catch(()=>{});},6*3600000);
  qaTimer.unref();
  const firstQa=setTimeout(()=>{if(!stopped)void runQa().catch(()=>{});},12000);
  firstQa.unref();
  app.addHook("onClose",async()=>{stopped=true;clearTimeout(startingMetrics);clearTimeout(firstQa);clearInterval(metricsTimer);clearInterval(qaTimer);});
  app.get("/api/monitoring",async(request,reply)=>{
    if(!authorize(request,reply))return;
    reply.header("Cache-Control","no-store");
    const rows=db.prepare("SELECT checked_at,load1,load5,memory_percent,cpu_cores,uptime_seconds FROM metric_samples ORDER BY id DESC LIMIT 120").all();
    return {sampleIntervalSeconds:60,history:rows.reverse(),retentionHours:24};
  });
  app.get("/api/discovery",async(request,reply)=>{
    if(!authorize(request,reply))return;
    try{return await agent("/v1/discovery",6000);}catch{return reply.code(503).send({error:"inventory_unavailable"});}
  });
  const qaHistory=()=>db.prepare("SELECT id,checked_at,passed,results FROM qa_reports ORDER BY checked_at DESC LIMIT 20").all()
    .map((r:any)=>({id:r.id,checkedAt:r.checked_at,passed:Boolean(r.passed),results:JSON.parse(r.results),scope:"live-read-only",productionReady:false}));
  app.get("/api/qa",async(request,reply)=>{
    if(!authorize(request,reply))return;
    reply.header("Cache-Control","no-store");
    return {history:qaHistory(),running:qaBusy,intervalHours:6,productionReady:false,releaseGate:"Legacy parity and live VPS acceptance are still required."};
  });
  app.post("/api/qa/run",async(request,reply)=>{
    const user=authorize(request,reply,false,true);if(!user)return;
    if(qaBusy)return reply.code(409).send({error:"qa_busy"});
    if(Date.now()-lastQaStart<30000)return reply.code(429).send({error:"qa_rate_limited"});
    try{const report=await runQa();audit(user.id,"qa.live_run",{id:report.id,passed:report.passed});return report;}
    catch{return reply.code(503).send({error:"qa_unavailable"});}
  });
  function backupName(id:string){return "control-"+id+".sqlite";}
  const validBackupId=(id:string)=>/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(id);
  async function listBackups(){
    await mkdir(backupFolder,{recursive:true,mode:0o700});
    const files=await readdir(backupFolder);
    const items=[];
    for(const name of files){
      const id=name.startsWith("control-")&&name.endsWith(".sqlite")?name.slice(8,-7):"";
      if(!validBackupId(id))continue;
      const f=await stat(join(backupFolder,name));
      if(f.isFile())items.push({id,createdAt:f.mtime.toISOString(),bytes:f.size});
    }
    return items.sort((a,b)=>b.createdAt.localeCompare(a.createdAt)).slice(0,30);
  }
  app.get("/api/backups",async(request,reply)=>{
    if(!authorize(request,reply,true))return;
    try{return {backups:await listBackups(),scope:"control-database-only",restoreSupported:false,warning:"Control database contains encrypted credentials. A separately secured vault master key is required for recovery. Hosted site files and databases are NOT included."};}
    catch{return reply.code(503).send({error:"backups_unavailable"});}
  });
  let backupBusy=false,lastBackupStart=0;
  app.post("/api/backups",async(request,reply)=>{
    const user=authorize(request,reply,true,true);if(!user)return;
    if((request.body as {confirmed?:unknown}|null)?.confirmed!==true)return reply.code(400).send({error:"confirmation_required"});
    if(backupBusy)return reply.code(409).send({error:"backup_busy"});
    if(Date.now()-lastBackupStart<60000)return reply.code(429).send({error:"backup_rate_limited"});
    backupBusy=true;lastBackupStart=Date.now();
    try{
      const existing=await listBackups();
      if(existing.length>=30)return reply.code(409).send({error:"backup_limit_reached"});
      const id=randomUUID(),name=backupName(id);
      const target=join(backupFolder,name);
      await backup(db,target);
      const info=await stat(target);
      audit(user.id,"backup.control_created",{id,bytes:info.size});
      return reply.code(201).send({id,createdAt:info.mtime.toISOString(),bytes:info.size});
    }catch{return reply.code(503).send({error:"backup_failed"});}
    finally{backupBusy=false;}
  });
  app.get<{Params:{id:string}}>("/api/backups/:id/download",async(request,reply)=>{
    if(!authorize(request,reply,true))return;
    if(!validBackupId(request.params.id))return reply.code(400).send({error:"invalid_backup"});
    try{
      const filename=backupName(request.params.id),path=join(backupFolder,filename);
      const metadata=await stat(path);
      if(!metadata.isFile())throw Error("not_file");
      reply.header("Content-Type","application/octet-stream");
      reply.header("Content-Disposition",'attachment; filename="'+filename+'"');
      reply.header("Cache-Control","no-store");
      reply.header("X-Content-Type-Options","nosniff");
      return reply.send(createReadStream(path));
    }catch{return reply.code(404).send({error:"backup_not_found"});}
  });
  app.get("/api/ai/status",async(request,reply)=>{
    if(!authorize(request,reply))return;
    reply.header("Cache-Control","no-store");
    const configured=(vault.list() as {name:string}[]).some(x=>x.name==="gemini.api_key");
    return {provider:"Google Gemini",model,configured,mode:"read-only-advice",secretName:"gemini.api_key"};
  });
  app.post("/api/ai/diagnose",async(request,reply)=>{
    const user=authorize(request,reply,false,true);if(!user)return;
    const body=request.body as {question?:unknown}|null;
    if(typeof body?.question!=="string"||body.question.trim().length<5||body.question.length>1600)return reply.code(400).send({error:"invalid_question"});
    const previous=lastAiStart.get(user.id)??0;
    if(Date.now()-previous<15000)return reply.code(429).send({error:"ai_rate_limited"});
    lastAiStart.set(user.id,Date.now());
    let key:string|undefined;
    try{key=vault.get("gemini.api_key");}
    catch{return reply.code(503).send({error:"vault_unavailable"});}
    if(!key)return reply.code(409).send({error:"gemini_not_configured"});
    try{
      const [metrics,services]=await Promise.all([
        agent("/v1/metrics",3000).catch(()=>({ok:false})),
        agent("/v1/services",3000).catch(()=>[])
      ]);
      // Explicit, minimal host context: never send user records, secrets, IPs or logs to the model.
      const snapshot={
        cpuCores:metrics.cpuCount??null,
        load1:metrics.load?.[0]??null,
        memoryPercent:metrics.memoryTotal?Math.round((1-metrics.memoryFree/metrics.memoryTotal)*100):null,
        serviceStates:(Array.isArray(services)?services:[]).map((v:any)=>({name:v.service,state:v.ActiveState}))
      };
      const result=await fetch("https://generativelanguage.googleapis.com/v1beta/models/"+encodeURIComponent(model)+":generateContent",{
        method:"POST",
        headers:{"Content-Type":"application/json","x-goog-api-key":key},
        signal:AbortSignal.timeout(20000),
        body:JSON.stringify({
          systemInstruction:{parts:[{text:"You are DevOne AI, a read-only diagnostics assistant. Analyze only the supplied non-secret server health summary. State uncertainty. Suggest verifiable checks and safe steps. Never claim to have made changes, executed commands, or inspected unavailable systems. Do not request credentials. No mutating operations are available."}]},
          contents:[{role:"user",parts:[{text:JSON.stringify({snapshot,question:body.question.trim()})}]}],
          generationConfig:{maxOutputTokens:700,temperature:0.2}
        })
      });
      if(!result.ok)return reply.code(502).send({error:"ai_provider_unavailable"});
      const data=await result.json() as {candidates?:Array<{content?:{parts?:Array<{text?:string}>}}>}>;
      const answer=data.candidates?.[0]?.content?.parts?.map(x=>x.text??"").join("\n").trim()??"";
      if(!answer)return reply.code(502).send({error:"ai_empty_response"});
      audit(user.id,"ai.diagnostic_requested",{provider:"gemini",mode:"read-only"});
      return {answer:answer.slice(0,8000),mode:"read-only-advice",model};
    }catch{return reply.code(503).send({error:"ai_request_failed"});}
  });
}
