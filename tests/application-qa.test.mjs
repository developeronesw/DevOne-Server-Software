import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {createServer as createTlsServer} from 'node:https';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {ApplicationQa,probeInstalledApp} from '../agent/dist/application-qa.js';
import Fastify from '../apps/api/node_modules/fastify/fastify.js';
import {registerApplicationQa} from '../apps/api/dist/application-qa.js';
const site={id:'site_0123456789abcdef',domain:'app.example.test',state:'ready',tls:true,appActive:true,application:{id:'app_0123456789abcdef',appId:'devone-cms-v2',version:'2.0.0-alpha.4',stage:'complete'}};
const pages={
 '/':'<html><script src="/assets/dashboard.js"></script></html>',
 '/api/health':JSON.stringify({ok:true,product:'DevOne CMS',version:site.application.version}),
 '/api/install/status':JSON.stringify({installed:true,siteUrl:site.domain})
};
test('application checker uses managed identities, reports exact scope, redacts bodies and fails private-path exposure',async()=>{
 let current=structuredClone(site);const calls=[];
 const manager={list:async()=>[current]};
 const probe=async(s,p)=>{calls.push([s.domain,p]);return {status:p in pages?200:404,body:pages[p]??'private-secret-that-must-not-appear'};};
 const qa=new ApplicationQa(manager,probe);
 const listed=await qa.list();assert.equal(listed.applications[0].siteId,site.id);assert.equal(listed.applications[0].appActive,undefined);
 const r=await qa.check({siteId:site.id});assert.equal(r.state,'passed');assert.equal(r.productionReady,false);assert.equal(r.scope,'installed-application-read-only');assert.equal(r.checks.length,9);assert.equal(r.pending.length,3);assert.ok(!JSON.stringify(r).includes('private-secret'));assert.ok(calls.every(c=>c[0]===site.domain));
 await assert.rejects(qa.check({siteId:site.id,url:'https://evil.test'}),/invalid_application_qa/);
 await assert.rejects(qa.check({siteId:'site_ffffffffffffffff'}),/not_found/);
 const exposed=new ApplicationQa(manager,async(s,p)=>p==='/data/devone.secret'?{status:200,body:'leaked-secret'}:probe(s,p));
 const fail=await exposed.check({siteId:site.id});assert.equal(fail.state,'failed');assert.equal(fail.checks.find(c=>c.name==='cms.private/data/devone.secret').status,'fail');assert.ok(!JSON.stringify(fail).includes('leaked-secret'));
 current={...current,tls:false};assert.equal((await qa.check({siteId:site.id})).state,'blocked');
 current={...current,state:'needs_inspection'};calls.length=0;assert.equal((await qa.check({siteId:site.id})).state,'blocked');assert.equal(calls.length,0);
});
test('wrong app identity, domain/version and HTTP errors never pass; concurrency guard resets after failure',async()=>{
 let current=structuredClone(site);
 for(const replacement of [{'/api/health':'{"ok":true,"product":"Other app"}'},{'/api/install/status':'{"installed":true,"siteUrl":"other.example.test"}'},{'/':'default website'}]){
  const qa=new ApplicationQa({list:async()=>[current]},async(s,p)=>({status:p in pages?200:404,body:replacement[p]??pages[p]??''}));assert.equal((await qa.check({siteId:site.id})).state,'failed');
 }
 current={...current,application:{...current.application,appId:'wordpress',version:'7.1.3'}};
 const wp=new ApplicationQa({list:async()=>[current]},async(s,p)=>({status:p==='/wp-config.php'?403:200,body:p==='/wp-login.php'?'<form id="loginform"><input name="log"></form>':'<link href="/wp-content/theme.css">'}));
 assert.equal((await wp.check({siteId:site.id})).state,'passed');
 const redirect=new ApplicationQa({list:async()=>[current]},async()=>({status:302,body:'',location:'https://evil.test'}));assert.equal((await redirect.check({siteId:site.id})).state,'failed');
 let release;const waiting=new ApplicationQa({list:async()=>{await new Promise(r=>release=r);throw Error('unavailable');}});
 const first=waiting.check({siteId:site.id});await assert.rejects(waiting.check({siteId:site.id}),/busy/);release();await assert.rejects(first,/unavailable/);
 const next=waiting.check({siteId:site.id});release();await assert.rejects(next,/unavailable/);
});
test('actual probe connects only to loopback, sends virtual host, never follows redirects and rejects untrusted TLS',async()=>{
 const seen=[];const server=createServer((req,res)=>{seen.push([req.headers.host,req.url]);if(req.url==='/wp-config.php'){res.end('x'.repeat(524289));return;}res.writeHead(302,{Location:'http://evil.test'});res.end('redirect');});await new Promise(r=>server.listen(0,'127.0.0.1',r));
 try{const ports={http:server.address().port,https:server.address().port};const r=await probeInstalledApp({...site,tls:false},'/',ports);assert.equal(r.status,302);assert.deepEqual(seen,[[site.domain,'/']]);await assert.rejects(probeInstalledApp(site,'/',ports));assert.throws(()=>probeInstalledApp(site,'/custom/secret',ports),/invalid_application_probe/);await assert.rejects(probeInstalledApp({...site,tls:false},'/wp-config.php',ports),/application_response_too_large/);}
 finally{await new Promise(r=>server.close(r));}
});
test('application QA API requires Owner and same-origin, only forwards site IDs, throttles and keeps errors safe',async()=>{
 const seen=[],audits=[];const upstream=createServer((req,res)=>{seen.push(req.url);assert.equal(req.headers.authorization,'Bearer fixture');let b='';req.on('data',c=>b+=c);req.on('end',()=>{res.setHeader('Content-Type','application/json');if(req.method==='POST'){assert.deepEqual(JSON.parse(b),{siteId:site.id});res.end(JSON.stringify({scope:'installed-application-read-only',state:'passed'}));}else res.end(JSON.stringify({applications:[]}));});});await new Promise(r=>upstream.listen(0,'127.0.0.1',r));
 const app=Fastify();registerApplicationQa(app,{agentUrl:'http://127.0.0.1:'+upstream.address().port,agentToken:'fixture',requestUser:r=>r.headers.role?{id:'owner',role:r.headers.role}:null,sameOrigin:r=>r.headers.origin==='https://panel.example.test',audit:(...a)=>audits.push(a)});
 const url='/api/qa/applications/check',headers={role:'owner',origin:'https://panel.example.test'},payload={siteId:site.id};
 const post=(h=headers,b=payload)=>app.inject({method:'POST',url,headers:h,payload:b});
 try{
  assert.equal((await app.inject({url:'/api/qa/applications'})).statusCode,401);assert.equal((await post({})).statusCode,401);
  assert.equal((await post({...headers,role:'admin'})).statusCode,403);assert.equal((await post({role:'owner'})).statusCode,403);assert.equal((await post({...headers,origin:'https://evil.test'})).statusCode,403);
  assert.equal((await post(headers,{...payload,path:'/etc/passwd'})).statusCode,400);assert.equal(seen.length,0);
  const listing=await app.inject({url:'/api/qa/applications',headers});assert.equal(listing.statusCode,200);assert.equal(listing.headers['cache-control'],'no-store');
  const result=await post();assert.equal(result.statusCode,200);assert.equal(result.headers['cache-control'],'no-store');assert.equal((await post()).statusCode,429);assert.equal(audits[0][1],'qa.application_checked');assert.deepEqual(seen,['/v1/qa/applications','/v1/qa/applications/check']);
 }finally{await app.close();await new Promise(r=>upstream.close(r));}
});

test('HTTPS probe rejects a self-signed app certificate without disabling domain verification',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'devone-appqa-cert-'));
 let server;
 try{
  execFileSync('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-keyout',join(dir,'key.pem'),'-out',join(dir,'cert.pem'),'-subj','/CN=app.example.test','-days','1'],{stdio:'ignore'});
  server=createTlsServer({key:await readFile(join(dir,'key.pem')),cert:await readFile(join(dir,'cert.pem'))},(req,res)=>res.end('untrusted'));
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  await assert.rejects(probeInstalledApp(site,'/',{http:80,https:server.address().port}),e=>e.code==='DEPTH_ZERO_SELF_SIGNED_CERT');
 }finally{if(server)await new Promise(r=>server.close(r));await rm(dir,{recursive:true,force:true});}
});
