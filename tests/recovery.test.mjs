import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {randomBytes,scryptSync} from 'node:crypto';
import {mkdtemp,writeFile,readFile,readdir,rm,stat,chmod,symlink,mkdir} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {spawnSync} from 'node:child_process';
import Fastify from '../apps/api/node_modules/fastify/fastify.js';
import {Vault} from '../apps/api/dist/vault.js';
import {MfaService,totpAt} from '../apps/api/dist/mfa.js';
import {createRecoveryBundle,restoreRecoveryBundle,drillRecoveryBundle,readPrivateFile,privateDirectory,validRecoveryPassphrase,maxBundleBytes} from '../apps/api/dist/recovery.js';
import {registerRecoveryBackups} from '../apps/api/dist/recovery-backups.js';
const passphrase='a separate recovery passphrase 2026',secret='saved-provider-key-only-inside-vault';
async function fixture(){
 const root=await mkdtemp(join(tmpdir(),'devone-recovery-test-')),keyPath=join(root,'key'),db=new DatabaseSync(join(root,'live.sqlite'));
 await writeFile(keyPath,randomBytes(32),{mode:0o600});
 const salt=randomBytes(16),hash=scryptSync('original-owner-password',salt,64);
 db.exec(`PRAGMA journal_mode=WAL;PRAGMA foreign_keys=ON;
 CREATE TABLE users(id TEXT PRIMARY KEY,role TEXT,email TEXT,password_hash TEXT);
 CREATE TABLE sessions(id_hash TEXT PRIMARY KEY,user_id TEXT REFERENCES users(id));
 CREATE TABLE jobs(id TEXT PRIMARY KEY,state TEXT,error TEXT,finished_at TEXT);
 CREATE TABLE audit_log(id INTEGER PRIMARY KEY,action TEXT);
 INSERT INTO jobs VALUES('queued','queued',NULL,NULL),('running','running',NULL,NULL),('done','succeeded',NULL,NULL);`);
 db.prepare('INSERT INTO users VALUES(?,?,?,?)').run('owner','owner','owner@example.com','scrypt:'+salt.toString('hex')+':'+hash.toString('hex'));
 db.exec("INSERT INTO sessions VALUES('still-active','owner')");
 const vault=new Vault(db,keyPath);vault.put('gemini.api_key',secret,'owner');
 const mfa=new MfaService(db,keyPath),setup=mfa.begin('owner','owner@example.com');mfa.confirm('owner',totpAt(setup.manualKey,Math.floor(Date.now()/30000)));
 return {root,keyPath,db,vault,close:async()=>{db.close();await rm(root,{recursive:true,force:true});}};
}
test('encrypted control recovery restores real SQLite, Owner password hash, vault and MFA; sessions and queued mutations are quarantined',async()=>{
 const f=await fixture();try{
  const {bundle,sha256}=await createRecoveryBundle(f.db,f.keyPath,passphrase,f.root);
  assert.match(sha256,/^[a-f0-9]{64}$/);assert.ok(!bundle.includes(Buffer.from(secret)));assert.ok(!bundle.includes(await readFile(f.keyPath)));assert.ok(!bundle.includes(Buffer.from('owner@example.com')));
  f.db.exec("UPDATE users SET email='changed@example.com'");
  const target=join(f.root,'restored'),result=await restoreRecoveryBundle(bundle,passphrase,target);
  assert.equal(result.activated,false);assert.equal(result.secrets,1);assert.equal(result.mfaAccounts,1);assert.equal(result.sessionsInvalidated,true);
  const restored=new DatabaseSync(join(target,'control.sqlite'));
  try{
   assert.equal(restored.prepare('SELECT email FROM users').get().email,'owner@example.com');
   const [,salt,hash]=restored.prepare('SELECT password_hash FROM users').get().password_hash.split(':');assert.equal(scryptSync('original-owner-password',Buffer.from(salt,'hex'),64).toString('hex'),hash);
   assert.equal(new Vault(restored,join(target,'vault.key')).get('gemini.api_key'),secret);
   assert.equal(restored.prepare('SELECT COUNT(*) AS n FROM sessions').get().n,0);
   assert.equal(restored.prepare("SELECT COUNT(*) AS n FROM jobs WHERE state='interrupted' AND error='recovery_requires_review'").get().n,2);
   assert.equal(restored.prepare("SELECT state FROM jobs WHERE id='done'").get().state,'succeeded');
   assert.equal(new MfaService(restored,join(target,'vault.key')).status('owner').enabled,true);
  }finally{restored.close();}
  assert.equal(f.db.prepare('SELECT email FROM users').get().email,'changed@example.com');assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM sessions').get().n,1);assert.equal(f.db.prepare("SELECT state FROM jobs WHERE id='queued'").get().state,'queued');
  for(const name of ['control.sqlite','vault.key','recovery.json'])assert.equal((await stat(join(target,name))).mode&0o777,0o600);
  assert.equal((await stat(target)).mode&0o777,0o700);
 }finally{await f.close();}
});
test('restore drills leave live records unchanged and remove temporary database/key copies',async()=>{
 const f=await fixture();try{
  const {bundle}=await createRecoveryBundle(f.db,f.keyPath,passphrase,f.root),before=await readdir(f.root);
  const result=await drillRecoveryBundle(bundle,passphrase,f.root);assert.equal(result.owners,1);assert.deepEqual(await readdir(f.root),before);assert.equal(f.vault.get('gemini.api_key'),secret);
  await assert.rejects(drillRecoveryBundle(bundle,'wrong recovery passphrase',f.root),/unlock_failed/);assert.deepEqual(await readdir(f.root),before);
 }finally{await f.close();}
});
test('wrong passwords, damaged ciphertext/header/tag and truncated archives cannot create a restored directory',async()=>{
 const f=await fixture();try{
  const {bundle}=await createRecoveryBundle(f.db,f.keyPath,passphrase,f.root);
  await assert.rejects(restoreRecoveryBundle(bundle,'incorrect recovery password',join(f.root,'wrong')),/unlock_failed/);
  for(const offset of [0,15,35,50,bundle.length-1]){const bad=Buffer.from(bundle);bad[offset]^=1;await assert.rejects(restoreRecoveryBundle(bad,passphrase,join(f.root,'damaged')));}
  await assert.rejects(restoreRecoveryBundle(bundle.subarray(0,20),passphrase,join(f.root,'short')));
  assert.ok(!(await readdir(f.root)).some(n=>['wrong','damaged','short'].includes(n)));
 }finally{await f.close();}
});
test('recovery refuses existing destinations, linked files/directories, public permissions and mismatched vault keys',async()=>{
 const f=await fixture();try{
  const {bundle}=await createRecoveryBundle(f.db,f.keyPath,passphrase,f.root);
  const destination=join(f.root,'existing');await mkdir(destination,{mode:0o700});await writeFile(join(destination,'keep'),'original');
  await assert.rejects(restoreRecoveryBundle(bundle,passphrase,destination));assert.equal(await readFile(join(destination,'keep'),'utf8'),'original');
  await symlink(f.keyPath,join(f.root,'linked'));await assert.rejects(readPrivateFile(join(f.root,'linked'),100));
  await symlink(destination,join(f.root,'linked-dir'));await assert.rejects(privateDirectory(join(f.root,'linked-dir')));
  await chmod(destination,0o755);await assert.rejects(privateDirectory(destination),/unsafe/);
  const publicFile=join(f.root,'public');await writeFile(publicFile,'bad',{mode:0o644});await assert.rejects(readPrivateFile(publicFile,100));
  await assert.rejects(readPrivateFile(f.keyPath,4));
  await symlink(f.root,join(f.root,'linked-parent'));await assert.rejects(readPrivateFile(join(f.root,'linked-parent','key'),100),/unsafe/);
  const wrongKey=join(f.root,'wrong-key');await writeFile(wrongKey,randomBytes(32),{mode:0o600});await assert.rejects(createRecoveryBundle(f.db,wrongKey,passphrase,f.root));
  assert.ok(!(await readdir(f.root)).some(n=>n.startsWith('.recovery-')));
 }finally{await f.close();}
});
test('passphrase and bundle bounds reject malformed or oversized input before expensive operations',async()=>{
 for(const p of ['',123,'short','x'.repeat(129),'a'.repeat(16)+'\n'])assert.equal(validRecoveryPassphrase(p),false);
 assert.equal(validRecoveryPassphrase(passphrase),true);assert.equal(validRecoveryPassphrase('long unicode 密码 phrase'),true);
 const f=await fixture();try{
  await assert.rejects(createRecoveryBundle(f.db,f.keyPath,'short',f.root),/invalid_recovery_passphrase/);
  await assert.rejects(restoreRecoveryBundle(Buffer.alloc(maxBundleBytes+1),passphrase,join(f.root,'too-large')),/bundle_invalid/);
  assert.ok(!(await readdir(f.root)).includes('too-large'));
 }finally{await f.close();}
});
test('oversized control databases and unsupported trigger schemas fail without leaving plaintext copies',async()=>{
 const f=await fixture();try{
  f.db.exec("CREATE TRIGGER unsupported AFTER INSERT ON audit_log BEGIN SELECT 1; END;");
  await assert.rejects(createRecoveryBundle(f.db,f.keyPath,passphrase,f.root),/schema_unsupported/);
  f.db.exec('DROP TRIGGER unsupported; CREATE TABLE large(data BLOB); INSERT INTO large VALUES(zeroblob(33554432));');
  await assert.rejects(createRecoveryBundle(f.db,f.keyPath,passphrase,f.root),/database_too_large/);
  assert.ok(!(await readdir(f.root)).some(n=>n.startsWith('.recovery-')));
 }finally{await f.close();}
});
async function apiFixture(panelUrl='https://panel.example.com'){
 const f=await fixture(),app=Fastify(),audits=[],approvals=[];
 registerRecoveryBackups(app,{db:f.db,keyPath:f.keyPath,folder:f.root,panelUrl,requestUser:r=>r.headers.role?{id:'owner',role:r.headers.role}:null,sameOrigin:r=>r.headers.origin==='https://panel.example.com',stepUp:(id,password,mfa)=>{approvals.push({id,password,mfa});return password!=='correct'?'password_invalid':mfa!=='123456'?'mfa_invalid':'ok';},audit:(...args)=>audits.push(args)});
 const headers={role:'owner',origin:'https://panel.example.com'},payload={confirmed:true,password:'correct',mfaCode:'123456',passphrase,passphraseConfirm:passphrase};
 return {...f,app,audits,approvals,headers,payload,post:(url,p=payload,h=headers)=>app.inject({method:'POST',url,headers:h,payload:p}),close:async()=>{await app.close();await f.close();}};
}
test('recovery APIs enforce Owner, Origin, HTTPS, confirmation, strict fields and fresh password/MFA',async()=>{
 const f=await apiFixture();try{
  const url='/api/backups/recovery';
  assert.equal((await f.post(url,f.payload,{})).statusCode,401);assert.equal((await f.post(url,f.payload,{...f.headers,role:'admin'})).statusCode,403);assert.equal((await f.post(url,f.payload,{role:'owner'})).statusCode,403);
  assert.equal((await f.post(url,{...f.payload,command:'cat /etc/shadow'})).statusCode,400);assert.equal((await f.post(url,{...f.payload,confirmed:false})).statusCode,400);assert.equal((await f.post(url,{...f.payload,passphraseConfirm:'different'})).statusCode,400);
  assert.equal((await f.post(url,{...f.payload,password:'wrong'})).json().error,'owner_password_invalid');assert.equal((await f.post(url,{...f.payload,mfaCode:'wrong'})).json().error,'mfa_invalid');
  assert.equal((await f.app.inject({url,headers:{role:'viewer'}})).statusCode,403);assert.equal(f.approvals.length,2);
 }finally{await f.close();}
 const insecure=await apiFixture('http://panel.example.com');try{assert.equal((await insecure.post('/api/backups/recovery')).json().error,'recovery_https_required');assert.equal(insecure.approvals.length,0);}finally{await insecure.close();}
});
test('API creates/downloads encrypted bundle, records real restore drill, clears failed proof and deletes only approved target',async()=>{
 const f=await apiFixture();try{
  const created=await f.post('/api/backups/recovery');assert.equal(created.statusCode,201,created.body);const id=created.json().id,base='/api/backups/recovery/'+id;
  assert.equal(created.headers['cache-control'],'no-store');assert.ok(!created.body.includes(passphrase));
  const download=await f.app.inject({url:base+'/download',headers:f.headers});assert.equal(download.statusCode,200);assert.equal(download.headers['content-type'],'application/octet-stream');assert.ok(!download.rawPayload.includes(Buffer.from(secret)));
  const check=await f.post(base+'/verify',{confirmed:true,password:'correct',mfaCode:'123456',passphrase});assert.equal(check.statusCode,200,check.body);assert.equal(check.json().status,'passed');assert.equal(check.json().liveStateReplaced,false);
  assert.equal((await f.app.inject({url:'/api/backups/recovery',headers:f.headers})).json().bundles[0].lastVerifiedAt,check.json().verifiedAt);
  assert.equal((await f.post(base+'/verify',{confirmed:true,password:'correct',mfaCode:'123456',passphrase:'wrong recovery passphrase'})).statusCode,422);
  assert.equal((await f.app.inject({url:'/api/backups/recovery',headers:f.headers})).json().bundles[0].lastVerifiedAt,null);
  assert.equal(f.vault.get('gemini.api_key'),secret);assert.ok(!(await readdir(join(f.root,'recovery'))).some(n=>n.startsWith('.recovery-')));
  assert.equal((await f.post(base+'/delete',{confirmed:true,password:'correct',mfaCode:'123456'})).json().deleted,true);
  assert.equal((await f.app.inject({url:base+'/download',headers:f.headers})).statusCode,404);
  const events=JSON.stringify(f.audits);for(const value of [secret,passphrase,'correct','123456'])assert.ok(!events.includes(value));
  assert.ok(events.includes('backup.recovery_verified'));assert.ok(events.includes('backup.recovery_verification_failed'));
 }finally{await f.close();}
});
test('API serializes expensive recovery work and limits repeated step-up attempts',async()=>{
 const f=await apiFixture();try{
  const results=await Promise.all([f.post('/api/backups/recovery'),f.post('/api/backups/recovery')]);assert.equal(results.filter(r=>r.statusCode===201).length,1);assert.ok(results.some(r=>r.statusCode===409||r.statusCode===429));assert.equal(f.approvals.length,1);
 }finally{await f.close();}
 const rate=await apiFixture();try{
  for(let i=0;i<5;i++)assert.equal((await rate.post('/api/backups/recovery',{...rate.payload,password:'wrong'})).statusCode,403);
  assert.equal((await rate.post('/api/backups/recovery',{...rate.payload,password:'wrong'})).statusCode,429);assert.equal(rate.approvals.length,5);
 }finally{await rate.close();}
});
test('API rejects symlink download and invalid IDs without exposing or deleting unrelated files',async()=>{
 const f=await apiFixture();try{
  await f.app.inject({url:'/api/backups/recovery',headers:f.headers});
  const id='12345678-1234-4123-8123-123456789abc';await symlink(f.keyPath,join(f.root,'recovery','control-'+id+'.devone'));
  assert.equal((await f.app.inject({url:'/api/backups/recovery/'+id+'/download',headers:f.headers})).statusCode,404);
  assert.equal((await f.post('/api/backups/recovery/'+id+'/delete',{confirmed:true,password:'correct',mfaCode:'123456'})).statusCode,404);assert.equal((await readFile(f.keyPath)).length,32);
  assert.equal((await f.post('/api/backups/recovery/bad/verify',{confirmed:true,password:'correct',mfaCode:'123456',passphrase})).statusCode,400);
 }finally{await f.close();}
});
test('offline CLI verifies and restores using a protected passphrase file; refuses overwriting and never prints secrets',async()=>{
 const f=await fixture();try{
  const {bundle}=await createRecoveryBundle(f.db,f.keyPath,passphrase,f.root),bundlePath=join(f.root,'bundle.devone'),passPath=join(f.root,'passphrase');await writeFile(bundlePath,bundle,{mode:0o600});await writeFile(passPath,passphrase+'\n',{mode:0o600});
  const call=(...args)=>spawnSync(process.execPath,['scripts/control-recovery.mjs',...args],{encoding:'utf8',timeout:15000});
  let result=call('verify',bundlePath,'--passphrase-file',passPath);assert.equal(result.status,0,result.stderr);assert.equal(JSON.parse(result.stdout).status,'passed');assert.ok(!result.stdout.includes(secret));assert.ok(!result.stdout.includes(passphrase));
  const target=join(f.root,'offline');result=call('restore',bundlePath,'--passphrase-file',passPath,target);assert.equal(result.status,0,result.stderr);assert.equal(JSON.parse(result.stdout).activated,false);
  result=call('restore',bundlePath,'--passphrase-file',passPath,target);assert.equal(result.status,1);assert.ok(result.stderr.includes('No live activation'));assert.equal((await readFile(join(target,'vault.key'))).length,32);
  await chmod(passPath,0o644);assert.equal(call('verify',bundlePath,'--passphrase-file',passPath).status,1);
 }finally{await f.close();}
});
