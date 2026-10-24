import {atomicMigrationJson,privateMigrationJson,privateMigrationDirectory,defaultMigrationConfig} from './migration-engine.js';
import {validMigrationId,maxMigrationBytes} from './migration-crypto.js';
import {existsSync,constants} from 'node:fs';
import {mkdir,rm,lstat,readdir,open,statfs} from 'node:fs/promises';
import {join} from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {spawn} from 'node:child_process';
export const migrationRoot=defaultMigrationConfig.root;
export async function releaseMigrationLock(root=migrationRoot){const guard=root===migrationRoot?'/var/lib/devone-migration.guard':join(root,'migration.guard');await rm(guard,{force:true});await rm(join(root,'lock'),{recursive:true,force:true});}
export const maxMigrationChunk=4*1024*1024;
export type MigrationJob={id:string;operation:'export'|'inspect'|'apply'|'resume'|'rollback'|'discard';state:'running'|'paused'|'succeeded'|'failed'|'needs_inspection';phase:string;startedAt:string;updatedAt:string;error?:string;result?:unknown;planId?:string};
const operations=['export','inspect','apply','resume','rollback','discard'];
function launch(id:string,value:Record<string,unknown>){
 return new Promise<void>((resolve,reject)=>{
  const child=spawn('/usr/bin/systemd-run',['--quiet','--pipe','--wait','--collect','--unit=devone-migration-'+id,'--property=Type=exec','--property=TimeoutStartSec=infinity','--property=TimeoutStopSec=30','/usr/bin/node','/opt/devone/current/agent/dist/migration-worker.js',id],{stdio:['pipe','ignore','ignore']});
  child.on('error',()=>reject(Error('migration_worker_unavailable')));child.on('spawn',()=>{child.stdin.on('error',()=>{});child.stdin.end(JSON.stringify(value));resolve();});child.unref();
 });
}
export class Migrations{
 constructor(readonly root=migrationRoot,private activeOperations:()=>number=()=>0,private launcher=launch){}
 locked(){return existsSync(join(this.root,'lock'));}
 async state(){
  await privateMigrationDirectory(this.root);let job:MigrationJob|null=null;
  try{job=await privateMigrationJson(join(this.root,'latest.json'));}catch(e){if((e as any).code!=='ENOENT')throw e;}
  const exports=[];await privateMigrationDirectory(join(this.root,'exports'));
  for(const name of await readdir(join(this.root,'exports')))if(/^[a-f0-9-]{36}\.json$/.test(name))exports.push(await privateMigrationJson(join(this.root,'exports',name)));
  const uploads=[];await privateMigrationDirectory(join(this.root,'uploads'));
  for(const name of await readdir(join(this.root,'uploads')))if(/^[a-f0-9-]{36}\.json$/.test(name)){const u=await privateMigrationJson(join(this.root,'uploads',name));uploads.push({id:u.id,bytes:u.bytes,received:u.received,createdAt:u.createdAt,firstChunkSha256:u.firstChunkSha256});}
  const plans=[];await privateMigrationDirectory(join(this.root,'plans'));
  for(const name of await readdir(join(this.root,'plans')))if(validMigrationId(name)){try{plans.push(await privateMigrationJson(join(this.root,'plans',name,'plan.json')));}catch(e){if((e as any).code!=='ENOENT')throw e;}}
  let recoveryOperation:string|null=null,recoveryId:string|null=null,interrupted=false;
  if(this.locked()){const owner=await privateMigrationJson(join(this.root,'lock','owner.json'));const original=owner.sourceOperation??owner.operation;recoveryOperation=original==='export'?'resume':original==='apply'?'rollback':'discard';recoveryId=owner.planId??owner.id;
   if(job?.state==='running'&&Date.now()-Date.parse(job.updatedAt)>10000){const {migrationCommand}=await import('./migration-sql.js');interrupted=!['active','activating','reloading','deactivating'].includes((await migrationCommand('/usr/bin/systemctl',['is-active','devone-migration-'+job.id+'.service']).catch(()=>'')).trim());}}
  return {locked:this.locked(),job,recoveryOperation,recoveryId,interrupted,exports:exports.sort((a,b)=>b.createdAt.localeCompare(a.createdAt)),uploads,plans,scope:'devone-managed-server',maxUploadBytes:maxMigrationBytes};
 }
 async start(value:unknown){
  if(!value||typeof value!=='object'||Array.isArray(value))throw Error('migration_request_invalid');const b=value as Record<string,unknown>;
  if(Object.keys(b).some(k=>!['operation','passphrase','uploadId','planId','confirmTarget','stopWorker','keepSourcePaused'].includes(k))||!operations.includes(String(b.operation)))throw Error('migration_request_invalid');
  if(b.operation==='export'&&Object.keys(b).some(k=>!['operation','passphrase','keepSourcePaused'].includes(k))||b.operation==='inspect'&&(!validMigrationId(b.uploadId)||Object.keys(b).some(k=>!['operation','passphrase','uploadId'].includes(k)))||['apply','resume','rollback','discard'].includes(String(b.operation))&&(!validMigrationId(b.planId)||Object.keys(b).some(k=>!['operation','planId','confirmTarget','stopWorker','keepSourcePaused'].includes(k))))throw Error('migration_request_invalid');
  if(['export','inspect'].includes(String(b.operation))&&(typeof b.passphrase!=='string'||b.passphrase.length<16||b.passphrase.length>128))throw Error('migration_passphrase_invalid');
  await privateMigrationDirectory(this.root);
  if(b.operation==='export'){await privateMigrationDirectory(join(this.root,'exports'));if((await readdir(join(this.root,'exports'))).filter(f=>f.endsWith('.devone-migration')).length>=3)throw Error('migration_export_limit');}
  if(this.root===migrationRoot){try{const update=await privateMigrationJson('/var/lib/devone-agent/update-status.json');if(['queued','running'].includes(update.state))throw Error('migration_update_active');}catch(e){if((e as any).code!=='ENOENT')throw e;}}
  if(['resume','rollback','discard'].includes(String(b.operation))){
   if(!this.locked())throw Error('migration_recovery_not_needed');
   const old=await privateMigrationJson(join(this.root,'latest.json')) as MigrationJob;
   const owner=await privateMigrationJson(join(this.root,'lock','owner.json'));const original=owner.sourceOperation??owner.operation;if(b.planId!==owner.planId&&b.planId!==owner.id||b.operation==='resume'&&original!=='export'||b.operation==='rollback'&&original!=='apply'||b.operation==='discard'&&original!=='inspect')throw Error('migration_recovery_invalid');
   if(old.state==='running'){
    const unit='devone-migration-'+old.id+'.service';
    const {migrationCommand}=await import('./migration-sql.js');if(['active','activating','deactivating','reloading'].includes((await migrationCommand('/usr/bin/systemctl',['is-active',unit]).catch(()=>'')).trim())){if(b.stopWorker!==true)throw Error('migration_busy');await migrationCommand('/usr/bin/systemctl',['stop',unit],'',{},40000);}
   }
  }else{
   try{await mkdir(join(this.root,'lock'),{mode:0o700});}catch{throw Error('migration_busy');}
   if(this.activeOperations()>0){await rm(join(this.root,'lock'),{recursive:true});throw Error('migration_host_operation_active');}
  }
  const previous=['resume','rollback','discard'].includes(String(b.operation))?await privateMigrationJson(join(this.root,'lock','owner.json')):null;
  const id=randomUUID(),stamp=new Date().toISOString(),job:MigrationJob={id,operation:b.operation as MigrationJob['operation'],state:'running',phase:'starting',startedAt:stamp,updatedAt:stamp,...(typeof b.planId==='string'?{planId:b.planId}:{})};
  await atomicMigrationJson(join(this.root,'lock','owner.json'),{id,operation:b.operation,planId:b.planId??id,sourceOperation:previous?.sourceOperation??previous?.operation??b.operation});
  const guard=this.root===migrationRoot?'/var/lib/devone-migration.guard':join(this.root,'migration.guard');const marker=await open(guard,'w',0o644);try{await marker.writeFile(id);await marker.sync();}finally{await marker.close();}await atomicMigrationJson(join(this.root,'latest.json'),job);
  try{await this.launcher(id,b);}catch{job.state='failed';job.error='migration_worker_unavailable';await atomicMigrationJson(join(this.root,'latest.json'),job);if(!['resume','rollback','discard'].includes(String(b.operation)))await releaseMigrationLock(this.root);throw Error('migration_worker_unavailable');}
  return job;
 }
 private uploadsBusy=new Set<string>();
 async createUpload(bytes:unknown){
  if(this.locked())throw Error('migration_busy');if(!Number.isSafeInteger(bytes)||Number(bytes)<64||Number(bytes)>maxMigrationBytes)throw Error('migration_upload_size_invalid');
  await privateMigrationDirectory(join(this.root,'uploads'));const files=(await readdir(join(this.root,'uploads'))).filter(f=>f.endsWith('.json'));if(files.length>=3)throw Error('migration_upload_limit');
  const disk=await statfs(this.root);if(disk.bavail*disk.bsize<Number(bytes)*3+512*1024*1024)throw Error('migration_disk_space_low');
  const id=randomUUID(),path=join(this.root,'uploads',id+'.devone-migration'),f=await open(path,'wx',0o600);await f.close();const upload={id,bytes,received:0,createdAt:new Date().toISOString()};await atomicMigrationJson(join(this.root,'uploads',id+'.json'),upload);return upload;
 }
 async uploadChunk(value:unknown){
  const b=value as {id:string;offset:number;content:string};if(!b||Array.isArray(b)||Object.keys(b).some(k=>!['id','offset','content'].includes(k))||!validMigrationId(b.id)||!Number.isSafeInteger(b.offset)||b.offset<0||typeof b.content!=='string'||b.content.length>Math.ceil(maxMigrationChunk/3)*4||!/^[A-Za-z0-9+/]*={0,2}$/.test(b.content))throw Error('migration_upload_invalid');
  if(this.locked()||this.uploadsBusy.has(b.id))throw Error('migration_busy');this.uploadsBusy.add(b.id);
  try{
   const meta=await privateMigrationJson(join(this.root,'uploads',b.id+'.json')),data=Buffer.from(b.content,'base64');if(!data.length||data.length>maxMigrationChunk||data.toString('base64')!==b.content||b.offset+data.length>meta.bytes)throw Error('migration_upload_invalid');
   const file=await open(join(this.root,'uploads',b.id+'.devone-migration'),constants.O_RDWR|constants.O_NOFOLLOW);try{const s=await file.stat();if(!s.isFile()||s.nlink!==1||(s.mode&0o077)||s.uid!==process.getuid?.())throw Error('migration_unsafe_file');
    if(b.offset<s.size&&b.offset+data.length<=s.size){const old=Buffer.alloc(data.length);await file.read(old,0,old.length,b.offset);if(!old.equals(data))throw Error('migration_upload_conflict');meta.received=s.size;if(b.offset===0)meta.firstChunkSha256=createHash('sha256').update(data).digest('hex');await atomicMigrationJson(join(this.root,'uploads',b.id+'.json'),meta);return {id:b.id,received:s.size,bytes:meta.bytes};}
    if(b.offset!==s.size)throw Error('migration_upload_conflict');let written=0;while(written<data.length)written+=(await file.write(data,written,data.length-written,b.offset+written)).bytesWritten;await file.sync();meta.received=b.offset+data.length;if(b.offset===0)meta.firstChunkSha256=createHash('sha256').update(data).digest('hex');
   }finally{await file.close();}await atomicMigrationJson(join(this.root,'uploads',b.id+'.json'),meta);return {id:b.id,received:meta.received,bytes:meta.bytes};
  }finally{this.uploadsBusy.delete(b.id);}
 }
 async remove(value:unknown){
  const b=value as {kind:string;id:string};if(!b||Object.keys(b).some(k=>!['kind','id'].includes(k))||!['export','upload','plan'].includes(b.kind)||!validMigrationId(b.id))throw Error('migration_request_invalid');if(this.locked()||this.uploadsBusy.has(b.id))throw Error('migration_busy');
  if(b.kind==='plan'){await rm(join(this.root,'plans',b.id),{recursive:true,force:true});return {deleted:true};}
  const folder=b.kind==='export'?'exports':'uploads';await rm(join(this.root,folder,b.id+'.devone-migration'),{force:true});await rm(join(this.root,folder,b.id+'.json'),{force:true});return {deleted:true};
 }
 async download(id:unknown){if(!validMigrationId(id))throw Error('migration_request_invalid');const path=join(this.root,'exports',id+'.devone-migration'),st=await lstat(path);if(!st.isFile()||st.isSymbolicLink()||st.nlink!==1||st.uid!==process.getuid?.()||(st.mode&0o077)||st.size>maxMigrationBytes)throw Error('migration_unsafe_file');return {path,bytes:st.size};}
}
