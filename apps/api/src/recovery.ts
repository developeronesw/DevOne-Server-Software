import {createCipheriv,createDecipheriv,createHash,randomBytes,scrypt} from 'node:crypto';
import {DatabaseSync,backup} from 'node:sqlite';
import {constants} from 'node:fs';
import {mkdir,mkdtemp,open,rm,writeFile,lstat,realpath,statfs} from 'node:fs/promises';
import {join,resolve,dirname} from 'node:path';
import {open as openSecret,readMasterKey} from './vault.js';

// Fixed work factors and binary header: archives cannot request arbitrary KDF work.
const magic=Buffer.from('DEVONE-RCV1\n');
const headerBytes=magic.length+16+12+16;
export const maxDatabaseBytes=32*1024*1024;
export const maxBundleBytes=46*1024*1024;
export const recoveryScope='control-database-and-vault-key' as const;
const digest=(bytes:Buffer)=>createHash('sha256').update(bytes).digest('hex');
export function validRecoveryPassphrase(value:unknown):value is string{
 return typeof value==='string'&&value.length>=16&&value.length<=128&&Buffer.byteLength(value)<=512&&!/[\x00-\x1f\x7f]/.test(value);
}
async function derive(passphrase:string,salt:Buffer):Promise<Buffer>{
 if(!validRecoveryPassphrase(passphrase))throw Error('invalid_recovery_passphrase');
 return new Promise((done,fail)=>scrypt(passphrase,salt,32,{N:32768,r:8,p:1,maxmem:64*1024*1024},(error,key)=>error?fail(error):done(key)));
}
export async function readPrivateFile(path:string,limit:number){
 const parent=await lstat(dirname(path));
 if(!parent.isDirectory()||(parent.mode&0o077)!==0||await realpath(dirname(path))!==resolve(dirname(path)))throw Error('recovery_directory_unsafe');
 const file=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
 try{
  const stat=await file.stat();
  if(!stat.isFile()||stat.size<1||stat.size>limit||(stat.mode&0o077)!==0)throw Error('recovery_file_invalid');
  // Read at most limit+1 even if another process changes the file after fstat.
  const bytes=Buffer.alloc(stat.size+1);let offset=0;
  while(offset<bytes.length){const {bytesRead}=await file.read(bytes,offset,bytes.length-offset,null);if(!bytesRead)break;offset+=bytesRead;}
  if(offset!==stat.size)throw Error('recovery_file_changed');
  return bytes.subarray(0,offset);
 }finally{await file.close();}
}
export async function privateDirectory(path:string){
 await mkdir(path,{recursive:true,mode:0o700});
 const stat=await lstat(path);
 if(!stat.isDirectory()||stat.isSymbolicLink()||(stat.mode&0o077)!==0||await realpath(path)!==resolve(path))throw Error('recovery_directory_unsafe');
}
async function requireSpace(path:string,bytes:number){
 const space=await statfs(path);
 if(space.bavail*space.bsize<bytes+128*1024*1024)throw Error('recovery_disk_space_low');
}
export async function syncRecoveryDirectory(path:string){
 const directory=await open(path,constants.O_RDONLY|constants.O_DIRECTORY|constants.O_NOFOLLOW);
 try{await directory.sync();}finally{await directory.close();}
}
async function writeDurable(path:string,value:Buffer|string){
 const file=await open(path,'wx',0o600);
 try{await file.writeFile(value);await file.sync();}finally{await file.close();}
}
function inspectDatabase(path:string,key:Buffer){
 const db=new DatabaseSync(path,{readOnly:true});
 try{
  db.exec('PRAGMA trusted_schema=OFF; PRAGMA query_only=ON;');
  if((db.prepare('PRAGMA integrity_check').get() as Record<string,unknown>).integrity_check!=='ok'||db.prepare('PRAGMA foreign_key_check').all().length)throw Error('recovery_database_invalid');
  // Only ordinary DevOne tables are read; views/triggers are not recovery inputs.
  const schema=db.prepare("SELECT name,type FROM sqlite_schema WHERE name NOT LIKE 'sqlite_%'").all() as {name:string;type:string}[];
  if(schema.some(s=>!['table','index'].includes(s.type)))throw Error('recovery_schema_unsupported');
  const names=new Set(schema.filter(s=>s.type==='table').map(s=>s.name));
  for(const name of ['users','sessions','secrets','audit_log','jobs','owner_mfa'])if(!names.has(name))throw Error('recovery_schema_missing');
  const owners=Number((db.prepare("SELECT COUNT(*) AS n FROM users WHERE role='owner'").get() as {n:number}).n);
  if(owners<1)throw Error('recovery_owner_missing');
  const secrets=db.prepare('SELECT name,envelope FROM secrets').all() as {name:string;envelope:string}[];
  for(const row of secrets)openSecret(key,row.name,row.envelope);
  const mfa=db.prepare('SELECT user_id,encrypted_secret FROM owner_mfa').all() as {user_id:string;encrypted_secret:string}[];
  for(const row of mfa)openSecret(key,'mfa.'+row.user_id,row.encrypted_secret);
  return {owners,secrets:secrets.length,mfaAccounts:mfa.length};
 }finally{db.close();}
}
type Payload={format:1;softwareVersion:'1.0.0-alpha.3';scope:typeof recoveryScope;createdAt:string;databaseSha256:string;database:string;vaultKey:string};
export async function createRecoveryBundle(db:DatabaseSync,keyPath:string,passphrase:string,workRoot:string){
 if(!validRecoveryPassphrase(passphrase))throw Error('invalid_recovery_passphrase');
 await privateDirectory(workRoot);
 const work=await mkdtemp(join(workRoot,'.recovery-create-'));
 let key:Buffer|undefined,plain:Buffer|undefined,derived:Buffer|undefined,database:Buffer|undefined;
 try{
  // Refuse oversized live databases before writing a plaintext copy.
  const pages=Number((db.prepare('PRAGMA page_count').get() as {page_count:number}).page_count),pageSize=Number((db.prepare('PRAGMA page_size').get() as {page_size:number}).page_size);
  if(pages*pageSize>maxDatabaseBytes)throw Error('recovery_database_too_large');
  await requireSpace(workRoot,pages*pageSize*3);
  const path=join(work,'control.sqlite');
  await writeFile(path,Buffer.alloc(0),{mode:0o600,flag:'wx'});
  await backup(db,path);
  database=await readPrivateFile(path,maxDatabaseBytes);
  key=readMasterKey(keyPath);
  const verification=inspectDatabase(path,key),createdAt=new Date().toISOString();
  const payload:Payload={format:1,softwareVersion:'1.0.0-alpha.3',scope:recoveryScope,createdAt,databaseSha256:digest(database),database:database.toString('base64'),vaultKey:key.toString('base64')};
  plain=Buffer.from(JSON.stringify(payload));
  const salt=randomBytes(16),iv=randomBytes(12);derived=await derive(passphrase,salt);
  const cipher=createCipheriv('aes-256-gcm',derived,iv);cipher.setAAD(magic);
  const encrypted=Buffer.concat([cipher.update(plain),cipher.final()]);
  const bundle=Buffer.concat([magic,salt,iv,cipher.getAuthTag(),encrypted]);
  if(bundle.length>maxBundleBytes)throw Error('recovery_bundle_too_large');
  return {bundle,createdAt,sha256:digest(bundle),verification};
 }finally{
  key?.fill(0);plain?.fill(0);derived?.fill(0);database?.fill(0);
  await rm(work,{recursive:true,force:true});
 }
}
async function decodeBundle(bundle:Buffer,passphrase:string){
 if(bundle.length<=headerBytes||bundle.length>maxBundleBytes||!bundle.subarray(0,magic.length).equals(magic))throw Error('recovery_bundle_invalid');
 let key:Buffer|undefined,plain:Buffer|undefined;
 try{
  const at=magic.length;key=await derive(passphrase,bundle.subarray(at,at+16));
  const decipher=createDecipheriv('aes-256-gcm',key,bundle.subarray(at+16,at+28));
  decipher.setAAD(magic);decipher.setAuthTag(bundle.subarray(at+28,headerBytes));
  plain=Buffer.concat([decipher.update(bundle.subarray(headerBytes)),decipher.final()]);
  const p=JSON.parse(plain.toString('utf8')) as Payload;
  if(p.format!==1||p.softwareVersion!=='1.0.0-alpha.3'||p.scope!==recoveryScope||typeof p.createdAt!=='string'||!Number.isFinite(Date.parse(p.createdAt))||typeof p.database!=='string'||typeof p.vaultKey!=='string'||typeof p.databaseSha256!=='string')throw Error();
  const database=Buffer.from(p.database,'base64'),vaultKey=Buffer.from(p.vaultKey,'base64');
  if(database.length>maxDatabaseBytes||database.length<100||vaultKey.length!==32||digest(database)!==p.databaseSha256||!database.subarray(0,16).equals(Buffer.from('SQLite format 3\0')))throw Error();
  return {database,vaultKey,createdAt:p.createdAt,databaseSha256:p.databaseSha256};
 }catch{throw Error('recovery_unlock_failed');}
 finally{key?.fill(0);plain?.fill(0);}
}
export async function restoreRecoveryBundle(bundle:Buffer,passphrase:string,destination:string){
 // Never replace an existing directory or any active database, even if empty.
 const target=resolve(destination);await privateDirectory(dirname(target));
 const decoded=await decodeBundle(bundle,passphrase);
 let created=false;
 try{
  await requireSpace(dirname(target),decoded.database.length*2);
  await mkdir(target,{mode:0o700});created=true;
  const path=join(target,'control.sqlite');
  await writeDurable(path,decoded.database);
  const verification=inspectDatabase(path,decoded.vaultKey);
  // A recovered control DB must not restore sessions or replay queued host writes.
  const copy=new DatabaseSync(path);
  try{
   copy.exec("PRAGMA trusted_schema=OFF; BEGIN IMMEDIATE; DELETE FROM sessions; UPDATE jobs SET state='interrupted',error='recovery_requires_review',finished_at=datetime('now') WHERE state IN ('queued','running'); COMMIT; PRAGMA journal_mode=DELETE;");
  }finally{copy.close();}
  await writeDurable(join(target,'vault.key'),decoded.vaultKey);
  const result={format:1,softwareVersion:'1.0.0-alpha.3',scope:recoveryScope,createdAt:decoded.createdAt,verifiedAt:new Date().toISOString(),...verification,sessionsInvalidated:true,pendingJobsInterrupted:true,activated:false};
  await writeDurable(join(target,'recovery.json'),JSON.stringify(result,null,2)+'\n');
  await syncRecoveryDirectory(target);await syncRecoveryDirectory(dirname(target));
  return result;
 }catch(error){if(created)await rm(target,{recursive:true,force:true});throw error;}
 finally{decoded.vaultKey.fill(0);decoded.database.fill(0);}
}
export async function drillRecoveryBundle(bundle:Buffer,passphrase:string,workRoot:string){
 await privateDirectory(workRoot);
 const work=await mkdtemp(join(workRoot,'.recovery-drill-'));
 try{return await restoreRecoveryBundle(bundle,passphrase,join(work,'restored'));}
 finally{await rm(work,{recursive:true,force:true});}
}
