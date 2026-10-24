import {DatabaseManager} from './agent/dist/databases.js';
import {migrationCommand,transferMigrationDatabase} from './agent/dist/migration-sql.js';
import {mkdtemp,writeFile,readFile,rm,access} from 'node:fs/promises';
import {randomBytes,randomUUID} from 'node:crypto';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
export async function runMigrationChecks(check,root){
 for(const engine of ['mariadb','postgresql']){
  const dir=await mkdtemp(join(tmpdir(),'devone-migration-sql-')),siteId='site_'+randomBytes(8).toString('hex'),id='db_'+randomBytes(8).toString('hex'),name='dv'+id.slice(3),password=randomBytes(32).toString('hex'),request={id,siteId,engine,password},dump=join(dir,engine==='mariadb'?'database.sql':'database.dump');
  const user='dvs_'+siteId.slice(5),shellMarker='/tmp/devone-migration-shell-'+randomUUID();await migrationCommand('/usr/sbin/useradd',['--user-group','--no-create-home','--home-dir','/home/devone-sites/'+siteId,'--shell','/usr/sbin/nologin',user]);
  const app=async(query,secret=password)=>{
   const auth=join(dir,'client-auth');await writeFile(auth,engine==='mariadb'?`[client]\nuser=${name}\npassword=${secret}\nprotocol=socket\n`:`127.0.0.1:5432:${name}:${name}:${secret}\n`,{mode:0o600});
   return new Promise((resolve,reject)=>{const p=spawn(engine==='mariadb'?'/usr/bin/mariadb':'/usr/bin/psql',engine==='mariadb'?['--defaults-file='+auth,'--batch','--skip-column-names','--database='+name]:['-X','-w','--set=ON_ERROR_STOP=1','--host=127.0.0.1','--username='+name,'--dbname='+name,'--no-align','--tuples-only'],{env:{PATH:'/usr/bin:/bin',PGPASSFILE:auth,PGCONNECT_TIMEOUT:'5'},stdio:['pipe','pipe','ignore']});let output='';p.stdout.on('data',c=>output+=c);p.on('error',reject);p.on('close',c=>c===0?resolve(output.trim()):reject(Error('app_login_denied')));p.stdin.on('error',()=>{});p.stdin.end(query);});
  };
  const drop=()=>root(engine,engine==='mariadb'?`DROP DATABASE IF EXISTS ${name}; DROP USER IF EXISTS '${name}'@'localhost';`:`DROP DATABASE IF EXISTS "${name}"; DROP ROLE IF EXISTS "${name}";`);
  try{
   const source=new DatabaseManager({registry:join(dir,'source'),sites:async()=>[{id:siteId,state:'ready'}]});await source.create(request);
   await check('migration.'+engine+'.export',async()=>{await app("CREATE TABLE migration_records(id INTEGER PRIMARY KEY, content VARCHAR(200)); INSERT INTO migration_records VALUES(1,'Preserve Ω credentials and content');");await transferMigrationDatabase(request,dump,'export',dir);assert.ok((await readFile(dump)).length>0);assert.ok(!(await readFile(dump)).includes(Buffer.from(password)));});
   // Reset only this generated QA database/account to emulate a fresh destination.
   await drop();const destination=new DatabaseManager({registry:join(dir,'destination'),sites:async()=>[{id:siteId,state:'ready'}]});
   await check('migration.'+engine+'.restore',async()=>{await destination.create(request);await transferMigrationDatabase(request,dump,'import',dir);assert.equal(await app('SELECT content FROM migration_records WHERE id=1;'),'Preserve Ω credentials and content');assert.equal((await destination.list())[0].id,id);});
   await check('migration.'+engine+'.restore-boundary',async()=>{
    await assert.rejects(app('SELECT 1;',randomBytes(32).toString('hex')));
    if(engine==='mariadb'){
     const bad=join(dir,'malicious.sql'),marker=shellMarker;await writeFile(bad,'\\! touch '+marker+'\nDROP DATABASE mysql;\n',{mode:0o600});await assert.rejects(transferMigrationDatabase(request,bad,'import',dir));await assert.rejects(access(marker));assert.equal(await app('SELECT COUNT(*) FROM migration_records;'),'1');
    }else{assert.equal(await root(engine,`SELECT rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls FROM pg_roles WHERE rolname='${name}';`),'f');await assert.rejects(app("COPY migration_records TO PROGRAM 'true';"));}
   });
  }finally{await drop();await migrationCommand('/usr/sbin/userdel',[user]);await rm(shellMarker,{force:true});await rm(dir,{recursive:true,force:true});}
 }
}
