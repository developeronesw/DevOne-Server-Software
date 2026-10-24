import {spawn} from 'node:child_process';
import {createReadStream,createWriteStream} from 'node:fs';
import {pipeline} from 'node:stream/promises';
import {writeFile,mkdtemp,rm,chown} from 'node:fs/promises';
import {join} from 'node:path';
import type {DatabaseRequest} from './databases.js';
import {databaseRequest} from './databases.js';
export async function migrationCommand(binary:string,args:string[],input='',env:Record<string,string>={},timeout=30000):Promise<string>{
 return new Promise((resolve,reject)=>{
  const child=spawn(binary,args,{cwd:'/',env:{PATH:'/usr/sbin:/usr/bin:/sbin:/bin',HOME:'/',LC_ALL:'C',PGCONNECT_TIMEOUT:'5',...env},stdio:['pipe','pipe','ignore']});let out='',settled=false;
  const timer=setTimeout(()=>child.kill('SIGKILL'),timeout);const end=(ok:boolean)=>{if(settled)return;settled=true;clearTimeout(timer);ok?resolve(out.trim()):reject(Error('migration_command_failed'));};
  child.stdout.on('data',chunk=>{out+=chunk;if(Buffer.byteLength(out)>1048576){child.kill('SIGKILL');end(false);}});child.on('error',()=>end(false));child.on('close',code=>end(code===0));child.stdin.on('error',()=>{});child.stdin.end(input);
 });
}
export async function migrationStream(binary:string,args:string[],path:string,direction:'export'|'import',env:Record<string,string>={},identity?:{uid:number;gid:number}){
 const executable=identity?'/usr/bin/setpriv':binary,arguments_=identity?['--reuid='+identity.uid,'--regid='+identity.gid,'--clear-groups','--no-new-privs','--',binary,...args]:args;
 const child=spawn(executable,arguments_,{cwd:'/',env:{PATH:'/usr/sbin:/usr/bin:/sbin:/bin',HOME:'/',LC_ALL:'C',PGCONNECT_TIMEOUT:'5',...env},stdio:['pipe','pipe','ignore']});
 const closed=new Promise<void>((resolve,reject)=>{child.on('error',()=>reject(Error('migration_database_transfer_failed')));child.on('close',c=>c===0?resolve():reject(Error('migration_database_transfer_failed')));});closed.catch(()=>{});
 const timer=setTimeout(()=>child.kill('SIGKILL'),3600000);child.stdin.on('error',()=>{});
 try{
  if(direction==='export'){child.stdin.end();await pipeline(child.stdout,createWriteStream(path,{flags:'wx',mode:0o600}));}
  else{child.stdout.resume();await pipeline(createReadStream(path),child.stdin);}
  await closed;
 }catch{child.kill('SIGKILL');throw Error('migration_database_transfer_failed');}
 finally{clearTimeout(timer);}
}
export async function transferMigrationDatabase(value:DatabaseRequest,path:string,direction:'export'|'import',root:string){
 const b=databaseRequest(value),name='dv'+b.id.slice(3),user='dvs_'+b.siteId.slice(5);if(process.getuid?.()!==0)throw Error('migration_root_required');
 const passwd=(await migrationCommand('/usr/bin/getent',['passwd',user])).split(':'),identity={uid:Number(passwd[2]),gid:Number(passwd[3])};
 if(passwd[0]!==user||!Number.isInteger(identity.uid)||identity.uid<1000||!Number.isInteger(identity.gid)||identity.gid<1000||passwd[5]!=='/home/devone-sites/'+b.siteId||passwd[6]!=='/usr/sbin/nologin')throw Error('migration_site_identity_invalid');
 const dir=await mkdtemp('/run/devone-migration-auth-'),file=join(dir,'credentials');await chown(dir,identity.uid,identity.gid);
 try{
  if(b.engine==='mariadb'){
   await writeFile(file,`[client]\nuser=${name}\npassword=${b.password}\nprotocol=socket\nsocket=/run/mysqld/mysqld.sock\n`,{mode:0o600,flag:'wx'});
   await chown(file,identity.uid,identity.gid);
   await migrationStream(direction==='export'?'/usr/bin/mariadb-dump':'/usr/bin/mariadb',direction==='export'?['--defaults-file='+file,'--single-transaction','--skip-lock-tables','--hex-blob','--routines','--triggers','--events','--skip-comments',name]:['--defaults-file='+file,'--binary-mode','--local-infile=0','--database='+name],path,direction,{},identity);
  }else{
   await writeFile(file,`127.0.0.1:5432:${name}:${name}:${b.password}\n`,{mode:0o600,flag:'wx'});
   await chown(file,identity.uid,identity.gid);const env={PGPASSFILE:file};
   await migrationStream(direction==='export'?'/usr/bin/pg_dump':'/usr/bin/pg_restore',[...(direction==='export'?['--format=custom']:['--exit-on-error','--single-transaction']), '--no-owner','--no-acl','--host=127.0.0.1','--port=5432','--username='+name,'--dbname='+name,'--no-password'],path,direction,env,identity);
  }
 }finally{await rm(dir,{recursive:true,force:true});}
}
