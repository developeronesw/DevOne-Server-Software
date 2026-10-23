import {dropSiteIdentity} from './site-identity.js';
import {cmsRelease} from './cms-release.js';
import {lstat,readFile,writeFile,rm} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {execFile} from 'node:child_process';
import {fileURLToPath} from 'node:url';
async function main(){
 dropSiteIdentity(Number(process.env.DEVONE_SITE_UID),Number(process.env.DEVONE_SITE_GID));process.umask(0o077);
 const stage=process.env.DEVONE_CMS_STAGE,data=process.env.DEVONE_CMS_DATA;
 if(!stage||! /^\/home\/devone-sites\/(site_[a-f0-9]{16})\/\.cms-app_[a-f0-9]{16}$/.test(stage)||data!==stage.slice(0,stage.lastIndexOf('/'))+'/data')throw Error();
 let raw='';for await(const chunk of process.stdin){raw+=chunk;if(Buffer.byteLength(raw)>4096)throw Error();}
 const b=JSON.parse(raw) as {title:string;email:string;password:string;url:string};
 if(Object.keys(b).some(k=>!['title','email','password','url'].includes(k))||! /^[a-f0-9]{64}$/.test(b.password))throw Error();
 const archive=fileURLToPath(new URL('../../distributions/devone-cms-local/'+cmsRelease.file,import.meta.url));
 const stat=await lstat(archive);if(!stat.isFile()||stat.isSymbolicLink()||stat.size!==cmsRelease.bytes)throw Error();
 if(createHash('sha256').update(await readFile(archive)).digest('hex')!==cmsRelease.sha256)throw Error();
 const run=(binary:string,args:string[],input='')=>new Promise<string>((resolve,reject)=>{const p=execFile(binary,args,{cwd:stage,timeout:45000,maxBuffer:32768,env:{PATH:'/usr/bin:/bin',HOME:data,NODE_ENV:'production',DEVONE_DATA_DIR:data,DEVONE_MIGRATIONS_DIR:stage+'/migrations'}},(e,out)=>e?reject(Error('cms_worker_failed')):resolve(out));p.stdin?.on('error',()=>{});p.stdin?.end(input);});
 await run('/usr/bin/python3',[fileURLToPath(new URL('../../scripts/cms-extract.py',import.meta.url)),archive,stage]);
 const release=JSON.parse(await readFile(stage+'/release.json','utf8'));if(release.sourceCommit!==cmsRelease.sourceCommit||release.version!==cmsRelease.version||release.profile!=='local-node-sqlite')throw Error();
 const result=JSON.parse(await run(process.execPath,[stage+'/bootstrap.mjs'],JSON.stringify(b)));if(result.ok!==true||result.version!==cmsRelease.version)throw Error();
 // The initializer is not kept in the published application tree.
 await rm(stage+'/bootstrap.mjs');
 const entry=`import {fileURLToPath} from 'node:url';\nimport {dirname,resolve} from 'node:path';\nconst root=dirname(fileURLToPath(import.meta.url));\nprocess.env.NODE_ENV='production';\nprocess.env.DEVONE_SITE_URL=${JSON.stringify(b.url)};\nprocess.env.DEVONE_DATA_DIR=resolve(root,'../data');\nprocess.env.DEVONE_PUBLIC_DIR=resolve(root,'web');\nprocess.env.DEVONE_MIGRATIONS_DIR=resolve(root,'migrations');\nawait import('./runtime.mjs');\n`;
 await writeFile(stage+'/server.mjs',entry,{mode:0o640,flag:'wx'});
 process.stdout.write(JSON.stringify({ok:true}));
}
main().catch(()=>{process.stdout.write(JSON.stringify({error:'cms_install_requires_inspection'}));process.exitCode=1;});
