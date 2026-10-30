import {dropSiteIdentity} from './site-identity.js';
import {CSW_SOURCE,assertSoundwerksTarget} from './soundwerks-updates.js';
import {execFile} from 'node:child_process';
import {readFile,writeFile,lstat,open,rm} from 'node:fs/promises';
import {join} from 'node:path';

type Mode='build'|'backup'|'migrate'|'restore';
const errors:Record<Mode,string>={
 build:'soundwerks_update_build_failed',backup:'soundwerks_update_backup_failed',
 migrate:'soundwerks_update_migration_failed',restore:'soundwerks_update_restore_failed'
};
function run(binary:string,args:string[],cwd:string,environment:NodeJS.ProcessEnv,timeout=600000){
 return new Promise<string>((resolve,reject)=>{
  execFile(binary,args,{cwd,env:environment,timeout,maxBuffer:4*1024*1024},(error,stdout)=>{
   if(error)reject(Error('soundwerks_update_worker_command_failed'));
   else resolve(stdout);
  });
 });
}
async function main(){
 const uid=Number(process.env.DEVONE_SITE_UID),gid=Number(process.env.DEVONE_SITE_GID);
 dropSiteIdentity(uid,gid);
 process.umask(0o077);
 const mode=process.env.DEVONE_CSW_MODE as Mode;
 if(!Object.hasOwn(errors,mode))throw Error('invalid_mode');
 const stage=process.env.DEVONE_CSW_STAGE??'';
 const data=process.env.DEVONE_CSW_DATA??'';
 const target=assertSoundwerksTarget(process.env.DEVONE_CSW_TARGET);
 const backup=process.env.DEVONE_CSW_BACKUP??'';
 const home=stage.slice(0,stage.lastIndexOf('/'));
 if(!/^\/home\/devone-sites\/site_[a-f0-9]{16}\/\.soundwerks-update-[a-f0-9]{12}-[0-9]{13}$/.test(stage)||
  data!==home+'/data'||
  !backup.startsWith(data+'/update-backups/')||
  !/^db-[a-f0-9]{12}-[0-9]{13}\.dump$/.test(backup.slice((data+'/update-backups/').length)))
  throw Error('invalid_update_paths');
 const config=join(data,'.env');
 const env:NodeJS.ProcessEnv={PATH:'/usr/bin:/bin',HOME:data,LANG:'C.UTF-8',
  NODE_ENV:'production',CSW_CONFIG_PATH:config,npm_config_audit:'false',npm_config_fund:'false'};
 const privateDir=await lstat(data);
 if(!privateDir.isDirectory()||privateDir.isSymbolicLink())throw Error('unsafe_private_data');
 if(mode==='build'){
  const folder=await lstat(stage);
  if(!folder.isDirectory()||folder.isSymbolicLink())throw Error('unsafe_update_stage');
  await run('/usr/bin/git',['init','-q'],stage,env);
  await run('/usr/bin/git',['remote','add','origin',CSW_SOURCE],stage,env);
  await run('/usr/bin/git',['fetch','--no-tags','--depth','1','origin',target],stage,env);
  await run('/usr/bin/git',['checkout','-q','--detach','FETCH_HEAD'],stage,env);
  const revision=(await run('/usr/bin/git',['rev-parse','HEAD'],stage,env)).trim();
  if(revision!==target)throw Error('soundwerks_source_revision_mismatch');
  await run('/usr/bin/npm',['install','--include=dev','--no-audit','--no-fund'],stage,env,600000);
  await run('/usr/bin/npm',['run','check'],stage,env,180000);
  await run('/usr/bin/npm',['run','build'],stage,env,300000);
  await writeFile(join(stage,'server.mjs'),'import "./apps/api/dist/index.js";\n',{flag:'wx',mode:0o640});
  await writeFile(join(stage,'.csw-source-revision'),target+'\n',{flag:'wx',mode:0o600});
  await rm(join(stage,'.git'),{recursive:true,force:true});
 }else{
  const content=await readFile(config,'utf8');
  const match=content.match(/^DATABASE_URL=(.+)$/m);
  if(!match)throw Error('missing_database_url');
  const url=new URL(match[1].trim());
  if(!['postgres:','postgresql:'].includes(url.protocol)||
   url.hostname!=='127.0.0.1'||url.port!=='5432'||
   !/^\/dv[a-f0-9]{16}$/.test(url.pathname)||
   url.username!==url.pathname.slice(1)||!/^[a-f0-9]{64}$/.test(url.password))
   throw Error('invalid_site_database');
  const password=url.password;
  url.password='';
  const pgEnv={...env,PGPASSWORD:password,PGCONNECT_TIMEOUT:'8'};
  const pgUrl=url.toString();
  if(mode==='backup'){
   const handle=await open(backup,'wx',0o600);await handle.close();
   try{await run('/usr/bin/pg_dump',['--format=custom','--no-owner','--no-privileges',
    '--file='+backup,'--dbname='+pgUrl],data,pgEnv,180000);}
   catch(e){await rm(backup,{force:true});throw e;}
  }else if(mode==='migrate'){
   const folder=await lstat(stage);
   if(!folder.isDirectory()||folder.isSymbolicLink())throw Error('unsafe_update_stage');
   await run('/usr/bin/npm',['run','db:migrate'],stage,{...pgEnv,DATABASE_URL:match[1].trim()},180000);
  }else{
   const file=await lstat(backup);
   if(!file.isFile()||file.isSymbolicLink()||file.size===0)throw Error('backup_missing');
   await run('/usr/bin/pg_restore',['--clean','--if-exists','--no-owner','--no-privileges',
    '--exit-on-error','--dbname='+pgUrl,backup],data,pgEnv,180000);
  }
 }
 process.stdout.write(JSON.stringify({ok:true,mode,revision:target}));
}
main().catch(()=>{
 const mode=process.env.DEVONE_CSW_MODE as Mode;
 process.stdout.write(JSON.stringify({error:errors[mode]??'soundwerks_update_worker_failed'}));
 process.exitCode=1;
});
