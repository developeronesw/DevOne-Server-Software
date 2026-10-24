// Real file/control/vault migration and rollback, with host-service commands stubbed.
// Never touches system services, network, Linux accounts or paths outside its fixture.
import {MigrationEngine,defaultMigrationConfig} from './agent/dist/migration-engine.js';
import {SiteManager} from './agent/dist/sites.js';
import {Vault} from './apps/api/dist/vault.js';
import {MfaService} from './apps/api/dist/mfa.js';
import {DatabaseSync} from 'node:sqlite';
import {mkdtemp,mkdir,writeFile,readFile,readdir,rm,chown,stat,copyFile} from 'node:fs/promises';
import {randomBytes,randomUUID,scryptSync} from 'node:crypto';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import assert from 'node:assert/strict';
export async function runServerMigrationChecks(check){
 const root=await mkdtemp(join(tmpdir(),'devone-full-migration-')),passphrase='real file and vault migration passphrase';
 async function fixture(name,siteUid){
  const dir=join(root,name);await mkdir(dir,{mode:0o700});const config={...defaultMigrationConfig,root:join(dir,'migration'),base:join(dir,'homes'),registry:join(dir,'registry'),databaseRegistry:join(dir,'db-registry'),nginx:join(dir,'nginx'),certificates:join(dir,'certificates'),dbPath:join(dir,'control.sqlite'),keyPath:join(dir,'key'),envPath:join(dir,'env'),panelUrl:'https://'+name+'.example.test',source:dir,backups:join(dir,'backups')};
  for(const p of [config.root,config.base,config.registry,config.nginx])await mkdir(p,{mode:0o700});
  await writeFile(config.keyPath,randomBytes(32),{mode:0o600});await writeFile(config.envPath,`DEVONE_PANEL_URL=${config.panelUrl}\nDEVONE_AGENT_TOKEN=${name}-agent-token\n`,{mode:0o600});
  const db=new DatabaseSync(config.dbPath);db.exec(`CREATE TABLE users(id TEXT PRIMARY KEY,role TEXT,email TEXT,password_hash TEXT);CREATE TABLE sessions(id_hash TEXT PRIMARY KEY,user_id TEXT REFERENCES users(id));CREATE TABLE audit_log(id INTEGER PRIMARY KEY,action TEXT);CREATE TABLE jobs(id TEXT PRIMARY KEY,state TEXT,error TEXT,finished_at TEXT);INSERT INTO users VALUES('owner','owner','${name}@example.test','scrypt:original-hash');INSERT INTO sessions VALUES('old-session','owner');`);const salt=randomBytes(16),hash=scryptSync('source-owner-password',salt,64);db.prepare('UPDATE users SET password_hash=?').run('scrypt:'+salt.toString('hex')+':'+hash.toString('hex'));new Vault(db,config.keyPath);new MfaService(db,config.keyPath);db.close();
  const identities=new Map();let phpActive=false;
  const run=async(binary,args)=>{
   const b=binary.split('/').at(-1);
   if(b==='git')return 'a'.repeat(40);if(b==='du')return '4096 '+config.base;
   if(b==='id')return '12000';
   if(b==='nginx'&&args[0]==='-T'){const list=await readdir(config.nginx);return (await Promise.all(list.filter(f=>f.endsWith('.conf')).map(f=>readFile(join(config.nginx,f),'utf8')))).join('\n');}
   if(b==='useradd'){identities.set(args.at(-1),args[args.indexOf('--home-dir')+1]);return '';}
   if(b==='getent'){const user=args[1];return identities.has(user)?`${user}:x:${siteUid}:${siteUid}::${identities.get(user)}:/usr/sbin/nologin`:'';}
   if(b==='userdel'){identities.delete(args[0]);return '';}
   if(b==='systemctl'&&args[0]==='is-active')return args[1]==='php8.3-fpm'&&phpActive?'active':'inactive';
   if(b==='python3'){const {migrationCommand}=await import('./agent/dist/migration-sql.js');return migrationCommand(binary,args,'',{},60000);}
   return '';
  };
  const sites=new SiteManager({registry:config.registry,base:config.base,nginx:config.nginx,panelDomain:new URL(config.panelUrl).hostname,requireRoot:false,command:run});
  const engine=new MigrationEngine(config,async()=>{},{run,sites,platform:async()=>true});engine.siteHealth=async()=>{};engine.panelHealth=async()=>{};
  return {config,engine,sites,identities};
 }
 try{
  const source=await fixture('source',15001),site=await source.sites.create({domain:'migrated.example.test',webServer:'nginx',siteType:'static'}),home=join(source.config.base,site.id);await mkdir(join(home,'data'),{mode:0o700});await chown(join(home,'data'),15001,15001);await writeFile(join(home,'public','.env'),'private application credential',{mode:0o600});await chown(join(home,'public','.env'),15001,15001);await writeFile(join(home,'public','index.html'),'<h1>All customer content</h1>',{mode:0o640});await chown(join(home,'public','index.html'),15001,15001);
  const cms=new DatabaseSync(join(home,'data','cms.sqlite'));cms.exec("CREATE TABLE pages(title TEXT);INSERT INTO pages VALUES('Preserved private CMS data');");cms.close();await chown(join(home,'data','cms.sqlite'),15001,15001);await writeFile(join(home,'data','cms.key'),Buffer.alloc(32,41),{mode:0o600});await chown(join(home,'data','cms.key'),15001,15001);
  const sourceDb=new DatabaseSync(source.config.dbPath);new Vault(sourceDb,source.config.keyPath).put('gemini.api_key','source-provider-secret','owner');sourceDb.exec("INSERT INTO jobs VALUES('pending-history','succeeded',NULL,NULL)");sourceDb.close();
  const exportId=randomUUID();let archive;
  await check('migration.server.export-real-files-and-control',async()=>{const exported=await source.engine.export(exportId,passphrase);assert.equal(exported.sites,1);assert.equal(exported.databases,0);archive=join(source.config.root,'exports',exportId+'.devone-migration');assert.equal(await readFile(join(home,'public','.env'),'utf8'),'private application credential');assert.equal((await source.sites.list())[0].state,'ready');assert.ok(!(await readdir(join(source.config.root,'work'))).includes(exportId));});
  await check('migration.server.final-cutover-holds-source',async()=>{const holdId=randomUUID(),result=await source.engine.export(holdId,passphrase,true);assert.equal(result.sourcePaused,true);assert.match(await readFile(join(source.config.nginx,'devone-'+site.id+'.conf'),'utf8'),/return 503/);assert.deepEqual(await readdir(join(source.config.root,'work',holdId)),['resume.json']);await source.engine.resume(join(source.config.root,'work',holdId));assert.equal((await source.sites.migrationInventory())[0].id,site.id);});
  const target=await fixture('target',15002),uploadId=randomUUID(),planId=randomUUID();await mkdir(join(target.config.root,'uploads'),{mode:0o700});await copyFile(archive,join(target.config.root,'uploads',uploadId+'.devone-migration'));
  await check('migration.server.inspect-fresh-destination',async()=>{const plan=await target.engine.inspect(planId,uploadId,passphrase);assert.equal(plan.sites[0].domain,site.domain);assert.equal(plan.targetPanelUrl,target.config.panelUrl);assert.equal((await target.sites.list()).length,0);const before=new DatabaseSync(target.config.dbPath);try{assert.equal(before.prepare('SELECT email FROM users').get().email,'target@example.test');}finally{before.close();}});
  await check('migration.server.restore-real-content-vault-and-identities',async()=>{
   const result=await target.engine.apply(planId,'target.example.test');assert.equal(result.status,'succeeded');assert.equal(result.dnsChanged,false);const restored=(await target.sites.list())[0];assert.equal(restored.id,site.id);assert.equal(restored.uid,15002);assert.equal((await stat(join(target.config.base,site.id,'public','.env'))).uid,15002);assert.equal(await readFile(join(target.config.base,site.id,'public','.env'),'utf8'),'private application credential');
   const privateDb=new DatabaseSync(join(target.config.base,site.id,'data','cms.sqlite'));try{assert.equal(privateDb.prepare('SELECT title FROM pages').get().title,'Preserved private CMS data');}finally{privateDb.close();}assert.deepEqual(await readFile(join(target.config.base,site.id,'data','cms.key')),Buffer.alloc(32,41));
   const restoredDb=new DatabaseSync(target.config.dbPath);try{assert.equal(restoredDb.prepare('SELECT email FROM users').get().email,'source@example.test');assert.equal(restoredDb.prepare('SELECT COUNT(*) AS n FROM sessions').get().n,0);const [,salt,hash]=restoredDb.prepare('SELECT password_hash FROM users').get().password_hash.split(':');assert.equal(scryptSync('source-owner-password',Buffer.from(salt,'hex'),64).toString('hex'),hash);assert.equal(new Vault(restoredDb,target.config.keyPath).get('gemini.api_key'),'source-provider-secret');}finally{restoredDb.close();}
   const env=await readFile(target.config.envPath,'utf8');assert.ok(env.includes('target-agent-token'));assert.ok(!env.includes('source-agent-token'));assert.ok(env.includes(target.config.panelUrl));
  });
  await check('migration.server.nonempty-target-refused',async()=>{const blocked=await target.engine.inspect(randomUUID(),uploadId,passphrase);assert.equal(blocked.compatible,false);assert.ok(blocked.blockers.includes('migration_target_not_fresh'));assert.equal((await target.sites.list()).length,1);});
  const failed=await fixture('rollback-target',15003),badUpload=randomUUID(),badPlan=randomUUID(),oldKey=await readFile(failed.config.keyPath);await mkdir(join(failed.config.root,'uploads'),{mode:0o700});await copyFile(archive,join(failed.config.root,'uploads',badUpload+'.devone-migration'));await failed.engine.inspect(badPlan,badUpload,passphrase);let attempts=0;failed.engine.panelHealth=async()=>{if(attempts++===0)throw Error('migration_panel_health_failed');};
  await check('migration.server.failed-activation-rolls-back-owned-resources',async()=>{await assert.rejects(failed.engine.apply(badPlan,'rollback-target.example.test'),/panel_health_failed/);assert.equal((await failed.sites.list()).length,0);assert.deepEqual(await readdir(failed.config.base),[]);assert.deepEqual(await readFile(failed.config.keyPath),oldKey);const db=new DatabaseSync(failed.config.dbPath);try{assert.equal(db.prepare('SELECT email FROM users').get().email,'rollback-target@example.test');}finally{db.close();}assert.equal(await readFile(join(home,'public','index.html'),'utf8'),'<h1>All customer content</h1>');});
 }finally{await rm(root,{recursive:true,force:true});}
}
