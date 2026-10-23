import {ensureWordPressArtifact} from './wordpress-artifact.js';
import {execFile} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {softwareInstall,softwareStatus} from './software.js';
import type {Site} from './sites.js';
import type {WordPressInstall} from './wordpress-release.js';
const modules="foreach(['mysqli','curl','gd','mbstring','dom','zip','intl'] as $m){if(!extension_loaded($m))exit(1);}if(PHP_MAJOR_VERSION!==8||PHP_MINOR_VERSION!==3)exit(1);echo 'ready';";
export async function prepareWordPress(){
 await ensureWordPressArtifact();
 const status=await softwareStatus();
 const extensions=await new Promise<boolean>(resolve=>execFile('/usr/bin/php8.3',['-r',modules],{timeout:10000,env:{PATH:'/usr/bin:/bin'}},(e,out)=>resolve(!e&&out==='ready')));
 for(const name of ['php8.3-fpm','mariadb-server'] as const){
  const info=status.packages.find(p=>p.package===name);
  if(!info?.installed||!info.serviceActive||(name==='php8.3-fpm'&&!extensions))await softwareInstall({package:name,confirmed:true});
 }
 const checked=await new Promise<boolean>(resolve=>execFile('/usr/bin/php8.3',['-r',modules],{timeout:10000,env:{PATH:'/usr/bin:/bin'}},(e,out)=>resolve(!e&&out==='ready')));
 if(!checked)throw Error('wordpress_prerequisites_unavailable');
}
export function runWordPressWorker(site:Site,stage:string,input:WordPressInstall){
 const data={database:'dv'+input.databaseId.slice(3),databasePassword:input.databasePassword,adminPassword:input.adminPassword,title:input.title,email:input.email,url:(site.tls?'https':'http')+'://'+site.domain};
 return new Promise<void>((resolve,reject)=>{
  const child=execFile(process.execPath,[fileURLToPath(new URL('./wordpress-worker.js',import.meta.url))],{timeout:240000,maxBuffer:32768,env:{PATH:'/usr/bin:/bin',DEVONE_SITE_UID:String(site.uid),DEVONE_SITE_GID:String(site.gid),DEVONE_WORDPRESS_STAGE:stage}},(e,out)=>{
   try{if(e||JSON.parse(out).ok!==true)throw Error();resolve();}catch{reject(Error('wordpress_install_requires_inspection'));}
  });child.stdin?.on('error',()=>{});child.stdin?.end(JSON.stringify(data));
 });
}
