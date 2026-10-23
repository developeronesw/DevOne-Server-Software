import {runCmsChecks} from './cms-integration.mjs';
// Runs as root ONLY inside the disposable, network-isolated QA image.
import {execFile,spawn} from 'node:child_process';
import {promisify} from 'node:util';
import {randomBytes} from 'node:crypto';
import {mkdtemp,readFile,writeFile,stat,readdir,mkdir,chown} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import assert from 'node:assert/strict';
import {runWordPressChecks} from './wordpress-integration.mjs';
import {DatabaseManager} from './databases.mjs';
const exec=promisify(execFile);
const report={scope:'isolated-real-sql',productionReady:false,checks:[]};
const command=(file,args)=>exec(file,args,{timeout:20000,maxBuffer:65536});
const sql=(file,args,input)=>new Promise((resolve,reject)=>{
 const p=execFile(file,args,{timeout:15000,maxBuffer:65536,env:{PATH:'/usr/sbin:/usr/bin:/sbin:/bin',LC_ALL:'C',PGCONNECT_TIMEOUT:'5'}},(e,out)=>e?reject(Error('sql_command_failed')):resolve(out.trim()));
 p.stdin.on('error',()=>{});p.stdin.end(input);
});
const root=(engine,query)=>engine==='mariadb'?sql('/usr/bin/mariadb',['--no-defaults','--user=root','--protocol=socket','--batch','--skip-column-names'],query):sql('/usr/sbin/runuser',['-u','postgres','--','/usr/bin/psql','-X','-w','--set=ON_ERROR_STOP=1','--dbname=postgres','--no-align','--tuples-only'],query);
async function check(id,work){try{await work();report.checks.push({id,status:'pass'});console.log('PASS '+id);}catch{report.checks.push({id,status:'fail'});throw Error(id);}}
let maria;
async function startMaria(){
 maria=spawn('/usr/sbin/mariadbd',['--user=mysql','--bind-address=127.0.0.1','--socket=/run/mysqld/mysqld.sock'],{stdio:'ignore'});
 maria.on('error',()=>{});
 for(let i=0;i<100;i++){try{await root('mariadb','SELECT 1;');return;}catch{await new Promise(r=>setTimeout(r,100));}}
 throw Error('mariadb_start');
}
async function stopMaria(){await command('/usr/bin/mariadb-admin',['--user=root','--protocol=socket','shutdown']);}
try{
 if(process.getuid()!==0)throw Error('container_root_required');
 await mkdir('/run/mysqld',{recursive:true});
 const {stdout:uid}=await command('/usr/bin/id',['-u','mysql']);const {stdout:gid}=await command('/usr/bin/id',['-g','mysql']);
 await chown('/run/mysqld',Number(uid.trim()),Number(gid.trim()));
 await startMaria();await command('/usr/bin/pg_ctlcluster',['16','main','start']);
 for(const engine of ['mariadb','postgresql']){
  const registry=await mkdtemp(join(tmpdir(),'devone-sql-'));
  const manager=new DatabaseManager({registry,sites:async()=>[{id:'site_0123456789abcdef',state:'ready'}]});
  const request=()=>({id:'db_'+randomBytes(8).toString('hex'),siteId:'site_0123456789abcdef',engine,password:randomBytes(32).toString('hex')});
  const a=request(),b=request();let first,second;
  // Test-client credentials use private files, never command-line passwords.
  async function app(req,query,database='dv'+req.id.slice(3),password=req.password){
   const name='dv'+req.id.slice(3),auth=join(registry,'test-auth');
   if(engine==='mariadb'){
    await writeFile(auth,`[client]\nuser=${name}\npassword=${password}\nprotocol=socket\n`,{mode:0o600});
    return sql('/usr/bin/mariadb',['--defaults-file='+auth,'--batch','--skip-column-names','--database='+database],query);
   }
   // psql needs PGPASSFILE; use explicit child env, no inherited credentials.
   await writeFile(auth,`127.0.0.1:5432:*:${name}:${password}\n`,{mode:0o600});
   return new Promise((resolve,reject)=>{
    const p=execFile('/usr/bin/psql',['-X','-w','--set=ON_ERROR_STOP=1','--host=127.0.0.1','--username='+name,'--dbname='+database,'--no-align','--tuples-only'],{timeout:15000,env:{PATH:'/usr/bin:/bin',PGPASSFILE:auth,PGCONNECT_TIMEOUT:'5'}},(e,out)=>e?reject(Error('sql_command_failed')):resolve(out.trim()));
    p.stdin.on('error',()=>{});p.stdin.end(query);
   });
  }
  await check(engine+'.provision',async()=>{first=await manager.create(a);second=await manager.create(b);assert.equal(first.state,'ready');assert.equal(second.state,'ready');assert.ok(first.verifiedAt);});
  await check(engine+'.private-registry',async()=>{
   assert.equal((await stat(registry)).mode&0o777,0o700);assert.equal((await stat(join(registry,'databases.json'))).mode&0o777,0o600);
   const saved=await readFile(join(registry,'databases.json'),'utf8');assert.ok(!saved.includes(a.password)&&!saved.includes(b.password));assert.ok(!(await readdir(registry)).some(n=>n.startsWith('.auth-')));
  });
  await check(engine+'.data',async()=>{await app(a,'CREATE TABLE qa_data (n INTEGER); INSERT INTO qa_data VALUES (42);');assert.equal(await app(a,'SELECT n FROM qa_data;'),'42');});
  await check(engine+'.wrong-password',async()=>{await assert.rejects(app(a,'SELECT 1;',first.name,randomBytes(32).toString('hex')));});
  await check(engine+'.account-isolation',async()=>{await assert.rejects(app(a,'SELECT 1;',second.name));
   if(engine==='mariadb')await assert.rejects(app(a,'CREATE USER qa_forbidden;'));
   else assert.equal(await root(engine,`SELECT rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls FROM pg_roles WHERE rolname='${first.name}';`),'f');
  });
  await check(engine+'.duplicate-preserves-data',async()=>{await assert.rejects(manager.create(a),/database_already_recorded/);assert.equal(await app(a,'SELECT n FROM qa_data;'),'42');});
  await check(engine+'.partial-failure',async()=>{
   const c=request(),name='dv'+c.id.slice(3);await root(engine,`CREATE DATABASE ${name};`);
   await assert.rejects(manager.create(c),/database_provisioning_requires_inspection/);
   assert.equal((await manager.list()).find(r=>r.id===c.id).state,'needs_inspection');
   await assert.rejects(manager.create(c),/database_already_recorded/);
   const exists=engine==='mariadb'?await root(engine,`SELECT SCHEMA_NAME FROM information_schema.SCHEMATA WHERE SCHEMA_NAME='${name}';`):await root(engine,`SELECT datname FROM pg_database WHERE datname='${name}';`);assert.equal(exists,name);
  });
  await check(engine+'.restart-persistence',async()=>{
   if(engine==='mariadb'){await stopMaria();await startMaria();}else await command('/usr/bin/pg_ctlcluster',['16','main','restart']);
   assert.equal(await app(a,'SELECT n FROM qa_data;'),'42');
   assert.equal((await new DatabaseManager({registry,sites:async()=>[]}).list()).find(r=>r.id===a.id).state,'ready');
  });
 }
 await runWordPressChecks(check,command);
 await runCmsChecks(check,command);
}catch{process.exitCode=1;console.error('Isolated SQL QA failed; consult named check results.');}
finally{
 await writeFile('/qa/result.json',JSON.stringify(report,null,2)+'\n',{mode:0o600});
 try{await stopMaria();}catch{}
 try{await command('/usr/bin/pg_ctlcluster',['16','main','stop']);}catch{}
 maria?.kill();
}
