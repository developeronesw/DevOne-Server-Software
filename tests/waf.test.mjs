import test from "node:test";
import assert from "node:assert/strict";
import {mkdtemp,mkdir,rm,readFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {validateWaf,nginxWafZone,nginxWafLocation} from "../agent/dist/waf.js";
import {SiteManager} from "../agent/dist/sites.js";
const id="site_0123456789abcdef";
test("WAF compiler emits bounded site-specific NGINX directives, not arbitrary strings",()=>{
 const policy=validateWaf({mode:"monitor",requestsPerSecond:5,burst:20});
 assert.deepEqual(policy,{mode:"monitor",requestsPerSecond:5,burst:20});
 assert.match(nginxWafZone(id,policy),/limit_req_zone \$binary_remote_addr zone=devone_0123456789abcdef:1m rate=5r\/s/);
 assert.match(nginxWafLocation(id,policy),/limit_req_dry_run on/);
 assert.match(nginxWafLocation(id,policy),/limit_req_status 429/);
 assert.doesNotMatch(nginxWafLocation(id,{...policy,mode:"enforce"}),/dry_run/);
 assert.equal(nginxWafZone(id,{...policy,mode:"off"}),"");
 assert.equal(nginxWafLocation(id,{...policy,mode:"off"}),"");
 for(const bad of [null,{},[],{mode:"enforce",requestsPerSecond:0,burst:20},{mode:"enforce",requestsPerSecond:51,burst:20},
    {mode:"enforce",requestsPerSecond:10,burst:101},{mode:"enforce",requestsPerSecond:10.5,burst:10},
    {mode:"enforce",requestsPerSecond:10,burst:10,custom:"allow all;"},
    {mode:"allow",requestsPerSecond:10,burst:10}]){
  assert.throws(()=>validateWaf(bad),/invalid_waf_policy/);
 }
 assert.throws(()=>nginxWafZone("site_../evil",policy),/invalid_site/);
});
async function fixture(run){
 const directory=await mkdtemp(join(tmpdir(),"devone-waf-test-"));
 const opts={registry:join(directory,"registry"),base:join(directory,"sites"),nginx:join(directory,"nginx"),panelDomain:"panel.example.com",requireRoot:false,ownership:async()=>{}};
 await mkdir(opts.nginx);
 const uid=process.getuid()===0?1000:process.getuid(),gid=process.getgid()===0?1000:process.getgid();
 let failNext=false;const commands=[];
 opts.command=async(command,args)=>{
  commands.push([command,args]);
  if(command==="nginx"&&args[0]==="-t"&&failNext){failNext=false;throw Error("invalid_nginx_config");}
  if(command==="useradd")return "";
  if(command==="getent")return "dvs_dummy:x:"+uid+":"+gid+"::"+args[1]+":/usr/sbin/nologin";
  return "";
 };
 // Identity has a variable username/home derived by the manager.
 opts.command=async(command,args)=>{
  commands.push([command,args]);
  if(command==="nginx"&&args[0]==="-t"&&failNext){failNext=false;throw Error("invalid_nginx_config");}
  if(command==="getent"){
   const name=args[1],hex=name.slice(4);
   return name+":x:"+uid+":"+gid+"::"+join(opts.base,"site_"+hex)+":/usr/sbin/nologin";
  }
  return "";
 };
 try{await run({manager:new SiteManager(opts),opts,commands,failOnce:()=>{failNext=true;}});}
 finally{await rm(directory,{recursive:true,force:true});}
}
test("per-site rate protection applies and persists without touching the panel or other sites",()=>fixture(async({manager,opts,commands})=>{
 const site=await manager.create({domain:"site.example.com",webServer:"nginx"});
 const other=await manager.create({domain:"other.example.com",webServer:"nginx"});
 const path=join(opts.nginx,"devone-"+site.id+".conf");
 const otherPath=join(opts.nginx,"devone-"+other.id+".conf");
 const otherBefore=await readFile(otherPath,"utf8");
 const result=await manager.setWaf({siteId:site.id,expectedRevision:site.revision,policy:{mode:"monitor",requestsPerSecond:10,burst:20}});
 assert.equal(result.policy.mode,"monitor");
 assert.equal(result.revision,site.revision+1);
 let content=await readFile(path,"utf8");
 assert.match(content,/limit_req_zone \$binary_remote_addr/);
 assert.match(content,/limit_req_dry_run on/);
 assert.match(content,/limit_req_status 429/);
 assert.equal(await readFile(otherPath,"utf8"),otherBefore);
 assert.equal((await manager.list()).find(s=>s.id===site.id)?.waf?.mode,"monitor");
 assert.ok(commands.some(([cmd,args])=>cmd==="nginx"&&args[0]==="-t"));
 const enforce=await manager.setWaf({siteId:site.id,expectedRevision:result.revision,policy:{mode:"enforce",requestsPerSecond:5,burst:10}});
 content=await readFile(path,"utf8");assert.doesNotMatch(content,/dry_run/);
 assert.equal(enforce.policy.mode,"enforce");
 await assert.rejects(manager.setWaf({siteId:site.id,expectedRevision:site.revision,policy:{mode:"off",requestsPerSecond:10,burst:20}}),/site_revision_conflict/);
 const none=await manager.create({domain:"files.example.com",webServer:"none"});
 await assert.rejects(manager.setWaf({siteId:none.id,expectedRevision:none.revision,policy:{mode:"enforce",requestsPerSecond:10,burst:20}}),/site_not_ready/);
}));
test("NGINX syntax failure restores previous vhost and policy",()=>fixture(async({manager,opts,failOnce})=>{
 const site=await manager.create({domain:"rollback.example.com",webServer:"nginx"});
 const path=join(opts.nginx,"devone-"+site.id+".conf");
 const before=await readFile(path,"utf8");
 failOnce();
 await assert.rejects(manager.setWaf({siteId:site.id,expectedRevision:site.revision,policy:{mode:"enforce",requestsPerSecond:3,burst:5}}),/waf_apply_failed/);
 assert.equal(await readFile(path,"utf8"),before);
 const [record]=await manager.list();
 assert.equal(record.state,"ready");
 assert.equal(record.revision,site.revision);
 assert.equal(record.waf,undefined);
}));
