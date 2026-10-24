import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm,readdir} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {DatabaseSync} from 'node:sqlite';
import {createServer} from 'node:http';
import {once} from 'node:events';
import Fastify from '../apps/api/node_modules/fastify/fastify.js';
import {registerWordPress,wordpressJobPayload,wordpressSecret} from '../apps/api/dist/wordpress.js';
import {Vault} from '../apps/api/dist/vault.js';
import {JobQueue} from '../apps/api/dist/jobs.js';
import {SiteManager} from '../agent/dist/sites.js';
import {SiteFiles} from '../agent/dist/site-files.js';
import {wordpressInput,wordpressRelease} from '../agent/dist/wordpress-release.js';
const input={id:'app_0123456789abcdef',databaseId:'db_0123456789abcdef',databasePassword:'ab'.repeat(32),adminPassword:'cd'.repeat(32),domain:'wordpress.example.com',title:'My website',email:'admin@example.com'};
test('WordPress requests cannot choose artifact, command, SQL or weak credentials',()=>{
 assert.equal(wordpressInput(input).id,input.id);
 for(const b of [null,[],{...input,url:'https://evil.test'},{...input,databasePassword:'weak'},{...input,title:'<?php evil'},{...input,email:'x\n@example.com'},{...input,siteId:'site_0123456789abcdef',expectedRevision:1},{...input,domain:'-bad.example.com'},{...input,command:'id'}])assert.throws(()=>wordpressInput(b));
});
test('WordPress API protects approvals, durable identity, vault credentials and HTTPS reveal',async()=>{
 const root=await mkdtemp(join(tmpdir(),'devone-wp-api-')),key=join(root,'key');await writeFile(key,Buffer.alloc(32,9),{mode:0o600});
 const db=new DatabaseSync(':memory:');db.exec("CREATE TABLE users(id TEXT PRIMARY KEY,role TEXT);INSERT INTO users VALUES('owner','owner')");
 const queue=new JobQueue(db,async()=>{},()=>{}),vault=new Vault(db,key);let site;const audits=[];
 const server=createServer((req,res)=>{res.setHeader('Content-Type','application/json');res.end(JSON.stringify({sites:site?[site]:[]}));});server.listen(0,'127.0.0.1');await once(server,'listening');
 const app=Fastify();registerWordPress(app,{db,vault,jobs:queue,agentUrl:'http://127.0.0.1:'+server.address().port,agentToken:'fixture',requestUser:r=>r.headers.role?{id:r.headers.actor??'owner',role:r.headers.role}:null,sameOrigin:r=>r.headers.origin==='https://panel.example.com',stepUp:(id,p,m)=>p==='correct'&&m==='123456'?'ok':'password_invalid',audit(...args){audits.push(args);}});
 const headers={role:'owner',origin:'https://panel.example.com'},body={domain:input.domain,title:input.title,email:input.email,adminUsername:'chosen_admin',adminPassword:'Chosen!Password-2026🔐',adminPasswordConfirm:'Chosen!Password-2026🔐',requestKey:'wordpress_request_1234',password:'correct',mfaCode:'123456',confirmed:true};
 const post=(b,h=headers,url='/api/apps/wordpress/install')=>app.inject({method:'POST',url,headers:h,payload:b});
 try{
  for(const [b,h,status] of [[body,{},401],[body,{...headers,role:'admin'},403],[body,{role:'owner'},403],[{...body,confirmed:false},headers,400],[{...body,artifact:'evil'},headers,400],[{...body,password:'wrong'},headers,403]])assert.equal((await post(b,h)).statusCode,status);
  for(const invalid of [{...body,adminUsername:''},{...body,adminPassword:'short',adminPasswordConfirm:'short'},{...body,adminPasswordConfirm:'different'}])assert.equal((await post(invalid)).statusCode,400);
  const result=await post(body);assert.equal(result.statusCode,202);const data=result.json();await queue.idle();
  assert.equal((await post(body)).json().installationId,data.installationId);
  assert.equal((await post({...body,title:'Changed'})).statusCode,409);
  assert.equal((await post({...body,adminPassword:'Another!Password-2026',adminPasswordConfirm:'Another!Password-2026'})).statusCode,409);
  const payload=wordpressJobPayload(db,vault,data.installationId);assert.equal(payload.adminPassword,body.adminPassword);assert.equal(payload.adminUsername,'chosen_admin');assert.notEqual(payload.adminPassword,payload.databasePassword);
  const job=queue.get(data.job.id);assert.deepEqual(JSON.parse(job.input),{id:data.installationId});assert.ok(!JSON.stringify(db.prepare('SELECT * FROM wordpress_requests').all()).includes(payload.adminPassword));
  assert.ok(!JSON.stringify(db.prepare('SELECT * FROM secrets').all()).includes(payload.adminPassword));
  const url='/api/apps/wordpress/'+data.installationId+'/credentials',approval={password:'correct',mfaCode:'123456',confirmed:true};
  assert.equal((await post(approval,{...headers,actor:"owner2"},url)).statusCode,409);
  site={id:'site_0123456789abcdef',domain:input.domain,state:'ready',tls:false,application:{id:data.installationId,appId:'wordpress',stage:'complete'}};
  assert.equal((await post(approval,{...headers,actor:"owner2"},url)).json().error,'wordpress_https_required');
  site.tls=true;const reveal=await post(approval,{...headers,actor:"owner2"},url);assert.equal(reveal.statusCode,200);assert.equal(reveal.json().username,body.adminUsername);assert.equal(reveal.json().password,vault.get(wordpressSecret(data.installationId)));assert.equal(reveal.headers['cache-control'],'no-store');assert.equal(audits[0][1],'wordpress.credentials_revealed');
  const previous=db.prepare('SELECT metadata FROM wordpress_requests WHERE id=?').get(data.installationId).metadata;
  const legacy=JSON.parse(previous);delete legacy.adminUsername;delete legacy.deployment;
  db.prepare('UPDATE wordpress_requests SET metadata=? WHERE id=?').run(JSON.stringify(legacy),data.installationId);
  assert.equal((await post(approval,{...headers,actor:'owner2'},url)).json().username,'devone_admin');
  assert.equal(vault.get(wordpressSecret(data.installationId)),body.adminPassword);
  assert.equal((await app.inject({url:'/api/apps/wordpress',headers})).json().installations.length,1);
 }finally{await app.close();await queue.stop();db.close();server.closeAllConnections();await new Promise(r=>server.close(r));await rm(root,{recursive:true,force:true});}
});
test('WordPress jobs recheck Owner and never persist injected secrets',async()=>{
 const db=new DatabaseSync(':memory:');db.exec("CREATE TABLE users(id TEXT PRIMARY KEY,role TEXT);INSERT INTO users VALUES('admin','admin')");let called=false;const q=new JobQueue(db,async()=>{called=true;},()=>{});
 try{const j=q.enqueue('admin','wordpress_request_key',{id:input.id,adminPassword:input.adminPassword},'wordpress.install');await q.idle();assert.equal(called,false);assert.equal(q.get(j.id).error,'authorization_revoked');assert.deepEqual(JSON.parse(j.input),{id:input.id});}finally{await q.stop();db.close();}
});
for(const scenario of ['success','worker-failure','health-failure','config-changed'])test('WordPress staging and rollback: '+scenario,async()=>{
 const root=await mkdtemp(join(tmpdir(),'devone-wp-site-')),identities=new Map();let database=0,prepared=0;
 const options={base:join(root,'sites'),registry:join(root,'registry'),nginx:join(root,'nginx'),phpPoolDir:join(root,'pools'),panelDomain:'panel.example.com',requireRoot:false,ownership:async()=>{},command:async(c,a)=>{
  if(c==='useradd')identities.set(a.at(-1),a[a.indexOf('--home-dir')+1]);
  if(c==='getent')return `${a[1]}:x:1000:1000::${identities.get(a[1])}:/usr/sbin/nologin`;
  if(c==='systemctl')return 'active';return '';
 },worker:async(site,r)=>new SiteFiles(join(options.base,site.id,'public')).list(''),wordpressWorker:async(site,stage)=>{assert.deepEqual(await readdir(join(options.base,site.id,'public')),[]);await writeFile(join(stage,'index.php'),'installed');if(scenario==='worker-failure')throw Error('sensitive');},wordpressHealth:async()=>{if(scenario==='health-failure')throw Error('sensitive');}};
 await mkdir(options.nginx);await mkdir(options.phpPoolDir);const manager=new SiteManager(options),deps={prepare:async()=>{prepared++;},database:async()=>{database++;}};
 let target=input,changedPath;
 if(scenario==='config-changed'){
  const existing=await manager.create({domain:input.domain,webServer:'nginx',siteType:'php',runtimeVersion:'8.3'});
  changedPath=join(options.nginx,'devone-'+existing.id+'.conf');await writeFile(changedPath,(await readFile(changedPath,'utf8'))+'# manual change\n');
  target={...input,domain:undefined,siteId:existing.id,expectedRevision:1};
 }
 try{
  if(scenario==='success'){
   const result=await manager.installWordPress(input,deps);const [site]=await manager.list();assert.equal(site.state,'ready');assert.equal(site.application.stage,'complete');assert.equal(result.version,wordpressRelease.version);assert.equal(await readFile(join(options.base,site.id,'public/index.php'),'utf8'),'installed');
   await assert.rejects(manager.installWordPress(input,deps),/already_recorded/);
   await assert.rejects(manager.installWordPress({...input,id:'app_ffffffffffffffff',domain:undefined,siteId:site.id,expectedRevision:site.revision},deps),/incompatible/);
  }else{
   await assert.rejects(manager.installWordPress(target,deps),{message:'wordpress_install_requires_inspection'});const [site]=await manager.list();assert.equal(site.state,'needs_inspection');assert.deepEqual(await readdir(join(options.base,site.id,'public')),[]);assert.equal(await readFile(join(options.base,site.id,'.wordpress-'+input.id,'index.php'),'utf8'),'installed');
  }
  if(changedPath)assert.ok((await readFile(changedPath,'utf8')).endsWith('# manual change\n'));
  assert.equal(database,1);assert.equal(prepared,1);
 }finally{await rm(root,{recursive:true,force:true});}
});

test('acknowledged WordPress prerequisite/target failures keep safe actionable job errors',async()=>{
 const {assertAgentMutationResult}=await import('../apps/api/dist/job-agent-result.js');
 for(const error of ['software_install_requires_inspection','site_provisioning_requires_inspection','domain_in_use','site_limit']){
  const response=new Response(JSON.stringify({error,stderr:'private diagnostic'}),{status:error.includes('inspection')?503:409});
  await assert.rejects(assertAgentMutationResult(response,'wordpress.install'),{name:'Error',message:error});
 }
});
