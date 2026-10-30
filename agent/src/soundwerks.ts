import {execFile} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import type {Site} from './sites.js';
import {soundwerksRelease,type SoundwerksInstall} from './soundwerks-release.js';
import {softwareInstall,softwareStatus,installSoundwerksMedia,SoftwareInstallFailure} from './software.js';

type MediaBinary='ffmpeg'|'ffprobe';
type PrerequisiteDependencies={
 status?:typeof softwareStatus;
 postgresInstall?:()=>Promise<unknown>;
 mediaInstall?:()=>Promise<unknown>;
 checkBinary?:(name:MediaBinary)=>Promise<boolean>;
};
function mediaBinaryReady(name:MediaBinary):Promise<boolean>{
 return new Promise(resolve=>execFile('/usr/bin/'+name,['-version'],
  {timeout:7000,maxBuffer:65536,env:{PATH:'/usr/bin:/bin'}},(error,stdout)=>
    resolve(!error&&stdout.startsWith(name+' version '))));
}
function reasonFor(error:unknown):string{
 if(error instanceof SoftwareInstallFailure)return error.reason;
 if(error instanceof Error&&error.message==='software_install_busy')return 'install_lock_busy';
 return 'unclassified';
}

/** Preparing a new site never creates a site or database before these checks finish. */
export async function prepareSoundwerks(deps:PrerequisiteDependencies={}):Promise<void>{
 const status=await (deps.status??softwareStatus)();
 const postgres=status.packages.find(p=>p.package==='postgresql');
 if(!postgres?.installed||!postgres.serviceActive){
  try{await (deps.postgresInstall??(()=>softwareInstall({package:'postgresql',confirmed:true})))();}
  catch(error){throw Error('soundwerks_postgresql_'+reasonFor(error));}
 }
 const check=deps.checkBinary??mediaBinaryReady;
 const both=async()=> (await Promise.all([check('ffmpeg'),check('ffprobe')])).every(Boolean);
 if(!await both()){
  try{await (deps.mediaInstall??installSoundwerksMedia)();}
  catch(error){throw Error('soundwerks_ffmpeg_'+reasonFor(error));}
 }
 if(!await both())throw Error('soundwerks_ffmpeg_package_service_inactive');
}
export function runSoundwerksWorker(site:Site,stage:string,data:string,input:SoundwerksInstall,setupToken:string,port:number){
 return new Promise<void>((resolve,reject)=>{
  const child=execFile(process.execPath,[fileURLToPath(new URL('./soundwerks-worker.js',import.meta.url))],
   {timeout:1100000,maxBuffer:32768,env:{PATH:'/usr/bin:/bin',
    DEVONE_SITE_UID:String(site.uid),DEVONE_SITE_GID:String(site.gid),
    DEVONE_SOUNDWERKS_STAGE:stage,DEVONE_SOUNDWERKS_DATA:data}},(e,out)=>{
     try{const result=JSON.parse(out);if(e||result.ok!==true||result.version!==soundwerksRelease.version)throw Error();resolve();}
     catch{reject(Error('soundwerks_install_requires_inspection'));}
   });
  child.stdin?.on('error',()=>{});
  child.stdin?.end(JSON.stringify({databaseId:input.databaseId,databasePassword:input.databasePassword,
   domain:site.domain,setupToken,sitePort:port}));
 });
}

export type SoundwerksUpdateMode='build'|'backup'|'migrate'|'restore';
export function runSoundwerksUpdateWorker(site:Site,stage:string,data:string,backup:string,
 target:string,mode:SoundwerksUpdateMode):Promise<void>{
 return new Promise((resolve,reject)=>{
  const child=execFile(process.execPath,[fileURLToPath(new URL('./soundwerks-update-worker.js',import.meta.url))],
   {timeout:mode==='build'?1150000:240000,maxBuffer:32768,
    env:{PATH:'/usr/bin:/bin',
     DEVONE_SITE_UID:String(site.uid),DEVONE_SITE_GID:String(site.gid),
     DEVONE_CSW_MODE:mode,DEVONE_CSW_STAGE:stage,DEVONE_CSW_DATA:data,
     DEVONE_CSW_BACKUP:backup,DEVONE_CSW_TARGET:target}},(error,stdout)=>{
    try{
     const result=JSON.parse(stdout);
     if(error||result.ok!==true||result.mode!==mode||result.revision!==target)throw Error();
     resolve();
    }catch{reject(Error('soundwerks_update_'+mode+'_failed'));}
   });
  child.stdin?.on('error',()=>{});
  child.stdin?.end();
 });
}
