import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,writeFile,rm,readdir} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {DatabaseSync} from 'node:sqlite';
import Fastify from '../apps/api/node_modules/fastify/fastify.js';
import {registerSoundwerks,soundwerksJobPayload} from '../apps/api/dist/soundwerks.js';
import {Vault} from '../apps/api/dist/vault.js';
import {JobQueue} from '../apps/api/dist/jobs.js';
import {SiteManager} from '../agent/dist/sites.js';
import {SiteFiles} from '../agent/dist/site-files.js';
import {soundwerksRelease,soundwerksInput} from '../agent/dist/soundwerks-release.js';

const credentials={id:'app_0123456789abcdef',databaseId:'db_0123456789abcdef',
 databasePassword:'ab'.repeat(32),adminUsername:'creative_admin',
 adminPassword:'CreativeAdminPassword1234!',domain:'media.example.com',
 title:'Creative Soundwerks',email:'owner@example.com'};
test('fixed Creative Soundwerks source and strict host input',()=>{
 assert.match(soundwerksRelease.commit,/^[a-f0-9]{40}$/);
 assert.equal(soundwerksInput(credentials).id,credentials.id);
 for(const extra of [{customRepository:'https://example.com'},{installScript:'other'}, {adminPassword:'weak'},{databasePassword:'bad'}]){
  assert.throws(()=>soundwerksInput({...credentials,...extra}));
 }
});
test('Owner approval and Vault isolation for Soundwerks installation',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'csw-api-'));
 const secret=join(dir,'key');await writeFile(secret,Buffer.alloc(32,4),{mode:0o600});
 const db=new DatabaseSync(':memory:');
 db.exec("CREATE TABLE users(id TEXT PRIMARY KEY,role TEXT);INSERT INTO users VALUES('owner','owner')");
 const vault=new Vault(db,secret),queue=new JobQueue(db,async()=>{},()=>{});
 const app=Fastify();
 registerSoundwerks(app,{db,vault,jobs:queue,agentUrl:'http://127.0.0.1:1',agentToken:'test',
  requestUser:r=>r.headers.role?{id:'owner',role:r.headers.role}:null,
  sameOrigin:r=>r.headers.origin==='https://panel.example.com',
  stepUp:(id,p,m)=>p==='correct'&&m==='123456'?'ok':'password_invalid',
  audit:()=>{}});
 const header={role:'owner',origin:'https://panel.example.com'};
 const body={domain:credentials.domain,title:credentials.title,email:credentials.email,
  adminUsername:credentials.adminUsername,adminPassword:credentials.adminPassword,
  adminPasswordConfirm:credentials.adminPassword,requestKey:'soundwerks_request_123456',
  password:'correct',mfaCode:'123456',confirmed:true};
 const post=(value,headers=header)=>app.inject({method:'POST',url:'/api/apps/soundwerks/install',headers,payload:value});
 try{
  assert.equal((await post(body,{})).statusCode,401);
  assert.equal((await post(body,{...header,role:'admin'})).statusCode,403);
  assert.equal((await post(body,{role:'owner'})).statusCode,403);
  assert.equal((await post({...body,confirmed:false})).statusCode,400);
  assert.equal((await post({...body,password:'incorrect'})).statusCode,403);
  assert.equal((await post({...body,adminPassword:'weak',adminPasswordConfirm:'weak'})).statusCode,400);
  const response=await post(body);assert.equal(response.statusCode,202,response.body);
  const data=response.json();await queue.idle();
  const value=soundwerksJobPayload(db,vault,data.installationId);
  assert.equal(value.adminPassword,body.adminPassword);
  assert.equal(value.databasePassword.length,64);
  assert.deepEqual(JSON.parse(queue.get(data.job.id).input),{id:data.installationId});
  assert.equal((await post(body)).json().installationId,data.installationId);
  assert.equal((await post({...body,title:'Another title'})).statusCode,409);
  assert.ok(!JSON.stringify(db.prepare('SELECT * FROM soundwerks_requests').all()).includes(body.adminPassword));
 }finally{await app.close();await queue.stop();db.close();await rm(dir,{recursive:true,force:true});}
});
test('SiteManager uses isolated site and preserves failed installs',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'csw-sites-')),identities=new Map();
 const options={base:join(dir,'sites'),registry:join(dir,'registry'),
  nginx:join(dir,'nginx'),nodeUnitDir:join(dir,'units'),panelDomain:'panel.example.com',
  requireRoot:false,ownership:async()=>{},command:async(c,a)=>{
   if(c==='useradd')identities.set(a.at(-1),a[a.indexOf('--home-dir')+1]);
   if(c==='getent')return a[1]+':x:1000:1000::'+identities.get(a[1])+':/usr/sbin/nologin';
   if(c==='node')return 'v22.16.0';
   if(c==='systemctl'&&a[0]==='is-active')return 'inactive';
   return '';
  },worker:async(site)=>new SiteFiles(join(options.base,site.id,'public')).list(''),
  soundwerksWorker:async(site,stage,data)=>{
   await writeFile(join(stage,'server.mjs'),'installed');
   await writeFile(join(data,'.env'),'DATABASE_URL=test',{mode:0o600});
  },soundwerksBootstrap:async()=>{},soundwerksHealth:async()=>{}};
 await mkdir(options.nginx);await mkdir(options.nodeUnitDir);
 const manager=new SiteManager(options);
 try{
  const result=await manager.installSoundwerks(credentials,{prepare:async()=>{},database:async()=>({state:'ready'})});
  assert.equal(result.appId,'creative-soundwerks');
  const [site]=await manager.list();
  assert.equal(site.state,'ready');assert.equal(site.application.stage,'complete');
  assert.equal(site.application.databaseId,credentials.databaseId);
  assert.equal(await readFile(join(options.base,site.id,'public/server.mjs'),'utf8'),'installed');
  const unit=await readFile(join(options.nodeUnitDir,'devone-'+site.id+'.service'),'utf8');
  assert.match(unit,/CSW_CONFIG_PATH/);
  assert.ok(unit.includes(join(options.base,site.id,'data')));
  await assert.rejects(manager.installSoundwerks(credentials,{prepare:async()=>{},database:async()=>{}}),/already_recorded/);
 }finally{await rm(dir,{recursive:true,force:true});}
});
