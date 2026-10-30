import {execFile} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import type {Site} from './sites.js';
import {soundwerksRelease,type SoundwerksInstall} from './soundwerks-release.js';
import {softwareInstall,softwareStatus} from './software.js';
const fixedScript='/opt/devone/current/scripts/software-runtime-pilot.sh';

export async function prepareSoundwerks(){
 const status=await softwareStatus();
 const pg=status.packages.find(p=>p.package==='postgresql');
 if(!pg?.installed||!pg.serviceActive)await softwareInstall({package:'postgresql',confirmed:true});
 const checkBinary=(name:'ffmpeg'|'ffprobe')=>new Promise<boolean>(resolve=>{
  execFile('/usr/bin/'+name,['-version'],{timeout:6000,env:{PATH:'/usr/bin:/bin'}},e=>resolve(!e));
 });
 const binaries=async()=> (await Promise.all([checkBinary('ffmpeg'),checkBinary('ffprobe')])).every(Boolean);
 if(!await binaries()){
  // The reviewed DevOne APT policy script has an explicit ffmpeg allowlist.
  await new Promise<void>((resolve,reject)=>execFile('/usr/bin/bash',[fixedScript,'--managed-install','ffmpeg'],
   {timeout:300000,maxBuffer:32768,env:{PATH:'/usr/sbin:/usr/bin:/sbin:/bin'}},e=>e?reject(Error('soundwerks_prerequisites_unavailable')):resolve()));
 }
 if(!await binaries())throw Error('soundwerks_prerequisites_unavailable');
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
