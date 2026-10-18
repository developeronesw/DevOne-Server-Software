import {test} from "node:test";
import assert from "node:assert/strict";
import {mkdtemp,readFile,mkdir,rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {DatabaseSync} from "node:sqlite";
import {SiteManager,siteInput} from "../agent/dist/sites.js";
import {nodeSitePort,phpPoolConfig,nodeUnitConfig,runtimeNginxLocation} from "../agent/dist/site-runtimes.js";
import {getWebsitePresets,resolvePreset} from "../apps/api/dist/presets.js";
import {JobQueue} from "../apps/api/dist/jobs.js";

const id="site_1234567890abcdef",user="dvs_1234567890abcdef";
test("real PHP and Node presets work; unsupported versions and servers fail closed",()=>{
 const presets=getWebsitePresets().presets;
 assert.equal(presets.find(p=>p.id==="php").available,true);
 assert.equal(presets.find(p=>p.id==="node").available,true);
 assert.equal(presets.find(p=>p.id==="python").available,true);
 assert.deepEqual(getWebsitePresets().deployableTypes,["static","files","php","node","python","container"]);
 assert.equal(resolvePreset("php","nginx","8.3").siteType,"php");
 assert.equal(resolvePreset("node","nginx","22").siteType,"node");
 assert.throws(()=>resolvePreset("php","nginx","8.4"));
 assert.throws(()=>resolvePreset("node","apache","22"));
 assert.throws(()=>siteInput({domain:"site.example.test",siteType:"php",webServer:"nginx",runtimeVersion:"8.4"}));
 assert.equal(siteInput({domain:"site.example.test",siteType:"php",webServer:"nginx",runtimeVersion:"8.3"}).siteType,"php");
});
test("actual NGINX/PHP-FPM and Node.js configs run as isolated site users",()=>{
 const php={id,user,siteType:"php",runtimeVersion:"8.3"};
 const node={id,user,siteType:"node",runtimeVersion:"22"};
 const pool=phpPoolConfig(php);
 assert.match(pool,/user = dvs_1234567890abcdef/);
 assert.match(pool,/listen = \/run\/php\/devone-site_1234567890abcdef\.sock/);
 assert.match(pool,/pm.max_children = 4/);
 assert.match(pool,/security.limit_extensions = \.php/);
 const fastcgi=runtimeNginxLocation(php);
 assert.match(fastcgi,/fastcgi_pass unix:\/run\/php/);
 assert.match(fastcgi,/try_files \$uri =404/);
 assert.match(fastcgi,/SCRIPT_FILENAME/);
 const unit=nodeUnitConfig(node);
 assert.match(unit,/User=dvs_1234567890abcdef/);
 assert.match(unit,/NoNewPrivileges=true/);
 assert.match(unit,/\/server\.mjs/);
 assert.match(unit,new RegExp("PORT="+nodeSitePort(id)));
 const proxy=runtimeNginxLocation(node);
 assert.match(proxy,/proxy_pass http:\/\/127\.0\.0\.1:/);
 assert.match(proxy,/proxy_connect_timeout 5s/);
 assert.match(runtimeNginxLocation(node,"/home/devone-sites"," limit_req test;\n"),/limit_req test;/);
});
test("existing durable site job now preserves requested runtime and version",async()=>{
 const db=new DatabaseSync(":memory:");
 db.exec("CREATE TABLE users(id TEXT PRIMARY KEY,role TEXT NOT NULL); INSERT INTO users VALUES('owner','owner');");
 const executions=[],audit=[];
 const queue=new JobQueue(db,async(input,operation)=>executions.push({input,operation}),(id,event)=>audit.push({id,event}));
 const job=queue.enqueue("owner","runtime-site-create-abc12345",{domain:"myapp.example.com",siteType:"node",runtimeVersion:"22",webServer:"nginx"},"site.create");
 await queue.idle();
 assert.equal(queue.get(job.id).state,"succeeded");
 assert.equal(executions[0].input.siteType,"node");
 assert.equal(executions[0].input.runtimeVersion,"22");
 assert.ok(audit.some(x=>x.event==="job.succeeded"));
 await queue.stop();db.close();
});
test("SiteManager provisions real PHP pool and Node systemd unit, not empty adapter stubs",async()=>{
 const dir=await mkdtemp(join(tmpdir(),"devone-runtime-site-"));
 const base=join(dir,"homes"),nginx=join(dir,"nginx"),registry=join(dir,"registry"),phpPoolDir=join(dir,"php"),nodeUnitDir=join(dir,"units");
 await Promise.all([base,nginx,registry,phpPoolDir,nodeUnitDir].map(x=>mkdir(x,{recursive:true,mode:x===registry?0o700:0o755})));
 const commands=[];
 const runner=async(bin,args)=>{
  commands.push({bin,args});
  if(bin==="nginx"&&args[0]==="-T")return "server_name existing.example.test;\n";
  if(bin==="getent"){
   const requested=args[1],suffix=requested.slice(4);
   return requested+":x:2001:2001::"+base+"/site_"+suffix+":/usr/sbin/nologin\n";
  }
  if(bin==="node"&&args[0]==="--version")return "v22.23.3\n";
  if(bin==="systemctl"&&args[0]==="is-active")return "active\n";
  return "";
 };
 try{
  const m=new SiteManager({registry,base,nginx,panelDomain:"panel.example.test",phpPoolDir,nodeUnitDir,requireRoot:false,ownership:async()=>{},command:runner});
  const php=await m.create({domain:"php.example.test",siteType:"php",runtimeVersion:"8.3",webServer:"nginx"});
  const node=await m.create({domain:"node.example.test",siteType:"node",runtimeVersion:"22",webServer:"nginx"});
  assert.equal(php.state,"ready");
  assert.equal(node.state,"ready");
  assert.match(await readFile(join(phpPoolDir,"devone-"+php.id+".conf"),"utf8"),/user = dvs_/);
  assert.match(await readFile(join(nodeUnitDir,"devone-"+node.id+".service"),"utf8"),/NoNewPrivileges=true/);
  assert.match(await readFile(join(nginx,"devone-"+php.id+".conf"),"utf8"),/fastcgi_pass/);
  assert.match(await readFile(join(nginx,"devone-"+node.id+".conf"),"utf8"),/proxy_pass http:\/\/127/);
  assert.ok(commands.some(x=>x.bin==="php-fpm8.3"&&x.args[0]==="-t"));
  assert.ok(commands.some(x=>x.bin==="systemctl"&&x.args[0]==="daemon-reload"));
  const sites=await m.list();
  assert.equal(sites.length,2);
  assert.equal(sites.find(x=>x.siteType==="node").appActive,true); // mocked systemd state
  const status=await m.runtimeStatus();
  assert.equal(status.ok,true);
  assert.equal(status.runtimes.length,2);
  assert.ok(status.runtimes.every(x=>x.configured));
  await assert.rejects(m.action({siteId:node.id,action:"start",expectedRevision:1}),/node_entry_missing/);
 }finally{await rm(dir,{recursive:true,force:true});}
});
