import {test} from "node:test";
import assert from "node:assert/strict";
import {createServer} from "node:http";
import {DisposableHostQa,probeQaWebsite,waitForQaWebsite} from "../agent/dist/disposable-qa.js";
import {pythonUnitConfig,dockerRunArgs,managedContainerImage,runtimeNginxLocation} from "../agent/dist/site-runtimes.js";
const site={id:"site_0123456789abcdef",user:"dvs_0123456789abcdef",siteType:"python",runtimeVersion:"3.12"};
test("Python 3.12 adapter starts isolated systemd app on private loopback port",()=>{
 const config=pythonUnitConfig(site);
 assert.match(config,/User=dvs_0123456789abcdef/);
 assert.match(config,/ExecStart=\/usr\/bin\/python3\.12 .*\/app\.py/);
 assert.match(config,/Environment=HOST=127\.0\.0\.1/);
 assert.match(config,/NoNewPrivileges=true/);
 const proxy=runtimeNginxLocation(site);
 assert.match(proxy,/proxy_pass http:\/\/127\.0\.0\.1:/);
 assert.doesNotMatch(proxy,/limit_req test;/m);
 assert.throws(()=>pythonUnitConfig({...site,runtimeVersion:"3.13"}));
});
test("Docker adapter has fixed unprivileged image, loopback publishing and no host control mounts",()=>{
 const instance={...site,siteType:"container",runtimeVersion:undefined};
 const args=dockerRunArgs(instance,2001,2001);
 assert.equal(args[0],"run");
 assert.ok(args.includes("--read-only"));
 assert.ok(args.includes("--cap-drop=ALL"));
 assert.ok(args.includes("--security-opt"));
 assert.ok(args.some(x=>x.startsWith("127.0.0.1:")&&x.endsWith(":8080")));
 assert.ok(args.includes("2001:2001"));
 assert.equal(args.at(-1),managedContainerImage);
 assert.ok(args.includes("--memory"));
 assert.ok(args.includes("--pids-limit"));
 assert.ok(args.includes("--label"));
 assert.ok(args.includes("devone.site=site_0123456789abcdef"));
 assert.equal(args.some(x=>/docker\.sock|--privileged|--network=host/.test(x)),false);
 assert.match(runtimeNginxLocation(instance),/proxy_pass http:\/\/127\.0\.0\.1:/);
 assert.throws(()=>dockerRunArgs({...instance,id:"site_invalid"},2001,2001));
});
test("disposable QA creates, verifies, and deletes only site IDs it created",async()=>{
 const sites=new Map(),actions=[],types=[],created=new Set(),deleted=new Set();
 let count=0;
 const fake={
  async create(input){
   types.push(input.siteType);
   const id="site_"+(++count).toString(16).padStart(16,"0");
   const site={id,domain:input.domain,siteType:input.siteType,revision:1};
   sites.set(id,{...site,fixture:""});created.add(id);return site;
  },
  async files(input){
   const site=sites.get(input.siteId);assert.ok(site,"file operation must belong to QA-created site");
   if(input.operation==="create"){
    site.fixture=Buffer.from(input.content,"base64").toString("utf8");return {};
   }
   if(input.operation==="read")return {content:Buffer.from(site.fixture).toString("base64")};
   throw Error("unsupported operation");
  },
  async action(input){
   const site=sites.get(input.siteId);
   assert.ok(site,"operation must target QA-created site");
   actions.push(input);
   if(input.action==="delete"){
    assert.equal(input.confirmDomain,site.domain);
    deleted.add(input.siteId);sites.delete(input.siteId);
   }
   return site;
  }
 };
 const probe=async(domain,marker)=>{
  const site=[...sites.values()].find(x=>x.domain===domain);
  assert.ok(site);
  if(site.siteType==="php")assert.equal(site.fixture.includes(marker),false,"PHP source must not satisfy execution verification");
  const found=site.fixture.replaceAll("'.'","").match(/DEVONE_QA_[0-9a-f]+_(?:static|php|node|python|container)/)?.[0];
  return {status:200,matched:found===marker};
 };
 try{
  const qa=new DisposableHostQa(fake,probe);
  assert.equal(qa.status().state,"not_run");
  const run=qa.start();
  assert.equal(run.state,"running");
  assert.throws(()=>qa.start(),/qa_disposable_busy/);
  let report;
  for(let tries=0;tries<100;tries++){
   report=qa.status();
   if(report.state!=="running")break;
   await new Promise(resolve=>setTimeout(resolve,30));
  }
  assert.notEqual(report.state,"running");
  assert.deepEqual(types,["static","files","php","node","python","container"]);
  assert.deepEqual([...created],[...deleted],"all created QA sites must be deleted");
  assert.equal(sites.size,0);
  assert.ok(report.results.slice(0,6).every(x=>x.status==="pass"&&x.cleaned===true),JSON.stringify(report.results));
  assert.equal(actions.filter(a=>a.action==="delete").length,6);
  assert.equal(actions.filter(a=>a.action==="start").length,3);
 }finally{assert.equal(sites.size,0);}
});

test("QA HTTP probe sends actual virtual host and does not follow redirects",async()=>{
 const seen=[];
 const server=createServer((req,res)=>{
  seen.push(req.headers.host);
  if(req.headers.host==="qa-redirect.invalid"){res.writeHead(302,{Location:"http://unreachable.invalid/"});res.end();}
  else if(req.headers.host==="qa-large.invalid")res.end("x".repeat(70000));
  else res.end(req.headers.host==="qa-target.invalid"?"unique-qa-marker":"default website");
 });
 await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));
 try{
  const port=server.address().port;
  assert.deepEqual(await probeQaWebsite("qa-target.invalid","unique-qa-marker",port),{status:200,matched:true});
  assert.deepEqual(await probeQaWebsite("qa-wrong.invalid","unique-qa-marker",port),{status:200,matched:false});
  assert.deepEqual(await probeQaWebsite("qa-redirect.invalid","unique-qa-marker",port),{status:302,matched:false});
  await assert.rejects(probeQaWebsite("qa-large.invalid","unique-qa-marker",port),/qa_response_too_large/);
  assert.deepEqual(seen,["qa-target.invalid","qa-wrong.invalid","qa-redirect.invalid","qa-large.invalid"]);
 }finally{await new Promise(resolve=>server.close(resolve));}
});
test("missing Docker blocks QA without claiming an uncreated site needs cleanup",async()=>{
 const qa=new DisposableHostQa({create:async()=>{throw Error("docker_runtime_not_running");}});
 qa.start();
 let report;
 for(let tries=0;tries<100;tries++){
  report=qa.status();if(report.state!=="running")break;
  await new Promise(resolve=>setTimeout(resolve,30));
 }
 assert.equal(report.state,"failed");
 const result=report.results.find(x=>x.name==="site.container");
 assert.equal(result.status,"blocked");assert.equal(result.cleaned,undefined);assert.equal(result.siteId,undefined);
});

test("readiness reconnects through stale workers and transient gateway errors, but rejects persistent wrong content",async()=>{
 const counts=new Map(),sockets=new Set();
 const server=createServer((req,res)=>{
  const host=req.headers.host,n=(counts.get(host)??0)+1;counts.set(host,n);sockets.add(req.socket);
  if(host==="qa-eventual.invalid"&&n===1){res.end("old default website");return;}
  if(host==="qa-eventual.invalid"&&n===2){res.writeHead(502);res.end("starting");return;}
  if(host==="qa-eventual.invalid")res.end("expected-marker");else res.end("wrong website");
 });
 await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));
 try{
  const probe=(d,m,t)=>probeQaWebsite(d,m,server.address().port,t);
  const healthy=await waitForQaWebsite("qa-eventual.invalid","expected-marker",probe,1000,10);
  assert.deepEqual(healthy,{status:200,matched:true,attempts:3});
  const failed=await waitForQaWebsite("qa-wrong.invalid","expected-marker",probe,100,10);
  assert.equal(failed.status,200);assert.equal(failed.matched,false);assert.ok(failed.attempts>1);
  assert.equal(sockets.size,[...counts.values()].reduce((a,b)=>a+b,0),"each received readiness request must use a fresh connection");
  let tries=0;
  const offline=await waitForQaWebsite("qa-offline.invalid","expected-marker",async()=>{if(++tries===1)throw Error("ECONNREFUSED");return {status:200,matched:true};},1000,10);
  assert.equal(offline.attempts,2);
 }finally{await new Promise(resolve=>server.close(resolve));}
});
