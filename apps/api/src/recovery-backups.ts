import type {FastifyInstance} from 'fastify';
import type {DatabaseSync} from 'node:sqlite';
import {randomUUID,createHash} from 'node:crypto';
import {readdir,lstat,open,rename,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {createRecoveryBundle,drillRecoveryBundle,maxBundleBytes,privateDirectory,readPrivateFile,recoveryScope,syncRecoveryDirectory,validRecoveryPassphrase} from './recovery.js';

type Deps={db:DatabaseSync;keyPath:string;folder:string;panelUrl:string;requestUser:(r:any)=>{id:string;role:string}|null|undefined;sameOrigin:(r:any)=>boolean;stepUp:(id:string,password:string,mfaCode?:unknown)=>string;audit:(id:string|null,action:string,details?:unknown)=>void};
const validId=(id:unknown):id is string=>typeof id==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(id);
const warning='Includes DevOne control database and vault key. Excludes website files, application databases, Agent registry, TLS certificates and host configuration. Offline restore creates an inactive copy; full-server recovery remains unfinished.';
export function registerRecoveryBackups(app:FastifyInstance,deps:Deps){
 const folder=join(deps.folder,'recovery');let busy=false;
 const attempts=new Map<string,{n:number;until:number}>();let lastCreate=0;
 deps.db.exec('CREATE TABLE IF NOT EXISTS recovery_drills(id TEXT PRIMARY KEY,sha256 TEXT NOT NULL,verified_at TEXT NOT NULL);');
 const timer=setInterval(()=>{for(const [id,value] of attempts)if(value.until<Date.now())attempts.delete(id);},60000);timer.unref();app.addHook('onClose',async()=>clearInterval(timer));
 const path=(id:string)=>join(folder,'control-'+id+'.devone');
 function owner(r:any,reply:any,mutation=false){
  reply.header('Cache-Control','no-store');reply.header('X-Content-Type-Options','nosniff');
  const user=deps.requestUser(r);if(!user){reply.code(401).send({error:'unauthorized'});return null;}
  if(user.role!=='owner'){reply.code(403).send({error:'owner_required'});return null;}
  if(mutation&&(!r.headers.origin||!deps.sameOrigin(r))){reply.code(403).send({error:'origin_forbidden'});return null;}
  if(!deps.panelUrl.startsWith('https://')){reply.code(409).send({error:'recovery_https_required'});return null;}
  return user;
 }
 function approve(user:{id:string},body:Record<string,unknown>,reply:any){
  if(body.confirmed!==true||typeof body.password!=='string'||!body.password||body.password.length>1024||(body.mfaCode!==undefined&&(typeof body.mfaCode!=='string'||body.mfaCode.length>64))){reply.code(400).send({error:'owner_confirmation_required'});return false;}
  const now=Date.now();let a=attempts.get(user.id);if(!a||a.until<=now)a={n:0,until:now+60000};
  if(a.n>=5){reply.code(429).send({error:'recovery_rate_limited'});return false;}a.n++;attempts.set(user.id,a);
  const result=deps.stepUp(user.id,body.password,body.mfaCode);
  if(result!=='ok'){reply.code(403).send({error:result==='password_invalid'?'owner_password_invalid':result});return false;}
  return true;
 }
 function body(value:unknown,extra:string[]){
  if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(k=>!['confirmed','password','mfaCode',...extra].includes(k)))return null;
  return value as Record<string,unknown>;
 }
 async function list(){
  await privateDirectory(folder);const result=[];
  for(const name of await readdir(folder)){
   const id=name.startsWith('control-')&&name.endsWith('.devone')?name.slice(8,-7):'';if(!validId(id))continue;
   const stat=await lstat(path(id));if(!stat.isFile()||stat.isSymbolicLink()||(stat.mode&0o077)!==0||stat.size>maxBundleBytes)throw Error('recovery_file_invalid');
   const drill=deps.db.prepare('SELECT verified_at FROM recovery_drills WHERE id=?').get(id) as {verified_at:string}|undefined;
   result.push({id,createdAt:stat.mtime.toISOString(),bytes:stat.size,lastVerifiedAt:drill?.verified_at??null});
  }
  return result.sort((a,b)=>b.createdAt.localeCompare(a.createdAt));
 }
 app.get('/api/backups/recovery',async(r,reply)=>{
  if(!owner(r,reply))return;
  try{return {bundles:await list(),scope:recoveryScope,warning,maxBundles:10,maxDatabaseMiB:32,restoreMode:'offline-new-directory'};}
  catch{return reply.code(503).send({error:'recovery_inventory_unavailable'});}
 });
 app.post('/api/backups/recovery',async(r,reply)=>{
  const user=owner(r,reply,true);if(!user)return;
  const b=body(r.body,['passphrase','passphraseConfirm']);
  if(!b||!validRecoveryPassphrase(b.passphrase)||b.passphraseConfirm!==b.passphrase)return reply.code(400).send({error:'invalid_recovery_passphrase'});
  if(busy)return reply.code(409).send({error:'recovery_busy'});
  if(Date.now()-lastCreate<60000)return reply.code(429).send({error:'recovery_create_rate_limited'});
  if(!approve(user,b,reply))return;
  busy=true;lastCreate=Date.now();let temporary:string|undefined;
  try{
   if((await list()).length>=10)return reply.code(409).send({error:'recovery_limit_reached'});
   const {bundle,createdAt,sha256}=await createRecoveryBundle(deps.db,deps.keyPath,b.passphrase,folder);
   const id=randomUUID();temporary=path(id)+'.partial';
   const file=await open(temporary,'wx',0o600);try{await file.writeFile(bundle);await file.sync();}finally{await file.close();}
   await rename(temporary,path(id));temporary=undefined;
   await syncRecoveryDirectory(folder);
   deps.audit(user.id,'backup.recovery_created',{id,bytes:bundle.length,sha256});
   return reply.code(201).send({id,createdAt,bytes:bundle.length,sha256,scope:recoveryScope,warning});
  }catch(error){
   const code=error instanceof Error?error.message:'';
   return reply.code(code==='recovery_database_too_large'?413:503).send({error:['recovery_database_too_large','recovery_disk_space_low'].includes(code)?code:'recovery_create_failed'});
  }
  finally{if(temporary)await rm(temporary,{force:true});busy=false;}
 });
 app.get<{Params:{id:string}}>('/api/backups/recovery/:id/download',async(r,reply)=>{
  const user=owner(r,reply);if(!user)return;
  if(!validId(r.params.id))return reply.code(400).send({error:'invalid_recovery_id'});
  try{
   await privateDirectory(folder);const bundle=await readPrivateFile(path(r.params.id),maxBundleBytes);
   reply.header('Content-Type','application/octet-stream');reply.header('Content-Disposition','attachment; filename="control-'+r.params.id+'.devone"');
   deps.audit(user.id,'backup.recovery_downloaded',{id:r.params.id});return reply.send(bundle);
  }catch{return reply.code(404).send({error:'recovery_bundle_unavailable'});}
 });
 app.post<{Params:{id:string}}>('/api/backups/recovery/:id/verify',async(r,reply)=>{
  const user=owner(r,reply,true);if(!user)return;
  const b=body(r.body,['passphrase']);
  if(!validId(r.params.id)||!b||!validRecoveryPassphrase(b.passphrase))return reply.code(400).send({error:'invalid_recovery_request'});
  if(busy)return reply.code(409).send({error:'recovery_busy'});
  if(!approve(user,b,reply))return;
  busy=true;
  try{
   await privateDirectory(folder);const bundle=await readPrivateFile(path(r.params.id),maxBundleBytes);
   const result=await drillRecoveryBundle(bundle,b.passphrase,folder),sha256=createHash('sha256').update(bundle).digest('hex');
   deps.db.prepare('INSERT INTO recovery_drills VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET sha256=excluded.sha256,verified_at=excluded.verified_at').run(r.params.id,sha256,result.verifiedAt);
   deps.audit(user.id,'backup.recovery_verified',{id:r.params.id,sha256});
   return {id:r.params.id,sha256,status:'passed',...result,liveStateReplaced:false,warning};
  }catch{
   deps.db.prepare('DELETE FROM recovery_drills WHERE id=?').run(r.params.id);
   deps.audit(user.id,'backup.recovery_verification_failed',{id:r.params.id});
   return reply.code(422).send({error:'recovery_verification_failed'});
  }finally{busy=false;}
 });
 app.post<{Params:{id:string}}>('/api/backups/recovery/:id/delete',async(r,reply)=>{
  const user=owner(r,reply,true);if(!user)return;
  const b=body(r.body,[]);if(!validId(r.params.id)||!b)return reply.code(400).send({error:'invalid_recovery_request'});
  if(busy)return reply.code(409).send({error:'recovery_busy'});
  if(!approve(user,b,reply))return;
  busy=true;
  try{
   await privateDirectory(folder);const stat=await lstat(path(r.params.id));if(!stat.isFile()||stat.isSymbolicLink())throw Error();
   await rm(path(r.params.id));await syncRecoveryDirectory(folder);deps.db.prepare('DELETE FROM recovery_drills WHERE id=?').run(r.params.id);
   deps.audit(user.id,'backup.recovery_deleted',{id:r.params.id});return {deleted:true,id:r.params.id};
  }catch{return reply.code(404).send({error:'recovery_bundle_unavailable'});}
  finally{busy=false;}
 });
}
