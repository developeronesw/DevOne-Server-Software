import {MigrationEngine,defaultMigrationConfig,atomicMigrationJson,privateMigrationJson} from './migration-engine.js';
import {migrationRoot,releaseMigrationLock,type MigrationJob} from './migrations.js';
import {validMigrationId} from './migration-crypto.js';
import {readFile,rm,lstat} from 'node:fs/promises';
import {join} from 'node:path';
async function main(){
 process.umask(0o077);if(process.getuid?.()!==0)throw Error();const id=process.argv[2];if(!validMigrationId(id))throw Error();
 let raw='';for await(const chunk of process.stdin){raw+=chunk;if(Buffer.byteLength(raw)>2048)throw Error();}const input=JSON.parse(raw);
 const owner=await privateMigrationJson(join(migrationRoot,'lock','owner.json'));if(owner.id!==id||owner.operation!==input.operation)throw Error();
 const env=await readFile('/etc/devone/devone.env','utf8'),values=Object.fromEntries(env.split('\n').filter(l=>/^[A-Z_]+=/.test(l)).map(l=>[l.slice(0,l.indexOf('=')),l.slice(l.indexOf('=')+1)]));
 if(values.DEVONE_DB_PATH!=='/var/lib/devone/devone.sqlite'||values.DEVONE_MASTER_KEY_FILE!=='/etc/devone/secrets.key'||values.DEVONE_BACKUP_DIR&&values.DEVONE_BACKUP_DIR!=='/var/lib/devone/backups'||!values.DEVONE_PANEL_URL?.startsWith('https://'))throw Error('migration_custom_install_paths');
 let job=await privateMigrationJson(join(migrationRoot,'latest.json')) as MigrationJob;
 const progress=async(phase:string,extra?:Record<string,unknown>)=>{job={...job,phase,updatedAt:new Date().toISOString(),...extra};await atomicMigrationJson(join(migrationRoot,'latest.json'),job);};
 const engine=new MigrationEngine({...defaultMigrationConfig,panelUrl:values.DEVONE_PANEL_URL},progress);
 try{
  let result;
  if(input.operation==='export')result=await engine.export(id,input.passphrase,input.keepSourcePaused===true);
  else if(input.operation==='inspect'){
   const upload=await privateMigrationJson(join(migrationRoot,'uploads',input.uploadId+'.json'));if(upload.received!==upload.bytes)throw Error('migration_upload_incomplete');result=await engine.inspect(id,input.uploadId,input.passphrase);
  }else if(input.operation==='apply')result=await engine.apply(input.planId,input.confirmTarget);
  else if(input.operation==='resume'){await engine.resume(join(migrationRoot,'work',input.planId));await rm(join(migrationRoot,'work',input.planId),{recursive:true,force:true});if(!await lstat(join(migrationRoot,'exports',input.planId+'.json')).then(()=>true).catch(()=>false))await rm(join(migrationRoot,'exports',input.planId+'.devone-migration'),{force:true});result={resumed:true};}
  else if(input.operation==='rollback'){await engine.rollback(input.planId);result={rolledBack:true};}
  else if(input.operation==='discard'){await rm(join(migrationRoot,'plans',input.planId),{recursive:true,force:true});result={discarded:true};}
  else throw Error('migration_request_invalid');
  const paused=input.operation==='export'&&(result as any)?.sourcePaused===true;await progress(paused?'source-paused':'completed',{state:paused?'paused':'succeeded',result});if(!paused)await releaseMigrationLock();
 }catch(error){
  const message=error instanceof Error?error.message:'';const safe=/^migration_[a-z_]+$/.test(message)?message:'migration_operation_failed';
  const interruptedExport=await lstat(join(migrationRoot,'work',id,'resume.json')).then(()=>true).catch(()=>false),inspection=safe.includes('requires_inspection')||interruptedExport||['resume','rollback','discard'].includes(input.operation);
  await progress(inspection?'inspection-required':'failed',{state:inspection?'needs_inspection':'failed',error:safe});if(!inspection)await releaseMigrationLock();
 }
}
main().catch(async()=>{try{const id=process.argv[2];if(validMigrationId(id)){const job=await privateMigrationJson(join(migrationRoot,'latest.json'));if(job.id===id)await atomicMigrationJson(join(migrationRoot,'latest.json'),{...job,state:'needs_inspection',phase:'worker-start-failed',error:'migration_worker_start_failed',updatedAt:new Date().toISOString()});}}catch{}process.exitCode=1;});
