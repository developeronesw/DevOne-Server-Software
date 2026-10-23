import {constants} from 'node:fs';
import {mkdir,lstat,open,rename,mkdtemp,writeFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {execFile} from 'node:child_process';
import {randomUUID,randomBytes,createHash,createHmac,pbkdf2Sync} from 'node:crypto';
export type DatabaseEngine='mariadb'|'postgresql';
export type DatabaseRequest={id:string;siteId:string;engine:DatabaseEngine;password:string};
type RecordEntry={id:string;siteId:string;engine:DatabaseEngine;name:string;username:string;host:string;state:'provisioning'|'ready'|'needs_inspection';createdAt:string;verifiedAt?:string};
type Runner=(binary:string,args:string[],sql:string,env?:Record<string,string>)=>Promise<string>;
export function databaseRequest(value:unknown):DatabaseRequest{
 if(!value||typeof value!=='object'||Array.isArray(value))throw Error('invalid_database');
 const b=value as DatabaseRequest;
 if(Object.keys(b).some(k=>!['id','siteId','engine','password'].includes(k))||!/^db_[a-f0-9]{16}$/.test(b.id)||!/^site_[a-f0-9]{16}$/.test(b.siteId)||!['mariadb','postgresql'].includes(b.engine)||typeof b.password!=='string'||!/^[a-f0-9]{64}$/.test(b.password))throw Error('invalid_database');
 return {id:b.id,siteId:b.siteId,engine:b.engine,password:b.password};
}
export function databaseSql(input:DatabaseRequest){
 const b=databaseRequest(input),name='dv'+b.id.slice(3);
 if(b.engine==='mariadb'){
  const hash='*'+createHash('sha1').update(createHash('sha1').update(b.password).digest()).digest('hex').toUpperCase();
  return {name,username:name,host:'localhost',sql:`CREATE DATABASE \`${name}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;\nCREATE USER '${name}'@'localhost' IDENTIFIED VIA mysql_native_password USING '${hash}';\nGRANT ALL PRIVILEGES ON \`${name}\`.* TO '${name}'@'localhost';\n`};
 }
 const salt=randomBytes(16),salted=pbkdf2Sync(b.password,salt,4096,32,'sha256');
 const client=createHmac('sha256',salted).update('Client Key').digest(),stored=createHash('sha256').update(client).digest('base64'),server=createHmac('sha256',salted).update('Server Key').digest('base64');
 const hash=`SCRAM-SHA-256$4096:${salt.toString('base64')}$${stored}:${server}`;
 return {name,username:name,host:'127.0.0.1',sql:`CREATE ROLE "${name}" LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS CONNECTION LIMIT 20 PASSWORD '${hash}';\nCREATE DATABASE "${name}" OWNER "${name}";\nREVOKE ALL ON DATABASE "${name}" FROM PUBLIC;\n`};
}
const execute:Runner=(binary,args,sql,extra={})=>new Promise((resolve,reject)=>{
 const child=execFile(binary,args,{cwd:'/tmp',timeout:12000,maxBuffer:32768,env:{PATH:'/usr/sbin:/usr/bin:/sbin:/bin',LC_ALL:'C',PGCONNECT_TIMEOUT:'5',...extra}},(error,stdout)=>error?reject(Error('database_command_failed')):resolve(stdout));
 child.stdin?.on('error',()=>{});child.stdin?.end(sql);
});
export class DatabaseManager{
 private queue:Promise<unknown>=Promise.resolve();private active:string|null=null;
 constructor(private options:{registry:string;sites:()=>Promise<{id:string;state:string}[]>;run?:Runner;requireRoot?:boolean;withSite?:<T>(id:string,work:()=>Promise<T>)=>Promise<T>}){}
 private async records():Promise<RecordEntry[]>{
  if(this.options.requireRoot!==false&&process.getuid?.()!==0)throw Error('root_agent_required');
  await mkdir(this.options.registry,{recursive:true,mode:0o700});const directory=await lstat(this.options.registry);
  if(!directory.isDirectory()||directory.isSymbolicLink()||(directory.mode&0o077)||(this.options.requireRoot!==false&&directory.uid!==0))throw Error('unsafe_database_registry');
  let file;try{file=await open(join(this.options.registry,'databases.json'),constants.O_RDONLY|constants.O_NOFOLLOW);}catch(e){if((e as NodeJS.ErrnoException).code==='ENOENT')return [];throw e;}
  try{
   const info=await file.stat();if(!info.isFile()||info.nlink!==1||info.size>1048576||(info.mode&0o077)||(this.options.requireRoot!==false&&info.uid!==0))throw Error('unsafe_database_registry');
   const list=JSON.parse(await file.readFile('utf8')) as RecordEntry[];
   if(!Array.isArray(list)||list.length>500||list.some(r=>!/^db_[a-f0-9]{16}$/.test(r.id)||!/^site_[a-f0-9]{16}$/.test(r.siteId)||!['mariadb','postgresql'].includes(r.engine)||r.name!=='dv'+r.id.slice(3)||r.username!==r.name||r.host!==(r.engine==='mariadb'?'localhost':'127.0.0.1')||!['provisioning','ready','needs_inspection'].includes(r.state))||new Set(list.map(r=>r.id)).size!==list.length)throw Error('invalid_database_registry');return list;
  }finally{await file.close();}
 }
 private async save(list:RecordEntry[]){
  const path=join(this.options.registry,'.databases-'+randomUUID());const file=await open(path,constants.O_CREAT|constants.O_EXCL|constants.O_WRONLY|constants.O_NOFOLLOW,0o600);
  try{await file.writeFile(JSON.stringify(list));await file.sync();}finally{await file.close();}await rename(path,join(this.options.registry,'databases.json'));
  const dir=await open(this.options.registry,constants.O_RDONLY|constants.O_DIRECTORY);try{await dir.sync();}finally{await dir.close();}
 }
 async list(){return (await this.records()).map(r=>({...r,state:r.state==='provisioning'&&this.active!==r.id?'needs_inspection':r.state}));}
 create(value:unknown){
  const input=databaseRequest(value);
  // Always acquire the site lock before the database queue. Application installs
  // hold the same site lock, so reversing this order would deadlock both queues.
  const work=()=>this.enqueue(input);
  return this.options.withSite?this.options.withSite(input.siteId,work):work();
 }
 // Internal only: caller must already hold SiteManager's mutation lock.
 createForLockedSite(value:unknown,siteId:string){
  const input=databaseRequest(value);if(input.siteId!==siteId)throw Error('invalid_database');
  return this.enqueue(input,siteId);
 }
 private enqueue(input:DatabaseRequest,lockedSiteId?:string){
  const operation=this.queue.then(()=>this.provision(input,lockedSiteId));this.queue=operation.catch(()=>{});return operation;
 }
 private async provision(input:DatabaseRequest,lockedSiteId?:string){
  const records=await this.records();const existing=records.find(r=>r.id===input.id);
  // No replay after process loss or partial SQL execution. No IF NOT EXISTS or automatic DROP.
  if(existing)throw Error('database_already_recorded');
  if(records.length>=500)throw Error('database_limit');
  if(!lockedSiteId&&!this.options.withSite&&!(await this.options.sites()).some(s=>s.id===input.siteId&&s.state==='ready'))throw Error('database_site_not_ready');
  const config=databaseSql(input),entry:RecordEntry={id:input.id,siteId:input.siteId,engine:input.engine,name:config.name,username:config.username,host:config.host,state:'provisioning',createdAt:new Date().toISOString()};
  const run=this.options.run??execute;
  try{
   const version=input.engine==='mariadb'?await run('/usr/bin/mariadb',['--no-defaults','--protocol=socket','--socket=/run/mysqld/mysqld.sock','--user=root','--batch','--skip-column-names'],'SELECT VERSION();\n'):await run('/usr/sbin/runuser',['-u','postgres','--','/usr/bin/psql','-X','-w','--set=ON_ERROR_STOP=1','--dbname=postgres','--host=/var/run/postgresql','--port=5432','--no-align','--tuples-only'],'SELECT version();\n');
   if(input.engine==='mariadb'?!/^10\.11\..*MariaDB/i.test(version.trim()):!/^PostgreSQL (?:1[6-9]|[2-9][0-9])\./.test(version.trim()))throw Error();
  }catch{throw Error('database_engine_unavailable');}
  records.push(entry);this.active=input.id;
  let authDir:string|undefined;
  try{
   await this.save(records);
   if(input.engine==='mariadb')await run('/usr/bin/mariadb',['--no-defaults','--protocol=socket','--socket=/run/mysqld/mysqld.sock','--user=root','--batch','--skip-column-names'],config.sql);
   else await run('/usr/sbin/runuser',['-u','postgres','--','/usr/bin/psql','-X','-w','--set=ON_ERROR_STOP=1','--dbname=postgres','--host=/var/run/postgresql','--port=5432'],config.sql);
   authDir=await mkdtemp(join(this.options.registry,'.auth-'));
   const auth=join(authDir,'credentials');let verified:string;
   if(input.engine==='mariadb'){
    await writeFile(auth,`[client]\nuser=${config.username}\npassword=${input.password}\nhost=localhost\nprotocol=socket\nsocket=/run/mysqld/mysqld.sock\n`,{mode:0o600,flag:'wx'});
    verified=await run('/usr/bin/mariadb',['--defaults-file='+auth,'--batch','--skip-column-names','--database='+config.name],"SELECT DATABASE(),CURRENT_USER();\n");
    if(verified.trim()!==config.name+'\t'+config.username+'@localhost')throw Error('database_credentials_not_verified');
   }else{
    await writeFile(auth,`127.0.0.1:5432:${config.name}:${config.username}:${input.password}\n`,{mode:0o600,flag:'wx'});
    verified=await run('/usr/bin/psql',['-X','-w','--set=ON_ERROR_STOP=1','--host=127.0.0.1','--port=5432','--username='+config.username,'--dbname='+config.name,'--no-align','--tuples-only','--field-separator=\t'],"SELECT current_database(),current_user;\n",{PGPASSFILE:auth});
    if(verified.trim()!==config.name+'\t'+config.username)throw Error('database_credentials_not_verified');
   }
   await rm(authDir,{recursive:true,force:true});authDir=undefined;
   entry.state='ready';entry.verifiedAt=new Date().toISOString();await this.save(records);return entry;
  }catch{entry.state='needs_inspection';await this.save(records);throw Error('database_provisioning_requires_inspection');}
  finally{if(authDir)await rm(authDir,{recursive:true,force:true}).catch(()=>{});this.active=null;}
 }
}
