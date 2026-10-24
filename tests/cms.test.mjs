import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm,readdir} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {DatabaseSync} from 'node:sqlite';
import {createServer} from 'node:http';
import {once} from 'node:events';
import Fastify from '../apps/api/node_modules/fastify/fastify.js';
import {registerCms,cmsJobPayload,cmsSecret} from '../apps/api/dist/cms.js';
import {Vault} from '../apps/api/dist/vault.js';
import {JobQueue} from '../apps/api/dist/jobs.js';
import {SiteManager} from '../agent/dist/sites.js';
import {SiteFiles} from '../agent/dist/site-files.js';
import {cmsInput,cmsRelease} from '../agent/dist/cms-release.js';
const input={id:'app_0123456789abcdef',adminPassword:'cd'.repeat(32),domain:'cms.example.com',title:'My website',email:'admin@example.com'};
test('CMS inputs cannot choose an artifact, command, storage path or credentials policy',()=>{
 assert.equal(cmsInput(input).id,input.id);
 for(const b of [null,[],{...input,version:'latest'},{...input,adminPassword:'weak'},{...input,dataDir:'/etc'},{...input,title:'<?php evil'},{...input,siteId:'site_0123456789abcdef',expectedRevision:1}])assert.throws(()=>cmsInput(b));
});
test('CMS API protects approvals, durable identity, vault credentials and HTTPS reveal',async()=>{
 const root=await mkdtemp(join(tmpdir(),'devone-wp-api-')),key=join(root,'key');await writeFile(key,Buffer.alloc(32,9),{mode:0o600});
 const db=new DatabaseSync(':memory:');db.exec("CREATE TABLE users(id TEXT PRIMARY KEY,role TEXT);INSERT INTO users VALUES('owner','owner')");
 const queue=new JobQueue(db,async()=>{},()=>{}),vault=new Vault(db,key);let site;const audits=[];
 const server=createServer((req,res)=>{res.setHeader('Content-Type','application/json');res.end(JSON.stringify({sites:site?[site]:[]}));});server.listen(0,'127.0.0.1');await once(server,'listening');
 const app=Fastify();registerCms(app,{db,vault,jobs:queue,agentUrl:'http://127.0.0.1:'+server.address().port,agentToken:'fixture',requestUser:r=>r.headers.role?{id:r.headers.actor??'owner',role:r.headers.role}:null,sameOrigin:r=>r.headers.origin==='https://panel.example.com',stepUp:(id,p,m)=>p==='correct'&&m==='123456'?'ok':'password_invalid',audit(...args){audits.push(args);}});
 const headers={role:'owner',origin:'https://panel.example.com'},body={domain:input.domain,title:input.title,email:input.email,adminUsername:'chosen_admin',adminPassword:'Chosen!Password-2026🔐',adminPasswordConfirm:'Chosen!Password-2026🔐',deployment:'local',requestKey:'cms_request_1234',password:'correct',mfaCode:'123456',confirmed:true};
 const post=(b,h=headers,url='/api/apps/devone-cms/install')=>app.inject({method:'POST',url,headers:h,payload:b});
 try{
  for(const [b,h,status] of [[body,{},401],[body,{...headers,role:'admin'},403],[body,{role:'owner'},403],[{...body,confirmed:false},headers,400],[{...body,artifact:'evil'},headers,400],[{...body,password:'wrong'},headers,403]])assert.equal((await post(b,h)).statusCode,status);
  for(const invalid of [{...body,adminUsername:''},{...body,adminPassword:'short',adminPasswordConfirm:'short'},{...body,adminPasswordConfirm:'different'}])assert.equal((await post(invalid)).statusCode,400);
  assert.equal((await post({...body,deployment:'cloudflare'})).statusCode,400);
  const result=await post(body);assert.equal(result.statusCode,202);const data=result.json();await queue.idle();
  assert.equal((await post(body)).json().installationId,data.installationId);
  assert.equal((await post({...body,title:'Changed'})).statusCode,409);
  assert.equal((await post({...body,adminPassword:'Another!Password-2026',adminPasswordConfirm:'Another!Password-2026'})).statusCode,409);
  const payload=cmsJobPayload(db,vault,data.installationId);assert.equal(payload.adminPassword,body.adminPassword);assert.equal(payload.adminUsername,'chosen_admin');
  const job=queue.get(data.job.id);assert.deepEqual(JSON.parse(job.input),{id:data.installationId});assert.ok(!JSON.stringify(db.prepare('SELECT * FROM cms_requests').all()).includes(payload.adminPassword));
  assert.ok(!JSON.stringify(db.prepare('SELECT * FROM secrets').all()).includes(payload.adminPassword));
  const url='/api/apps/devone-cms/'+data.installationId+'/credentials',approval={password:'correct',mfaCode:'123456',confirmed:true};
  assert.equal((await post(approval,{...headers,actor:"owner2"},url)).statusCode,409);
  site={id:'site_0123456789abcdef',domain:input.domain,state:'ready',tls:false,application:{id:data.installationId,appId:'devone-cms-v2',stage:'complete'}};
  assert.equal((await post(approval,{...headers,actor:"owner2"},url)).json().error,'cms_https_required');
  site.tls=true;const reveal=await post(approval,{...headers,actor:"owner2"},url);assert.equal(reveal.statusCode,200);assert.equal(reveal.json().username,body.adminUsername);assert.equal(reveal.json().password,vault.get(cmsSecret(data.installationId)));assert.equal(reveal.headers['cache-control'],'no-store');assert.equal(audits[0][1],'cms.credentials_revealed');
  const previous=db.prepare('SELECT metadata FROM cms_requests WHERE id=?').get(data.installationId).metadata;
  const legacy=JSON.parse(previous);delete legacy.adminUsername;delete legacy.deployment;
  db.prepare('UPDATE cms_requests SET metadata=? WHERE id=?').run(JSON.stringify(legacy),data.installationId);
  assert.equal((await post(approval,{...headers,actor:'owner2'},url)).json().username,'devone_admin');
  assert.equal(vault.get(cmsSecret(data.installationId)),body.adminPassword);
  assert.equal((await app.inject({url:'/api/apps/devone-cms',headers})).json().installations.length,1);
 }finally{await app.close();await queue.stop();db.close();server.closeAllConnections();await new Promise(r=>server.close(r));await rm(root,{recursive:true,force:true});}
});
test('CMS jobs recheck Owner and never persist injected secrets',async()=>{
 const db=new DatabaseSync(':memory:');db.exec("CREATE TABLE users(id TEXT PRIMARY KEY,role TEXT);INSERT INTO users VALUES('admin','admin')");let called=false;const q=new JobQueue(db,async()=>{called=true;},()=>{});
 try{const j=q.enqueue('admin','cms_request_key_1234',{id:input.id,adminPassword:input.adminPassword},'cms.install');await q.idle();assert.equal(called,false);assert.equal(q.get(j.id).error,'authorization_revoked');assert.deepEqual(JSON.parse(j.input),{id:input.id});}finally{await q.stop();db.close();}
});
for(const scenario of ['success','worker-failure','health-failure','unit-changed','data-exists'])test('CMS staged installation: '+scenario,async()=>{
 const root=await mkdtemp(join(tmpdir(),'devone-cms-site-')),identities=new Map();
 const options={base:join(root,'sites'),registry:join(root,'registry'),nginx:join(root,'nginx'),nodeUnitDir:join(root,'units'),panelDomain:'panel.example.com',requireRoot:false,ownership:async()=>{},command:async(c,a)=>{
  if(c==='useradd')identities.set(a.at(-1),a[a.indexOf('--home-dir')+1]);if(c==='getent')return `${a[1]}:x:1000:1000::${identities.get(a[1])}:/usr/sbin/nologin`;
  if(c==='node')return 'v22.16.0';if(c==='systemctl'&&a[0]==='is-active')return 'inactive';return '';
 },worker:async(site)=>new SiteFiles(join(options.base,site.id,'public')).list(''),cmsWorker:async(site,stage,data)=>{
  assert.deepEqual(await readdir(join(options.base,site.id,'public')),[]);await writeFile(join(stage,'server.mjs'),'installed');await writeFile(join(data,'devone.sqlite'),'retained');if(scenario==='worker-failure')throw Error('private');
 },cmsHealth:async()=>{if(scenario==='health-failure')throw Error('private');}};
 await mkdir(options.nginx);await mkdir(options.nodeUnitDir);const manager=new SiteManager(options);
 try{
  let target=input,changedPath,original;
  if(['unit-changed','data-exists'].includes(scenario)){
   const existing=await manager.create({domain:input.domain,webServer:'nginx',siteType:'node',runtimeVersion:'22'});target={...input,domain:undefined,siteId:existing.id,expectedRevision:1};
   if(scenario==='unit-changed'){changedPath=join(options.nodeUnitDir,'devone-'+existing.id+'.service');original=(await readFile(changedPath,'utf8'))+'# manual\n';await writeFile(changedPath,original);}
   else{await mkdir(join(options.base,existing.id,'data'));await writeFile(join(options.base,existing.id,'data/existing'),'preserve');}
  }
  if(scenario==='success'){
   const result=await manager.installCms(target);assert.equal(result.version,cmsRelease.version);const [site]=await manager.list();assert.equal(site.state,'ready');assert.equal(site.application.stage,'complete');assert.equal(await readFile(join(options.base,site.id,'public/server.mjs'),'utf8'),'installed');
   const unit=await readFile(join(options.nodeUnitDir,'devone-'+site.id+'.service'),'utf8');assert.ok(unit.includes(join(options.base,site.id,'data')));await assert.rejects(manager.installCms(target),/already_recorded/);
  }else if(['unit-changed','data-exists'].includes(scenario)){
   await assert.rejects(manager.installCms(target),new RegExp(scenario==='unit-changed'?'cms_runtime_config_changed':'cms_private_data_exists'));
   if(changedPath)assert.equal(await readFile(changedPath,'utf8'),original);
  }else{
   await assert.rejects(manager.installCms(target),{message:'cms_install_requires_inspection'});const [site]=await manager.list();assert.equal(site.state,'needs_inspection');assert.deepEqual(await readdir(join(options.base,site.id,'public')),[]);assert.equal(await readFile(join(options.base,site.id,'data/devone.sqlite'),'utf8'),'retained');assert.equal(await readFile(join(options.base,site.id,'.cms-'+input.id,'server.mjs'),'utf8'),'installed');
  }
 }finally{await rm(root,{recursive:true,force:true});}
});
