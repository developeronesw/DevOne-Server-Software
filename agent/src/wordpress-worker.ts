import {validAdminPassword,validAdminUsername} from './install-account.js';
import {dropSiteIdentity} from './site-identity.js';
import {wordpressRelease} from './wordpress-release.js';
import {createHash} from 'node:crypto';
import {open,rm} from 'node:fs/promises';
import {execFile} from 'node:child_process';
import {fileURLToPath} from 'node:url';
let phase='identity';
// This entry point is launched by the Agent with trusted registry metadata.
async function main(){
 dropSiteIdentity(Number(process.env.DEVONE_SITE_UID),Number(process.env.DEVONE_SITE_GID));
 process.umask(0o027);
 const root=process.env.DEVONE_WORDPRESS_STAGE;
 if(!root||!/^\/home\/devone-sites\/site_[a-f0-9]{16}\/\.wordpress-app_[a-f0-9]{16}$/.test(root))throw Error();
 let input='';for await(const part of process.stdin){input+=part;if(Buffer.byteLength(input)>8192)throw Error();}
 const b=JSON.parse(input) as {database:string;databasePassword:string;adminPassword:string;adminUsername:string;url:string;email:string;title:string};
 if(Object.keys(b).some(k=>!['database','databasePassword','adminPassword','adminUsername','url','email','title'].includes(k))||!/^dv[a-f0-9]{16}$/.test(b.database)||! /^[a-f0-9]{64}$/.test(b.databasePassword)||!validAdminPassword(b.adminPassword)||!validAdminUsername(b.adminUsername))throw Error();
 phase='artifact';
 const archive=root+'/.core-download';
 const file=await open(archive,'wx',0o600);
 try{
  // Root downloads and verifies a shared immutable cache; verify again after
  // dropping identity before extracting or executing any application code.
  const source=await open('/var/cache/devone/wordpress/'+wordpressRelease.sha256+'.tar.gz','r');
  const hash=createHash('sha256');let size=0;
  try{for await(const chunk of source.createReadStream()){size+=chunk.length;if(size>wordpressRelease.maxBytes)throw Error();hash.update(chunk);await file.writeFile(chunk);}}finally{await source.close();}
  if(hash.digest('hex')!==wordpressRelease.sha256)throw Error();
 }finally{await file.close();}
 const run=(binary:string,args:string[],stdin='')=>new Promise<string>((resolve,reject)=>{
  const child=execFile(binary,args,{cwd:root,timeout:120000,maxBuffer:32768,env:{PATH:'/usr/bin:/bin',HOME:root,LANG:'C.UTF-8'}},(e,out)=>e?reject(Error('wordpress_worker_failed')):resolve(out));child.stdin?.on('error',()=>{});child.stdin?.end(stdin);
 });
 phase='extract';
 await run('/usr/bin/python3',[fileURLToPath(new URL('../../scripts/wordpress-extract.py',import.meta.url)),archive,root]);await rm(archive);
 phase='configure';
 const result=JSON.parse(await run('/usr/bin/php8.3',['-d','display_errors=0','-d','log_errors=0',fileURLToPath(new URL('../../scripts/wordpress-install.php',import.meta.url))],JSON.stringify(b)));
 if(result.ok!==true||result.version!==wordpressRelease.version)throw Error();
 process.stdout.write(JSON.stringify({ok:true,version:wordpressRelease.version}));
}
main().catch(()=>{process.stdout.write(JSON.stringify({error:'wordpress_install_requires_inspection',phase}));process.exitCode=1;});
