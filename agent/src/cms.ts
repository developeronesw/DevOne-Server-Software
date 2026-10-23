import {execFile} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import type {Site} from './sites.js';
import type {CmsInstall} from './cms-release.js';
export function runCmsWorker(site:Site,stage:string,data:string,input:CmsInstall){
 return new Promise<void>((resolve,reject)=>{const p=execFile(process.execPath,[fileURLToPath(new URL('./cms-worker.js',import.meta.url))],{timeout:90000,maxBuffer:32768,env:{PATH:'/usr/bin:/bin',DEVONE_SITE_UID:String(site.uid),DEVONE_SITE_GID:String(site.gid),DEVONE_CMS_STAGE:stage,DEVONE_CMS_DATA:data}},(e,out)=>{try{if(e||JSON.parse(out).ok!==true)throw Error();resolve();}catch{reject(Error('cms_install_requires_inspection'));}});p.stdin?.on('error',()=>{});p.stdin?.end(JSON.stringify({title:input.title,email:input.email,password:input.adminPassword,url:'https://'+site.domain}));});
}
