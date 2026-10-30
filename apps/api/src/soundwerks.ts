import {validInstallAccount,sameInstallPassword} from './install-account.js';
import {databaseSecret} from './databases.js';
import {randomBytes} from 'node:crypto';
import type {FastifyInstance} from 'fastify';
import type {DatabaseSync} from 'node:sqlite';
import type {JobQueue} from './jobs.js';
import type {Vault} from './vault.js';

type Reservation={id:string;actor:string;request_key:string;metadata:string;database_id:string};
type Deps={db:DatabaseSync;vault:Vault;jobs:JobQueue;agentUrl:string;agentToken:string;
 requestUser:(r:any)=>{id:string;role:string}|null|undefined;
 sameOrigin:(r:any)=>boolean;stepUp:(id:string,password:string,mfaCode?:unknown)=>string;
 audit:(actor:string|null,event:string,details?:unknown)=>void};
export const soundwerksSecret=(id:string)=>{
 if(!/^app_[a-f0-9]{16}$/.test(id))throw Error('invalid_soundwerks_request');
 return 'soundwerks.'+id+'.admin';
};
export function soundwerksJobPayload(db:DatabaseSync,vault:Vault,id:string){
 const row=db.prepare('SELECT * FROM soundwerks_requests WHERE id=?').get(id) as Reservation|undefined;
 if(!row)throw Error('soundwerks_request_missing');
 const databasePassword=vault.get(databaseSecret(row.database_id));
 const adminPassword=vault.get(soundwerksSecret(id));
 if(!databasePassword||!adminPassword)throw Error('soundwerks_credentials_missing');
 return {id,databaseId:row.database_id,...JSON.parse(row.metadata),databasePassword,adminPassword};
}
export function registerSoundwerks(app:FastifyInstance,deps:Deps){
 const {db,vault,jobs}=deps;
 db.exec('CREATE TABLE IF NOT EXISTS soundwerks_requests(id TEXT PRIMARY KEY,actor TEXT NOT NULL REFERENCES users(id),request_key TEXT NOT NULL,metadata TEXT NOT NULL,database_id TEXT NOT NULL,UNIQUE(actor,request_key));');
 const attempts=new Map<string,{n:number;until:number}>();
 const timer=setInterval(()=>{for(const [id,a] of attempts)if(a.until<Date.now())attempts.delete(id);},60000);
 timer.unref();app.addHook('onClose',async()=>clearInterval(timer));
 function owner(req:any,reply:any,mutation=false){
  const user=deps.requestUser(req);
  if(!user){reply.code(401).send({error:'unauthorized'});return null;}
  if(user.role!=='owner'){reply.code(403).send({error:'owner_required'});return null;}
  if(mutation&&(!req.headers.origin||!deps.sameOrigin(req))){reply.code(403).send({error:'origin_forbidden'});return null;}
  reply.header('Cache-Control','no-store');return user;
 }
 function verify(user:{id:string},b:{password?:unknown;mfaCode?:unknown},reply:any){
  if(typeof b.password!=='string'||!b.password||b.password.length>1024||
   (b.mfaCode!==undefined&&typeof b.mfaCode!=='string')){
   reply.code(400).send({error:'owner_confirmation_required'});return false;
  }
  const now=Date.now(),a=attempts.get(user.id)??{n:0,until:now+60000};
  if(a.until<=now){a.n=0;a.until=now+60000;}
  if(a.n>=5){reply.code(429).send({error:'soundwerks_rate_limited'});return false;}
  a.n++;attempts.set(user.id,a);
  const checked=deps.stepUp(user.id,b.password,b.mfaCode);
  if(checked!=='ok'){reply.code(403).send({error:checked==='password_invalid'?'owner_password_invalid':checked});return false;}
  return true;
 }
 async function inventory(){
  if(!deps.agentToken)throw Error();
  const response=await fetch(deps.agentUrl+'/v1/sites',{
   headers:{Authorization:'Bearer '+deps.agentToken},redirect:'error',signal:AbortSignal.timeout(6000)
  });
  if(!response.ok)throw Error();
  return (await response.json() as {sites:Array<{id:string;domain:string;tls?:boolean;state:string;
   application?:{id:string;appId:string;stage:string;databaseId?:string}}>}).sites;
 }
 app.get('/api/apps/soundwerks',async(req,reply)=>{
  if(!owner(req,reply))return;
  const rows=db.prepare("SELECT r.id,r.metadata,j.id AS jobId,j.state,j.error FROM soundwerks_requests r LEFT JOIN jobs j ON j.requested_by=r.actor AND j.request_key=r.request_key AND j.operation='soundwerks.install' ORDER BY r.rowid DESC LIMIT 25").all() as Array<{id:string;metadata:string;jobId?:string;state?:string;error?:string}>;
  return {installations:rows.map(row=>({id:row.id,...JSON.parse(row.metadata),job:row.jobId?{id:row.jobId,state:row.state,error:row.error}:null}))};
 });
 app.post('/api/apps/soundwerks/install',async(req,reply)=>{
  const user=owner(req,reply,true);if(!user)return;
  const b=req.body as Record<string,unknown>|null;
  if(!b||Array.isArray(b)||Object.keys(b).some(k=>!['siteId','domain','expectedRevision','title','email','adminUsername','adminPassword','adminPasswordConfirm','confirmed','requestKey','password','mfaCode'].includes(k))||
   b.confirmed!==true||typeof b.requestKey!=='string'||!/^[a-zA-Z0-9_-]{16,128}$/.test(b.requestKey)||
   typeof b.title!=='string'||b.title.trim()!==b.title||b.title.length<2||b.title.length>90||
   /[\x00-\x1f\x7f<>]/.test(b.title)||
   typeof b.email!=='string'||b.email.length>254||
   !/^[^@\s]+@[^@\s]+\.[a-zA-Z]{2,63}$/.test(b.email))
   return reply.code(400).send({error:'invalid_soundwerks_request'});
  if(b.siteId!==undefined?
   (typeof b.siteId!=='string'||!/^site_[a-f0-9]{16}$/.test(b.siteId)||
    !Number.isSafeInteger(b.expectedRevision)||Number(b.expectedRevision)<1||b.domain!==undefined):
   (b.expectedRevision!==undefined||typeof b.domain!=='string'||b.domain.length>253||
    !b.domain.split('.').every(p=>/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(p))||
    !/\.[a-z]{2,63}$/.test(b.domain)))
   return reply.code(400).send({error:'invalid_soundwerks_target'});
  if(!validInstallAccount(b))return reply.code(400).send({error:'invalid_administrator_account'});
  if(!verify(user,b,reply))return;
  const metadata=JSON.stringify({title:b.title,email:b.email,adminUsername:b.adminUsername,
   ...(b.siteId?{siteId:b.siteId,expectedRevision:b.expectedRevision}:{domain:b.domain})});
  let row=db.prepare('SELECT * FROM soundwerks_requests WHERE actor=? AND request_key=?').get(user.id,b.requestKey) as Reservation|undefined;
  if(row&&(row.metadata!==metadata||!sameInstallPassword(vault.get(soundwerksSecret(row.id)),b.adminPassword as string)))
   return reply.code(409).send({error:'request_key_conflict'});
  try{
   if(!row){
    const id='app_'+randomBytes(8).toString('hex'),databaseId='db_'+randomBytes(8).toString('hex');
    db.exec('BEGIN IMMEDIATE');
    try{
     vault.put(databaseSecret(databaseId),randomBytes(32).toString('hex'),user.id);
     vault.put(soundwerksSecret(id),b.adminPassword as string,user.id);
     db.prepare('INSERT INTO soundwerks_requests VALUES(?,?,?,?,?)').run(id,user.id,b.requestKey,metadata,databaseId);
     db.exec('COMMIT');
    }catch(e){db.exec('ROLLBACK');throw e;}
    row={id,actor:user.id,request_key:b.requestKey,metadata,database_id:databaseId};
   }
   const job=jobs.enqueue(user.id,b.requestKey,{id:row.id},'soundwerks.install');
   deps.audit(user.id,'soundwerks.install_authorized',{id:row.id,jobId:job.id});
   return reply.code(202).send({job,installationId:row.id});
  }catch(e){
   const conflict=e instanceof Error&&e.message==='request_key_conflict';
   return reply.code(conflict?409:503).send({error:conflict?'request_key_conflict':'soundwerks_request_unavailable'});
  }
 });
 app.get<{Params:{id:string}}>('/api/apps/soundwerks/:id',async(req,reply)=>{
  if(!owner(req,reply))return;
  if(!/^app_[a-f0-9]{16}$/.test(req.params.id))return reply.code(400).send({error:'invalid_soundwerks_request'});
  if(!db.prepare('SELECT id FROM soundwerks_requests WHERE id=?').get(req.params.id))return reply.code(404).send({error:'installation_not_found'});
  try{
   const site=(await inventory()).find(s=>s.application?.id===req.params.id&&s.application.appId==='creative-soundwerks');
   return {installation:site?{id:req.params.id,siteId:site.id,domain:site.domain,state:site.state,stage:site.application!.stage,tls:site.tls===true}:null};
  }catch{return reply.code(503).send({error:'soundwerks_status_unavailable'});}
 });
 app.post<{Params:{id:string}}>('/api/apps/soundwerks/:id/credentials',async(req,reply)=>{
  const user=owner(req,reply,true);if(!user)return;
  const b=req.body as Record<string,unknown>|null;
  if(!/^app_[a-f0-9]{16}$/.test(req.params.id)||!b||Array.isArray(b)||b.confirmed!==true||
   Object.keys(b).some(k=>!['password','mfaCode','confirmed'].includes(k)))
   return reply.code(400).send({error:'invalid_soundwerks_request'});
  if(!verify(user,b,reply))return;
  try{
   const site=(await inventory()).find(s=>s.application?.id===req.params.id&&s.application.appId==='creative-soundwerks'&&
    s.state==='ready'&&s.application.stage==='complete');
   if(!site)return reply.code(409).send({error:'soundwerks_not_ready'});
   if(!site.tls)return reply.code(409).send({error:'soundwerks_https_required'});
   const adminPassword=vault.get(soundwerksSecret(req.params.id));
   if(!adminPassword)throw Error();
   const reservation=db.prepare('SELECT metadata FROM soundwerks_requests WHERE id=?').get(req.params.id) as {metadata:string}|undefined;
   if(!reservation)throw Error();
   deps.audit(user.id,'soundwerks.credentials_revealed',{id:req.params.id,siteId:site.id});
   return {username:JSON.parse(reservation.metadata).adminUsername,password:adminPassword,loginUrl:'https://'+site.domain+'/login'};
  }catch{return reply.code(503).send({error:'soundwerks_credentials_unavailable'});}
 });
}
