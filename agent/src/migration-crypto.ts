import {createCipheriv,createDecipheriv,randomBytes,scrypt,createHash} from 'node:crypto';
import {createReadStream,createWriteStream,constants} from 'node:fs';
import {open,lstat,rename,rm} from 'node:fs/promises';
import {pipeline} from 'node:stream/promises';
import {PassThrough,Transform,type Readable} from 'node:stream';
export const migrationMagic=Buffer.from('DEVONE-MIG1\n');
export const maxMigrationBytes=1024**4;
export const validMigrationId=(id:unknown):id is string=>typeof id==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(id);
export function migrationPassphrase(value:unknown):value is string{return typeof value==='string'&&value.length>=16&&value.length<=128&&!/[\x00-\x1f\x7f]/.test(value)&&Buffer.byteLength(value)<=512;}
async function derive(passphrase:string,salt:Buffer):Promise<Buffer>{if(!migrationPassphrase(passphrase))throw Error('migration_passphrase_invalid');return new Promise((resolve,reject)=>scrypt(passphrase,salt,32,{N:32768,r:8,p:1,maxmem:64*1024*1024},(error,key)=>error?reject(error):resolve(key)));}
export async function hashMigrationFile(path:string){const hash=createHash('sha256'),file=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW);try{for await(const chunk of file.createReadStream({autoClose:false}))hash.update(chunk);return hash.digest('hex');}finally{await file.close();}}
export async function encryptMigration(stream:Readable,destination:string,passphrase:string){
 const salt=randomBytes(16),iv=randomBytes(12),temporary=destination+'.partial';
 // Attach immediately: short-lived child stdout can otherwise drain while scrypt runs.
 const buffered=new PassThrough({highWaterMark:65536}),pumped=pipeline(stream,buffered);pumped.catch(()=>{});let key:Buffer|undefined;
 try{
  key=await derive(passphrase,salt);
  const file=await open(temporary,'wx',0o600);try{await file.writeFile(Buffer.concat([migrationMagic,salt,iv]));}finally{await file.close();}
  const cipher=createCipheriv('aes-256-gcm',key,iv);cipher.setAAD(migrationMagic);
  let bytes=0;const limit=new Transform({transform(chunk,encoding,done){bytes+=chunk.length;done(bytes>maxMigrationBytes-64?Error('migration_archive_too_large'):null,chunk);}});
  await pipeline(buffered,limit,cipher,createWriteStream(temporary,{flags:'a',mode:0o600}));await pumped;if(bytes===0)throw Error('migration_archive_invalid');
  const output=await open(temporary,'a');try{await output.writeFile(cipher.getAuthTag());await output.sync();}finally{await output.close();}
  const info=await lstat(temporary);if(info.size>maxMigrationBytes)throw Error('migration_archive_too_large');
  await rename(temporary,destination);return {bytes:info.size,sha256:await hashMigrationFile(destination)};
 }finally{key?.fill(0);buffered.destroy();stream.destroy();await rm(temporary,{force:true});}
}
export async function decryptMigration(source:string,destination:string,passphrase:string){
 const file=await open(source,constants.O_RDONLY|constants.O_NOFOLLOW);let key:Buffer|undefined;
 try{
  const info=await file.stat(),header=Buffer.alloc(migrationMagic.length+28),tag=Buffer.alloc(16);
  if(!info.isFile()||info.nlink!==1||(info.mode&0o077)||info.size<=header.length+16||info.size>maxMigrationBytes)throw Error('migration_archive_invalid');
  if((await file.read(header,0,header.length,0)).bytesRead!==header.length||!header.subarray(0,migrationMagic.length).equals(migrationMagic))throw Error('migration_archive_invalid');
  await file.read(tag,0,16,info.size-16);key=await derive(passphrase,header.subarray(migrationMagic.length,migrationMagic.length+16));
  const decipher=createDecipheriv('aes-256-gcm',key,header.subarray(migrationMagic.length+16));decipher.setAAD(migrationMagic);decipher.setAuthTag(tag);
  // Plaintext is private and is not parsed or applied until authentication succeeds.
  await pipeline(file.createReadStream({start:header.length,end:info.size-17,autoClose:false}),decipher,createWriteStream(destination,{flags:'wx',mode:0o600}));
  const result=await open(destination,'r+');try{await result.sync();}finally{await result.close();}
 }catch(error){await rm(destination,{force:true});throw new Error('migration_unlock_failed',{cause:error});}
 finally{key?.fill(0);await file.close();}
}
