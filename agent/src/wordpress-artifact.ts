import {constants} from 'node:fs';
import {mkdir,lstat,open,rename,rm} from 'node:fs/promises';
import {createHash,randomUUID} from 'node:crypto';
import {join} from 'node:path';
import {wordpressRelease} from './wordpress-release.js';
export const wordpressCache='/var/cache/devone/wordpress';
export async function ensureWordPressArtifact(){
 await mkdir(wordpressCache,{recursive:true,mode:0o755});
 const directory=await lstat(wordpressCache);
 if(!directory.isDirectory()||directory.isSymbolicLink()||directory.uid!==0||(directory.mode&0o022))throw Error('wordpress_artifact_unavailable');
 const destination=join(wordpressCache,wordpressRelease.sha256+'.tar.gz');
 try{
  const cached=await open(destination,constants.O_RDONLY|constants.O_NOFOLLOW);
  try{const s=await cached.stat();if(!s.isFile()||s.uid!==0||(s.mode&0o022)||s.size>wordpressRelease.maxBytes)throw Error();const bytes=await cached.readFile();if(createHash('sha256').update(bytes).digest('hex')===wordpressRelease.sha256)return;}finally{await cached.close();}
  // Never overwrite an unexpected cache entry; require explicit inspection.
  throw Error();
 }catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw Error('wordpress_artifact_unavailable');}
 const temporary=join(wordpressCache,'.download-'+randomUUID());const file=await open(temporary,'wx',0o644);
 try{
  const response=await fetch(wordpressRelease.url,{redirect:'error',signal:AbortSignal.timeout(90000)});
  if(!response.ok||!response.body||Number(response.headers.get('content-length')??0)>wordpressRelease.maxBytes)throw Error();
  const hash=createHash('sha256');let size=0;
  for await(const chunk of response.body){size+=chunk.length;if(size>wordpressRelease.maxBytes)throw Error();hash.update(chunk);await file.writeFile(chunk);}
  if(hash.digest('hex')!==wordpressRelease.sha256)throw Error();
  await file.sync();await file.close();await rename(temporary,destination);
 }catch{await file.close().catch(()=>{});await rm(temporary,{force:true}).catch(()=>{});throw Error('wordpress_artifact_unavailable');}
}
