import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawn,spawnSync} from 'node:child_process';
import {mkdtemp,mkdir,writeFile,readFile,rm,readdir,symlink,link,stat,chmod} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {Readable} from 'node:stream';
import {randomUUID,createHash} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {createServer} from 'node:http';
import {once} from 'node:events';
import Fastify from '../apps/api/node_modules/fastify/fastify.js';
import {encryptMigration,decryptMigration,hashMigrationFile,migrationPassphrase} from '../agent/dist/migration-crypto.js';
import {validateMigrationMetadata,validateMigrationInventory,atomicMigrationJson} from '../agent/dist/migration-engine.js';
import {Migrations,releaseMigrationLock} from '../agent/dist/migrations.js';
import {SiteManager} from '../agent/dist/sites.js';
import {registerMigrations} from '../apps/api/dist/migrations.js';
const id='site_0123456789abcdef',pass='migration passphrase separately stored';
const site={id,user:'dvs_0123456789abcdef',uid:2001,gid:2001,domain:'site.example.test',webServer:'nginx',siteType:'static',state:'ready',createdAt:new Date().toISOString(),revision:1,tls:false,aliases:[]};
const metadata=()=>({format:1,scope:'devone-managed-server',softwareVersion:'1.0.0-alpha.3',sourceCommit:'a'.repeat(40),architecture:'x64',os:'ubuntu-24.04',createdAt:new Date().toISOString(),sourcePanelUrl:'https://old-panel.example.test',sites:[{...site}],databases:[],packages:[],tls:[],redis:false,containerImage:null,settings:{},exclusions:['External DNS and unmanaged software']});
async function root(){return mkdtemp(join(tmpdir(),'devone-migration-test-'));}
async function pack(plan,path){const p=spawn('python3',['scripts/migration-archive.py','pack'],{stdio:['pipe','pipe','pipe']});let error='';p.stderr.on('data',b=>error+=b);const closed=new Promise((resolve,reject)=>{p.on('error',reject);p.on('close',c=>c===0?resolve():reject(Error(error)));});closed.catch(()=>{});p.stdin.end(JSON.stringify(plan));try{const result=await encryptMigration(p.stdout,path,pass);await closed;return result;}catch(e){p.kill('SIGKILL');throw e;}}
function extract(tar,destination){return spawnSync('python3',['scripts/migration-archive.py','extract',tar,destination],{encoding:'utf8',timeout:15000});}
test('streamed migration roundtrip preserves hidden files, private app data, binary files, executable modes and internal symlinks',async()=>{
 const r=await root();try{
  const home=join(r,'home');await mkdir(join(home,'public'),{recursive:true,mode:0o700});await mkdir(join(home,'data'),{mode:0o700});await writeFile(join(home,'public','.env'),'PRIVATE_DATABASE_PASSWORD=keep-me',{mode:0o600});await writeFile(join(home,'public','server.mjs'),'// executable application',{mode:0o750});await writeFile(join(home,'data','key'),Buffer.alloc(32,17),{mode:0o600});const cms=new DatabaseSync(join(home,'data','cms.sqlite'));cms.exec("CREATE TABLE pages(id INTEGER,title TEXT);INSERT INTO pages VALUES(1,'Keep all application content');");cms.close();await writeFile(join(home,'public','binary'),Buffer.from([0,1,2,255,0,254]),{mode:0o640});await symlink('server.mjs',join(home,'public','entry'));
  const control=join(r,'control.devone');await writeFile(control,'nested encrypted control/key bundle',{mode:0o600});
  const archive=join(r,'bundle'),result=await pack({metadata:metadata(),roots:[{source:home,archive:'payload/sites/'+id,uid:process.getuid()},{source:control,archive:'payload/control.devone',uid:process.getuid()}]},archive);assert.equal(result.sha256,await hashMigrationFile(archive));assert.ok(!(await readFile(archive)).includes(Buffer.from('PRIVATE_DATABASE_PASSWORD')));
  const tar=join(r,'decoded.tar');await decryptMigration(archive,tar,pass);const out=extract(tar,join(r,'stage'));assert.equal(out.status,0,out.stderr);
  assert.equal(await readFile(join(r,'stage','payload','sites',id,'public','.env'),'utf8'),'PRIVATE_DATABASE_PASSWORD=keep-me');assert.deepEqual(await readFile(join(r,'stage','payload','sites',id,'data','key')),Buffer.alloc(32,17));assert.equal(await readFile(join(r,'stage','payload','sites',id,'public','entry'),'utf8'),'// executable application');
  const restoredCms=new DatabaseSync(join(r,'stage','payload','sites',id,'data','cms.sqlite'));try{assert.equal(restoredCms.prepare('SELECT title FROM pages').get().title,'Keep all application content');}finally{restoredCms.close();}
  const m=validateMigrationMetadata(JSON.parse(await readFile(join(r,'stage','metadata.json'),'utf8'))),i=JSON.parse(await readFile(join(r,'stage','inventory.json'),'utf8'));validateMigrationInventory(m,i);assert.equal(i.entries.find(e=>e.path.endsWith('server.mjs')).mode,0o750);assert.equal((await stat(join(r,'stage','payload','sites',id,'public','.env'))).mode&0o777,0o600);
 }finally{await rm(r,{recursive:true,force:true});}
});
test('wrong passphrase, changed header/tag/ciphertext and truncated encrypted streams never leave usable plaintext',async()=>{
 const r=await root();try{const path=join(r,'bundle');await encryptMigration(Readable.from([Buffer.alloc(1024*1024,5),Buffer.from('private content')]),path,pass);await assert.rejects(decryptMigration(path,join(r,'wrong'),pass+'wrong'),/unlock_failed/);
  const bytes=await readFile(path);for(const offset of [0,15,37,100,bytes.length-1]){const damaged=Buffer.from(bytes);damaged[offset]^=1;await writeFile(join(r,'bad'),damaged,{mode:0o600});await assert.rejects(decryptMigration(join(r,'bad'),join(r,'plaintext'),pass),/unlock_failed/);assert.ok(!(await readdir(r)).includes('plaintext'));}
  await writeFile(join(r,'short'),bytes.subarray(0,20),{mode:0o600});await assert.rejects(decryptMigration(join(r,'short'),join(r,'plaintext'),pass));assert.ok(!(await readdir(r)).includes('wrong'));
 }finally{await rm(r,{recursive:true,force:true});}
});
test('migration encryption rejects invalid passphrases and cleans failed streaming output',async()=>{
 for(const value of ['',1,'short','x'.repeat(129),'valid long passphrase\n'])assert.equal(migrationPassphrase(value),false);
 const r=await root();try{const bad=new Readable({read(){this.destroy(Error('fixture failure'));}});await assert.rejects(encryptMigration(bad,join(r,'failed'),pass));assert.ok(!(await readdir(r)).includes('failed.partial'));}finally{await rm(r,{recursive:true,force:true});}
});
test('export refuses escaping links, hardlinks, FIFOs and external ownership rather than omit their data',async()=>{
 const r=await root();try{const home=join(r,'site');await mkdir(home,{mode:0o700});const archive=join(r,'bundle'),plan={metadata:metadata(),roots:[{source:home,archive:'payload/sites/'+id,uid:process.getuid()}]};
  await symlink('/etc/passwd',join(home,'escape'));await assert.rejects(pack(plan,archive));await rm(join(home,'escape'));
  await writeFile(join(home,'first'),'data');await link(join(home,'first'),join(home,'hard'));await assert.rejects(pack(plan,archive));await rm(join(home,'first'));await rm(join(home,'hard'));
  const fifo=spawnSync('mkfifo',[join(home,'fifo')]);assert.equal(fifo.status,0);await assert.rejects(pack(plan,archive));
 }finally{await rm(r,{recursive:true,force:true});}
});
test('untrusted tar paths, hardlinks, devices, duplicate members, link ancestors and false manifests are rejected',async()=>{
 const r=await root();try{for(const kind of ['traversal','absolute','hardlink','device','duplicate','escape','ancestor','manifest']){
  const tar=join(r,kind+'.tar');const script=`import io,json,tarfile,sys\nkind=sys.argv[1]\nwith tarfile.open(sys.argv[2],'w') as t:\n b=b'{}';i=tarfile.TarInfo('metadata.json');i.size=len(b);t.addfile(i,io.BytesIO(b))\n n='../outside' if kind=='traversal' else '/tmp/devone-escape' if kind=='absolute' else 'payload/sites/${id}/public/file'\n i=tarfile.TarInfo(n);i.uname='root';i.size=0\n if kind=='hardlink': i.type=tarfile.LNKTYPE;i.linkname='metadata.json'\n if kind=='device': i.type=tarfile.CHRTYPE\n if kind in ('escape','ancestor'): i.type=tarfile.SYMTYPE;i.linkname='../../../../outside' if kind=='escape' else 'internal'\n t.addfile(i,io.BytesIO(b''))\n if kind=='duplicate': t.addfile(i,io.BytesIO(b''))\n if kind=='ancestor':\n  j=tarfile.TarInfo(n+'/child');j.uname='root';t.addfile(j,io.BytesIO(b''))\n b=b'{"format":1,"entries":[],"bytes":0,"metadataSha256":"bad"}';i=tarfile.TarInfo('manifest.json');i.size=len(b);t.addfile(i,io.BytesIO(b))\n`;
  assert.equal(spawnSync('python3',['-c',script,kind,tar]).status,0);assert.notEqual(extract(tar,join(r,'out-'+kind)).status,0,kind);
 }assert.ok(!(await readdir(r)).includes('outside'));}finally{await rm(r,{recursive:true,force:true});}
});
test('migration inventory requires every private site/database/certificate resource and rejects arbitrary host payloads',()=>{
 const m=metadata();assert.equal(validateMigrationMetadata(m),m);
 for(const bad of [{...m,architecture:'arm64'},{...m,packages:['curl;rm']},{...m,sites:[site,site]},{...m,redis:true},{...m,settings:{DEVONE_AGENT_TOKEN:'not-migratable'}},{...m,tls:[{siteId:id,account:'invalid',server:'evil',keyType:'rsa'}]}])assert.throws(()=>validateMigrationMetadata(bad));
 const entries=[{path:'payload/control.devone',type:'file',mode:0o600,owner:'root',mtime:1792828800,size:1,sha256:'a'.repeat(64)},{path:'payload/sites/'+id,type:'directory',mode:0o750,owner:'root',mtime:1792828800,size:0,sha256:''},{path:'payload/sites/'+id+'/public',type:'directory',mode:0o750,owner:'site',mtime:1792828800,size:0,sha256:''}];
 validateMigrationInventory(m,{bytes:1,entries});assert.throws(()=>validateMigrationInventory(m,{bytes:1,entries:entries.slice(0,2)}));assert.throws(()=>validateMigrationInventory(m,{bytes:1,entries:[...entries,{...entries[0],path:'payload/etc/shadow'}]}));assert.throws(()=>validateMigrationInventory(m,{bytes:1,entries:[...entries,{...entries[0],path:'payload/sites/site_aaaaaaaaaaaaaaaa/file'}]}));
});
test('resumable uploads use bounded chunks, reject mismatches and synchronize interrupted metadata without storing credentials',async()=>{
 const r=await root();try{const m=new Migrations(r),bytes=Buffer.alloc(80,7),upload=await m.createUpload(bytes.length);const value={id:upload.id,offset:0,content:bytes.toString('base64')};assert.equal((await m.uploadChunk(value)).received,80);assert.equal((await m.uploadChunk(value)).received,80);await assert.rejects(m.uploadChunk({...value,content:Buffer.alloc(80,8).toString('base64')}),/conflict/);
  const path=join(r,'uploads',upload.id+'.json'),meta=JSON.parse(await readFile(path,'utf8'));meta.received=0;await atomicMigrationJson(path,meta);assert.equal((await m.uploadChunk(value)).received,80);assert.equal(JSON.parse(await readFile(path,'utf8')).received,80);
  const state=await m.state();assert.equal(state.uploads[0].firstChunkSha256,createHash('sha256').update(bytes).digest('hex'));assert.ok(!JSON.stringify(state).includes('content'));
  await assert.rejects(m.uploadChunk({...value,offset:79}),/invalid/);await assert.rejects(m.uploadChunk({...value,command:'whoami'}),/invalid/);
  await m.createUpload(80);await m.createUpload(80);await assert.rejects(m.createUpload(80),/limit/);await m.remove({id:upload.id,kind:'upload'});assert.ok(!(await m.state()).uploads.some(u=>u.id===upload.id));
 }finally{await rm(r,{recursive:true,force:true});}
});
test('global migration lock excludes admitted host work, persists only safe status and supports repeated interrupted-source recovery',async()=>{
 const r=await root();try{
  const active=new Migrations(r,()=>1,async()=>{});await assert.rejects(active.start({operation:'export',passphrase:pass}),/host_operation_active/);assert.equal(active.locked(),false);
  const launches=[],m=new Migrations(r,()=>0,async(id,b)=>launches.push({id,b}));const job=await m.start({operation:'export',passphrase:pass});assert.equal(m.locked(),true);assert.ok(!(await readFile(join(r,'latest.json'),'utf8')).includes(pass));assert.ok(!(await readFile(join(r,'lock','owner.json'),'utf8')).includes(pass));await assert.rejects(m.createUpload(80),/busy/);await assert.rejects(m.start({operation:'export',passphrase:pass}),/busy/);
  await atomicMigrationJson(join(r,'latest.json'),{...job,state:'needs_inspection'});const recovered=await m.start({operation:'resume',planId:job.id});assert.equal(recovered.operation,'resume');await atomicMigrationJson(join(r,'latest.json'),{...recovered,state:'needs_inspection'});assert.equal((await m.start({operation:'resume',planId:job.id})).operation,'resume');await releaseMigrationLock(r);assert.equal(m.locked(),false);
  assert.equal(launches.length,3);await assert.rejects(m.start({operation:'resume',planId:job.id}),/not_needed/);
 }finally{await rm(r,{recursive:true,force:true});}
});
async function apiFixture(){
 const db=new DatabaseSync(':memory:'),calls=[],audits=[];let locked=false;db.exec('CREATE TABLE users(id TEXT PRIMARY KEY);');
 const agent=createServer(async(req,res)=>{let raw='';for await(const chunk of req)raw+=chunk;calls.push({url:req.url,body:raw?JSON.parse(raw):undefined});res.setHeader('Content-Type','application/json');if(req.url==='/v1/migrations/upload/start')res.end(JSON.stringify({id:'12345678-1234-4123-8123-123456789abc',bytes:80,received:0}));else if(req.url==='/v1/migrations/start')res.end(JSON.stringify({id:randomUUID(),state:'running',operation:JSON.parse(raw).operation}));else if(req.url?.startsWith('/v1/migrations/exports/')){res.setHeader('Content-Type','application/octet-stream');res.end('encrypted archive bytes');}else res.end(JSON.stringify({locked,exports:[],uploads:[],plans:[]}));});agent.listen(0,'127.0.0.1');await once(agent,'listening');
 const app=Fastify();registerMigrations(app,{db,agentUrl:'http://127.0.0.1:'+agent.address().port,agentToken:'test-agent',panelUrl:'https://new-panel.example.test',requestUser:r=>r.headers.role?{id:r.headers.actor??'owner',role:r.headers.role}:null,sameOrigin:r=>r.headers.origin==='https://new-panel.example.test',stepUp:(id,p,mfa)=>p==='correct'?(mfa==='123456'?'ok':'mfa_invalid'):'password_invalid',audit:(...a)=>audits.push(a),maintenance:async()=>locked});app.post('/api/test-write',async()=>({written:true}));app.get('/api/test-read',async()=>({read:true}));
 const headers={role:'owner',origin:'https://new-panel.example.test'},approval={confirmed:true,password:'correct',mfaCode:'123456'};return {app,calls,audits,headers,approval,setLocked:x=>locked=x,post:(url,p,h=headers)=>app.inject({method:'POST',url,payload:p,headers:h}),close:async()=>{await app.close();await new Promise(r=>agent.close(r));db.close();}};
}
test('migration API enforces Owner/origin/password/MFA and explicit scope/downtime/account replacement approvals',async()=>{
 const f=await apiFixture();try{const p={...f.approval,operation:'export',passphrase:pass,passphraseConfirm:pass,acceptScope:true,acceptDowntime:true};
  assert.equal((await f.post('/api/migrations/start',p,{})).statusCode,401);assert.equal((await f.post('/api/migrations/start',p,{...f.headers,role:'admin'})).statusCode,403);assert.equal((await f.post('/api/migrations/start',p,{role:'owner'})).statusCode,403);
  assert.equal((await f.post('/api/migrations/start',{...p,password:'wrong'})).statusCode,403);assert.equal((await f.post('/api/migrations/start',{...p,mfaCode:'wrong'})).statusCode,403);assert.equal((await f.post('/api/migrations/start',{...p,acceptScope:false})).statusCode,400);assert.equal((await f.post('/api/migrations/start',{...p,passphraseConfirm:'different'})).statusCode,400);assert.equal((await f.post('/api/migrations/start',{...p,path:'/etc/shadow'})).statusCode,400);
  const result=await f.post('/api/migrations/start',p);assert.equal(result.statusCode,202,result.body);assert.equal(result.headers['cache-control'],'no-store');assert.ok(!result.body.includes(pass));assert.ok(!JSON.stringify(f.audits).includes(pass));const sent=f.calls.find(c=>c.url==='/v1/migrations/start').body;assert.equal(sent.passphrase,pass);assert.ok(!Object.hasOwn(sent,'password'));assert.ok(!Object.hasOwn(sent,'mfaCode'));
  const apply={...f.approval,operation:'apply',planId:randomUUID(),acceptAccountReplacement:true,confirmTarget:'wrong.example.test'};assert.equal((await f.post('/api/migrations/start',apply)).statusCode,400);
 }finally{await f.close();}
});
test('migration API binds chunk uploads to their approving Owner and keeps normal writes frozen during maintenance',async()=>{
 const f=await apiFixture();try{
  const upload=await f.post('/api/migrations/uploads',{...f.approval,bytes:80});assert.equal(upload.statusCode,201);const id=upload.json().id;
  assert.equal((await f.post('/api/migrations/uploads/chunk',{id,offset:0,content:'eA=='},{...f.headers,actor:'different-owner'})).statusCode,403);assert.equal((await f.post('/api/migrations/uploads/chunk',{id,offset:0,content:'eA=='})).statusCode,200);
  f.setLocked(true);assert.equal((await f.post('/api/test-write',{})).statusCode,409);assert.equal((await f.app.inject({url:'/api/test-read'})).statusCode,200);assert.equal((await f.app.inject({url:'/api/migrations',headers:f.headers})).statusCode,200);
  f.setLocked(false);assert.equal((await f.post('/api/test-write',{})).statusCode,200);
  const download=await f.app.inject({url:'/api/migrations/exports/'+id+'/download',headers:f.headers});assert.equal(download.body,'encrypted archive bytes');assert.match(download.headers['content-disposition'],/devone-migration/);
 }finally{await f.close();}
});
test('migration recreates stable site IDs with destination identities and keeps hosting disabled until activation',async()=>{
 const r=await root(),identities=new Map(),commands=[];
 try{
  const base=join(r,'homes'),nginx=join(r,'nginx');await mkdir(nginx);const manager=new SiteManager({registry:join(r,'registry'),base,nginx,panelDomain:'new-panel.example.test',requireRoot:false,ownership:async()=>{},command:async(binary,args)=>{
   commands.push([binary,args]);if(binary==='useradd'){identities.set(args.at(-1),args[args.indexOf('--home-dir')+1]);return '';}
   if(binary==='getent')return `${args[1]}:x:12001:12002::${identities.get(args[1])}:/usr/sbin/nologin`;
   return '';
  }});
  const record={...site,aliases:['alias.example.test']},created=await manager.migrationCreate(record);assert.equal(created.id,site.id);assert.equal(created.uid,12001);assert.equal(created.gid,12002);assert.notEqual(created.uid,record.uid);assert.equal(created.state,'disabled');assert.match(await readFile(join(nginx,'devone-'+site.id+'.conf'),'utf8'),/return 410/);
  await assert.rejects(manager.migrationCreate(record),/domain_in_use|target_changed/);assert.equal(commands.filter(c=>c[0]==='useradd').length,1);
  await manager.migrationActivate(record);const restored=(await manager.list())[0];assert.equal(restored.state,'ready');assert.deepEqual(restored.aliases,record.aliases);assert.equal(restored.uid,12001);assert.match(await readFile(join(nginx,'devone-'+site.id+'.conf'),'utf8'),/server_name site.example.test alias.example.test;/);
  assert.equal((await manager.migrationInventory())[0].id,site.id);
  await writeFile(join(nginx,'devone-'+site.id+'.conf'),'# custom replacement');await assert.rejects(manager.migrationInventory(),/custom_configuration/);
 }finally{await rm(r,{recursive:true,force:true});}
});
