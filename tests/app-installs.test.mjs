import test from 'node:test';
import assert from 'node:assert/strict';
import Fastify from '../apps/api/node_modules/fastify/fastify.js';
import {mkdtemp,mkdir,rm,readFile,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {SiteManager} from '../agent/dist/sites.js';
import {SiteFiles} from '../agent/dist/site-files.js';
import {registerAppInstalls} from '../apps/api/dist/app-installs.js';
import {starterSource} from '../agent/dist/app-starters.js';
test('app API checks origin, role, target and confirmation before queuing',async()=>{
 const app=Fastify(),queued=[];registerAppInstalls(app,{jobs:{enqueue(...args){queued.push(args);return {id:'job'};}},requestUser:r=>r.headers.role?{id:'u',role:r.headers.role}:null,sameOrigin:r=>r.headers.origin==='https://panel.example.com'});
 const headers={role:'admin',origin:'https://panel.example.com'},payload={appId:'static-starter',domain:'app.example.com',requestKey:'test_request_key_1234',confirmed:true};
 try{
  assert.equal((await app.inject({url:'/api/apps'})).statusCode,401);
  for(const [h,p,status] of [[{...headers,role:'viewer'},payload,403],[{role:'owner'},payload,403],[headers,{...payload,confirmed:false},400],[headers,{...payload,appId:'wordpress'},400],[headers,{...payload,domain:'bad;id.com'},400],[headers,{...payload,siteId:'site_0123456789abcdef',expectedRevision:1},400],[headers,{...payload,command:'id'},400],[headers,payload,202]])assert.equal((await app.inject({method:'POST',url:'/api/apps/install',headers:h,payload:p})).statusCode,status);
  assert.equal(queued.length,1);assert.equal(queued[0][3],'app.install');
 }finally{await app.close();}
});
test('starter install creates a new site, protects nonempty sites and serializes competing writes',async()=>{
 const root=await mkdtemp(join(tmpdir(),'devone-app-')),identities=new Map();
 const options={base:join(root,'sites'),registry:join(root,'registry'),nginx:join(root,'nginx'),panelDomain:'panel.example.com',requireRoot:false,ownership:async()=>{},command:async(c,a)=>{if(c==='useradd')identities.set(a.at(-1),a[a.indexOf('--home-dir')+1]);if(c==='getent')return `${a[1]}:x:1000:1000::${identities.get(a[1])}:/usr/sbin/nologin`;return '';},worker:async(site,r)=>{const files=new SiteFiles(join(options.base,site.id,'public'));if(r.operation==='list')return files.list(r.path);if(r.operation==='create'){await files.create(r.path,Buffer.from(r.content,'base64'));return {ok:true};}throw Error('unexpected operation');}};
 await mkdir(options.nginx);const manager=new SiteManager(options);
 try{
  const result=await manager.installApp({appId:'static-starter',domain:'app.example.com'});assert.equal(result.appId,'static-starter');
  const [site]=await manager.list();assert.equal(site.state,'ready');assert.equal(site.revision,2);assert.match(await readFile(join(options.base,site.id,'public/index.html'),'utf8'),/Your website is ready/);
  await assert.rejects(manager.installApp({appId:'static-starter',siteId:site.id,expectedRevision:1}),/revision_conflict/);
  await assert.rejects(manager.installApp({appId:'static-starter',siteId:site.id,expectedRevision:2}),/not_empty/);
  await assert.rejects(manager.installApp({appId:'php-starter',siteId:site.id,expectedRevision:2}),/incompatible/);
  await assert.rejects(manager.installApp({appId:'wordpress',domain:'wp.example.com'}),/unsupported_app/);
  const empty=await manager.create({domain:'empty.example.com',webServer:'nginx',siteType:'static'});
  const outcomes=await Promise.allSettled([manager.installApp({appId:'static-starter',siteId:empty.id,expectedRevision:1}),manager.files({siteId:empty.id,operation:'create',path:'index.html',content:Buffer.from('overwrite').toString('base64')})]);
  assert.equal(outcomes[0].status,'fulfilled');assert.equal(outcomes[1].status,'rejected');assert.match(await readFile(join(options.base,empty.id,'public/index.html'),'utf8'),/Your website is ready/);
  const broken=await manager.create({domain:'broken.example.com',webServer:'nginx',siteType:'static'});const worker=options.worker;
  options.worker=async(s,r)=>{if(s.id===broken.id&&r.operation==='create')throw Error('disk failed');return worker(s,r);};
  await assert.rejects(manager.installApp({appId:'static-starter',siteId:broken.id,expectedRevision:1}),/requires_inspection/);
  assert.equal((await manager.list()).find(s=>s.id===broken.id).state,'needs_inspection');
  assert.match(starterSource('node-starter'),/127\.0\.0\.1/);assert.match(starterSource('php-starter'),/^<\?php/);
 }finally{await rm(root,{recursive:true,force:true});}
});
test('app jobs deduplicate, persist immutable targets and preserve inspection failures',async()=>{
 const {DatabaseSync}=await import('node:sqlite');const {JobQueue}=await import('../apps/api/dist/jobs.js');const {assertAgentMutationResult}=await import('../apps/api/dist/job-agent-result.js');
 const db=new DatabaseSync(':memory:');db.exec("CREATE TABLE users(id TEXT PRIMARY KEY,role TEXT);INSERT INTO users VALUES('owner','owner')");let executed=0;
 const queue=new JobQueue(db,async(input,operation)=>{executed++;assert.equal(operation,'app.install');assert.equal(input.appId,'static-starter');await assertAgentMutationResult(new Response(JSON.stringify({error:'app_install_requires_inspection'}),{status:503}),operation);},()=>{});
 try{
  const input={appId:'static-starter',domain:'new.example.com'},job=queue.enqueue('owner','app_request_key_1234',input,'app.install');
  assert.equal(queue.enqueue('owner','app_request_key_1234',input,'app.install').id,job.id);
  assert.throws(()=>queue.enqueue('owner','app_request_key_1234',{...input,domain:'changed.example.com'},'app.install'),/conflict/);
  await queue.idle();assert.equal(executed,1);assert.equal(queue.get(job.id).state,'failed');assert.equal(queue.get(job.id).error,'app_install_requires_inspection');
 }finally{await queue.stop();db.close();}
});
