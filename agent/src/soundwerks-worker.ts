import {dropSiteIdentity} from './site-identity.js';
import {soundwerksRelease} from './soundwerks-release.js';
import {createHash,randomBytes} from 'node:crypto';
import {execFile} from 'node:child_process';
import {mkdir,writeFile,lstat,rm} from 'node:fs/promises';
import {join} from 'node:path';

const run=(binary:string,args:string[],cwd:string,environment:Record<string,string>,timeout=600000)=>new Promise<string>((resolve,reject)=>{
 const child=execFile(binary,args,{cwd,timeout,maxBuffer:131072,env:environment},(error,output)=>{
  if(error)reject(Error('soundwerks_worker_command_failed'));
  else resolve(output);
 });
 child.stdin?.on('error',()=>{});
});
async function main(){
 dropSiteIdentity(Number(process.env.DEVONE_SITE_UID),Number(process.env.DEVONE_SITE_GID));
 process.umask(0o077);
 const stage=process.env.DEVONE_SOUNDWERKS_STAGE;
 const data=process.env.DEVONE_SOUNDWERKS_DATA;
 if(!stage||!/^\/home\/devone-sites\/site_[a-f0-9]{16}\/\.soundwerks-app_[a-f0-9]{16}$/.test(stage)||
  data!==stage.slice(0,stage.lastIndexOf('/'))+'/data')throw Error();
 let raw='';
 for await(const part of process.stdin){raw+=part;if(Buffer.byteLength(raw)>8192)throw Error();}
 const b=JSON.parse(raw) as {databaseId:string;databasePassword:string;domain:string;setupToken:string;sitePort:number};
 if(Object.keys(b).some(k=>!['databaseId','databasePassword','domain','setupToken','sitePort'].includes(k))||
  !/^db_[a-f0-9]{16}$/.test(b.databaseId)||!/^[a-f0-9]{64}$/.test(b.databasePassword)||
  !/^[a-f0-9]{64}$/.test(b.setupToken)||!Number.isInteger(b.sitePort)||b.sitePort<1024||b.sitePort>65535||
  typeof b.domain!=='string'||!b.domain.split('.').every(p=>/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(p)))
  throw Error();
 const pre=await lstat(stage);
 if(!pre.isDirectory()||pre.isSymbolicLink())throw Error();
 const env={PATH:'/usr/bin:/bin',HOME:data,LANG:'C.UTF-8',NODE_ENV:'production',
  CSW_CONFIG_PATH:join(data,'.env'),npm_config_audit:'false',npm_config_fund:'false'};
 // Pinned Git object ID is cryptographically verified by git. Run all downloaded
 // source and npm lifecycle code only AFTER dropping root and supplementary groups.
 await run('/usr/bin/git',['init','-q'],stage,env);
 await run('/usr/bin/git',['remote','add','origin',soundwerksRelease.source],stage,env);
 await run('/usr/bin/git',['fetch','--no-tags','--depth','1','origin',soundwerksRelease.commit],stage,env);
 await run('/usr/bin/git',['checkout','-q','--detach','FETCH_HEAD'],stage,env);
 const commit=(await run('/usr/bin/git',['rev-parse','HEAD'],stage,env)).trim();
 if(commit!==soundwerksRelease.commit)throw Error('soundwerks_revision_mismatch');
 await run('/usr/bin/npm',['install','--include=dev','--no-audit','--no-fund'],stage,env,600000);
 await run('/usr/bin/npm',['run','check'],stage,env,180000);
 await run('/usr/bin/npm',['run','build'],stage,env,300000);
 await mkdir(join(data,'media'),{recursive:true,mode:0o700});
 const db='dv'+b.databaseId.slice(3);
 const url='postgresql://'+db+':'+b.databasePassword+'@127.0.0.1:5432/'+db;
 const lines=[
  'NODE_ENV=production','HOST=127.0.0.1','PORT='+b.sitePort,
  'DATABASE_URL='+url,'CSW_SETUP_TOKEN='+b.setupToken,
  'COOKIE_SECURE=true','PUBLIC_APP_URL=https://'+b.domain,
  'MEDIA_ROOT='+join(data,'media'),'STRIPE_SECRET_KEY=','STRIPE_WEBHOOK_SECRET=',''];
 await writeFile(join(data,'.env'),lines.join('\n'),{flag:'wx',mode:0o600});
 await run('/usr/bin/npm',['run','db:migrate'],stage,env,120000);
 // Never publish the Git repository metadata or its branch configuration.
 await rm(join(stage,'.git'),{recursive:true,force:true});
 await writeFile(join(stage,'server.mjs'),
  'import "./apps/api/dist/index.js";\n',{flag:'wx',mode:0o640});
 process.stdout.write(JSON.stringify({ok:true,version:soundwerksRelease.version}));
}
main().catch(()=>{process.stdout.write(JSON.stringify({error:'soundwerks_install_requires_inspection'}));process.exitCode=1;});
