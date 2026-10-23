import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readdir,readFile,stat,symlink,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {DatabaseManager,databaseSql,databaseRequest} from '../agent/dist/databases.js';
import {DatabaseSync} from 'node:sqlite';
import {JobQueue} from '../apps/api/dist/jobs.js';
import {registerDatabases,databaseSecret} from '../apps/api/dist/databases.js';
import {Vault} from '../apps/api/dist/vault.js';
import Fastify from '../apps/api/node_modules/fastify/fastify.js';
import {createServer} from 'node:http';
import {once} from 'node:events';
const siteId='site_0123456789abcdef',id='db_abcdef0123456789',password='ab'.repeat(32);
test('database inputs cannot supply SQL, paths, usernames, hosts or weak credentials',()=>{
 for(const input of [null,[],{id,siteId,engine:'sqlite',password},{id:'db_x;DROP',siteId,engine:'mariadb',password},{id,siteId,engine:'mariadb',password:'weak'},{id,siteId,engine:'mariadb',password,host:'%'},{id,siteId,engine:'postgresql',password,sql:'DROP DATABASE postgres'}])assert.throws(()=>databaseRequest(input),/invalid_database/);
 for(const engine of ['mariadb','postgresql']){
  const config=databaseSql({id,siteId,engine,password});assert.equal(config.name,'dvabcdef0123456789');assert.ok(!config.sql.includes(password));assert.ok(!config.sql.includes('IF NOT EXISTS'));assert.ok(!config.sql.includes('DROP '));
  if(engine==='mariadb'){assert.match(config.sql,/@'localhost'/);assert.match(config.sql,/ON `dvabcdef0123456789`\.\*/);assert.ok(!config.sql.includes('WITH GRANT OPTION'));assert.ok(!config.sql.includes('ON *.*'));}
  else{assert.match(config.sql,/NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS/);assert.match(config.sql,/SCRAM-SHA-256\$4096:/);assert.match(config.sql,/REVOKE ALL ON DATABASE .* FROM PUBLIC/);}
 }
});
for(const engine of ['mariadb','postgresql'])test(engine+' provisioning verifies app identity and removes temporary credential files',async()=>{
 const registry=await mkdtemp(join(tmpdir(),'devone-db-')),calls=[];let lock=0;
 const manager=new DatabaseManager({registry,requireRoot:false,sites:async()=>[{id:siteId,state:'ready'}],withSite:async(site,work)=>{assert.equal(site,siteId);lock++;try{return await work();}finally{lock--;}},run:async(binary,args,sql,env)=>{
  assert.equal(lock,1);calls.push({binary,args,sql,env});assert.ok(!args.join(' ').includes(password));
  if(/SELECT version\(\)/i.test(sql))return engine==='mariadb'?'10.11.8-MariaDB':'PostgreSQL 16.9';
  if(sql.startsWith('SELECT')){
   const path=engine==='postgresql'?env.PGPASSFILE:args[0].slice('--defaults-file='.length);assert.equal((await stat(path)).mode&0o777,0o600);assert.ok((await readFile(path,'utf8')).includes(password));
   return 'dvabcdef0123456789\tdvabcdef0123456789'+(engine==='mariadb'?'@localhost':'')+'\n';
  }return '';
 }});
 try{
  const created=await manager.create({id,siteId,engine,password});assert.equal(created.state,'ready');assert.ok(created.verifiedAt);assert.equal(calls.length,3);
  assert.deepEqual(await readdir(registry),['databases.json']);assert.ok(!(await readFile(join(registry,'databases.json'),'utf8')).includes(password));
  await assert.rejects(manager.create({id,siteId,engine,password}),/already_recorded/);assert.equal(calls.length,3);
 }finally{await rm(registry,{recursive:true,force:true});}
});
test('partial database creation is retained and never replayed or automatically dropped',async()=>{
 const registry=await mkdtemp(join(tmpdir(),'devone-db-'));let calls=0;
 const options={registry,requireRoot:false,sites:async()=>[{id:siteId,state:'ready'}],run:async()=>{calls++;if(calls===1)return '10.11.8-MariaDB';if(calls===3)throw Error('private database error');return '';}};const manager=new DatabaseManager(options);
 try{
  await assert.rejects(manager.create({id,siteId,engine:'mariadb',password}),/requires_inspection/);assert.equal((await manager.list())[0].state,'needs_inspection');assert.deepEqual(await readdir(registry),['databases.json']);
  const again=new DatabaseManager(options);await assert.rejects(again.create({id,siteId,engine:'mariadb',password}),/already_recorded/);assert.equal(calls,3);
  const path=join(registry,'databases.json'),rows=JSON.parse(await readFile(path,'utf8'));rows[0].state='provisioning';await writeFile(path,JSON.stringify(rows));assert.equal((await again.list())[0].state,'needs_inspection');
 }finally{await rm(registry,{recursive:true,force:true});}
});
test('database registry rejects symlinks and unready sites without running SQL',async()=>{
 const registry=await mkdtemp(join(tmpdir(),'devone-db-'));let calls=0;const manager=new DatabaseManager({registry,requireRoot:false,sites:async()=>[],run:async()=>{calls++;return '';}});
 try{await assert.rejects(manager.create({id,siteId,engine:'postgresql',password}),/not_ready/);assert.equal(calls,0);await symlink('/etc/passwd',join(registry,'databases.json'));await assert.rejects(manager.list());}finally{await rm(registry,{recursive:true,force:true});}
});
test('database jobs store identifiers only and recheck Owner at execution',async()=>{
 const db=new DatabaseSync(':memory:');db.exec("CREATE TABLE users(id TEXT PRIMARY KEY,role TEXT);INSERT INTO users VALUES('admin','admin')");let calls=0;const queue=new JobQueue(db,async()=>{calls++;},()=>{});
 try{const job=queue.enqueue('admin','database_request_key',{id,siteId,engine:'postgresql',password},'database.create');assert.ok(!job.input.includes(password));await queue.idle();assert.equal(calls,0);assert.equal(queue.get(job.id).error,'authorization_revoked');}finally{await queue.stop();db.close();}
});
test('database API requires Owner step-up and preserves request identity with encrypted credentials',async()=>{
 const root=await mkdtemp(join(tmpdir(),'devone-db-api-')),key=join(root,'key');await writeFile(key,Buffer.alloc(32,7),{mode:0o600});
 const db=new DatabaseSync(':memory:');db.exec("CREATE TABLE users(id TEXT PRIMARY KEY,role TEXT);INSERT INTO users VALUES('owner','owner')");const vault=new Vault(db,key),queued=[],audits=[];
 let databaseId;const server=createServer((req,res)=>{res.setHeader('Content-Type','application/json');res.end(JSON.stringify({databases:databaseId?[{id:databaseId,state:'ready',name:'dv'+databaseId.slice(3),username:'dv'+databaseId.slice(3),host:'localhost',engine:'mariadb',siteId}]:[]}));});server.listen(0,'127.0.0.1');await once(server,'listening');
 const app=Fastify();registerDatabases(app,{db,vault,jobs:{enqueue(...args){queued.push(args);return {id:'job'};}},agentUrl:'http://127.0.0.1:'+server.address().port,agentToken:'fixture',requestUser:r=>r.headers.role?{id:'owner',role:r.headers.role}:null,sameOrigin:r=>r.headers.origin==='https://panel.example.com',stepUp:(u,p)=>p==='correct'?'ok':'password_invalid',audit(...a){audits.push(a);}});
 const headers={role:'owner',origin:'https://panel.example.com'},payload={siteId,engine:'mariadb',requestKey:'database_request_key',password:'correct',confirmed:true};
 const post=(p,h=headers,url='/api/databases')=>app.inject({method:'POST',url,headers:h,payload:p});
 try{
  assert.equal((await post(payload,{})).statusCode,401);assert.equal((await post(payload,{...headers,role:'admin'})).statusCode,403);assert.equal((await post(payload,{role:'owner'})).statusCode,403);
  assert.equal((await post({...payload,password:'wrong'})).statusCode,403);assert.equal((await post({...payload,confirmed:false})).statusCode,400);
  const first=await post(payload);assert.equal(first.statusCode,202);databaseId=first.json().databaseId;
  assert.equal((await post(payload)).json().databaseId,databaseId);assert.equal(queued[0][2].id,queued[1][2].id);assert.equal(queued[0][3],'database.create');assert.ok(!JSON.stringify(queued).includes('password'));
  assert.equal((await post({...payload,engine:'postgresql'})).statusCode,409);
  const secret=vault.get(databaseSecret(databaseId));assert.match(secret,/^[a-f0-9]{64}$/);assert.ok(!JSON.stringify(db.prepare('SELECT * FROM secrets').all()).includes(secret));
  const reveal=await post({password:'correct',confirmed:true},headers,'/api/databases/'+databaseId+'/credentials');assert.equal(reveal.statusCode,200);assert.equal(reveal.json().password,secret);assert.equal(reveal.headers['cache-control'],'no-store');assert.ok(!JSON.stringify(audits).includes(secret));
 }finally{await app.close();await new Promise(r=>server.close(r));db.close();await rm(root,{recursive:true,force:true});}
});
test('unsupported engine or admin authentication is rejected before creating objects',async()=>{
 const registry=await mkdtemp(join(tmpdir(),'devone-db-'));let calls=0;
 const manager=new DatabaseManager({registry,requireRoot:false,sites:async()=>[{id:siteId,state:'ready'}],run:async()=>{calls++;return '8.0.40 MySQL';}});
 try{await assert.rejects(manager.create({id,siteId,engine:'mariadb',password}),/engine_unavailable/);assert.equal(calls,1);assert.equal((await manager.list()).length,0);}finally{await rm(registry,{recursive:true,force:true});}
});
