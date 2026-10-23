import type {FastifyInstance} from 'fastify';
import type {DatabaseSync} from 'node:sqlite';
import type {JobQueue} from './jobs.js';
import type {Vault} from './vault.js';
import {randomBytes} from 'node:crypto';
import {databaseSecret} from './databases.js';
export const wordpressSecret=(id:string)=>{if(!/^app_[a-f0-9]{16}$/.test(id))throw Error('invalid_wordpress_request');return 'app.'+id+'.admin';};
type Reservation={id:string;actor:string;request_key:string;metadata:string;database_id:string};
type Deps={db:DatabaseSync;vault:Vault;jobs:JobQueue;agentUrl:string;agentToken:string;requestUser:(r:any)=>{id:string;role:string}|null|undefined;sameOrigin:(r:any)=>boolean;stepUp:(id:string,password:string,mfaCode?:unknown)=>string;audit:(actor:string|null,action:string,details?:unknown)=>void};
export function wordpressJobPayload(db:DatabaseSync,vault:Vault,id:string){
 const row=db.prepare('SELECT * FROM wordpress_requests WHERE id=?').get(id) as Reservation|undefined;
 if(!row)throw Error('wordpress_request_missing');
 const databasePassword=vault.get(databaseSecret(row.database_id)),adminPassword=vault.get(wordpressSecret(id));
 if(!databasePassword||!adminPassword)throw Error('wordpress_credentials_missing');
 return {id,databaseId:row.database_id,...JSON.parse(row.metadata),databasePassword,adminPassword};
}
export function registerWordPress(app:FastifyInstance,deps:Deps){
 const {db,vault,jobs}=deps;
 db.exec('CREATE TABLE IF NOT EXISTS wordpress_requests(id TEXT PRIMARY KEY,actor TEXT NOT NULL REFERENCES users(id),request_key TEXT NOT NULL,metadata TEXT NOT NULL,database_id TEXT NOT NULL,UNIQUE(actor,request_key));');
 const attempts=new Map<string,{n:number;until:number}>();const timer=setInterval(()=>{for(const [id,a] of attempts)if(a.until<Date.now())attempts.delete(id);},60000);timer.unref();app.addHook('onClose',async()=>clearInterval(timer));
 function owner(r:any,reply:any,mutation=false){
  const u=deps.requestUser(r);if(!u){reply.code(401).send({error:'unauthorized'});return null;}
  if(u.role!=='owner'){reply.code(403).send({error:'owner_required'});return null;}
  if(mutation&&(!r.headers.origin||!deps.sameOrigin(r))){reply.code(403).send({error:'origin_forbidden'});return null;}
  reply.header('Cache-Control','no-store');return u;
 }
 function verify(u:{id:string},b:{password?:unknown;mfaCode?:unknown},reply:any){
  if(typeof b.password!=='string'||!b.password||b.password.length>1024||(b.mfaCode!==undefined&&typeof b.mfaCode!=='string')){reply.code(400).send({error:'owner_confirmation_required'});return false;}
  const now=Date.now(),a=attempts.get(u.id)??{n:0,until:now+60000};if(a.until<=now){a.n=0;a.until=now+60000;}if(a.n>=5){reply.code(429).send({error:'wordpress_rate_limited'});return false;}a.n++;attempts.set(u.id,a);
  const result=deps.stepUp(u.id,b.password,b.mfaCode);if(result!=='ok'){reply.code(403).send({error:result==='password_invalid'?'owner_password_invalid':result});return false;}return true;
 }
 async function inventory(){
  if(!deps.agentToken)throw Error();
  const r=await fetch(deps.agentUrl+'/v1/sites',{headers:{Authorization:'Bearer '+deps.agentToken},signal:AbortSignal.timeout(6000),redirect:'error'});if(!r.ok)throw Error();
  return (await r.json() as {sites:{id:string;domain:string;tls?:boolean;state:string;application?:{id:string;appId:string;stage:string;databaseId:string}}[]}).sites;
 }
 app.get('/api/apps/wordpress',async(r,reply)=>{
  if(!owner(r,reply))return;
  const rows=db.prepare("SELECT r.id,r.metadata,j.id AS jobId,j.state,j.error FROM wordpress_requests r LEFT JOIN jobs j ON j.requested_by=r.actor AND j.request_key=r.request_key AND j.operation='wordpress.install' ORDER BY r.rowid DESC LIMIT 25").all() as {id:string;metadata:string;jobId?:string;state?:string;error?:string}[];
  return {installations:rows.map(row=>({id:row.id,...JSON.parse(row.metadata),job:row.jobId?{id:row.jobId,state:row.state,error:row.error}:null}))};
 });
 app.post('/api/apps/wordpress/install',async(r,reply)=>{
  const u=owner(r,reply,true);if(!u)return;
  const b=r.body as Record<string,unknown>|null;
  if(!b||Array.isArray(b)||Object.keys(b).some(k=>!['siteId','domain','expectedRevision','title','email','confirmed','requestKey','password','mfaCode'].includes(k))||b.confirmed!==true||typeof b.requestKey!=='string'||!/^[a-zA-Z0-9_-]{16,128}$/.test(b.requestKey)||typeof b.title!=='string'||b.title.trim()!==b.title||b.title.length<1||b.title.length>120||/[\x00-\x1f\x7f<>]/.test(b.title)||typeof b.email!=='string'||b.email.length>254||! /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9.-]*[a-zA-Z0-9])?\.[a-zA-Z]{2,63}$/.test(b.email))return reply.code(400).send({error:'invalid_wordpress_request'});
  if(b.siteId!==undefined?(typeof b.siteId!=='string'||!/^site_[a-f0-9]{16}$/.test(b.siteId)||!Number.isSafeInteger(b.expectedRevision)||Number(b.expectedRevision)<1||b.domain!==undefined):(b.expectedRevision!==undefined||typeof b.domain!=='string'||b.domain.length>253||!b.domain.split('.').every(p=>/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(p))||! /\.[a-z]{2,63}$/.test(b.domain)))return reply.code(400).send({error:'invalid_wordpress_target'});
  if(!verify(u,b,reply))return;
  const metadata=JSON.stringify({title:b.title,email:b.email,...(b.siteId?{siteId:b.siteId,expectedRevision:b.expectedRevision}:{domain:b.domain})});
  let row=db.prepare('SELECT * FROM wordpress_requests WHERE actor=? AND request_key=?').get(u.id,b.requestKey) as Reservation|undefined;
  if(row&&row.metadata!==metadata)return reply.code(409).send({error:'request_key_conflict'});
  try{
   if(!row){
    const id='app_'+randomBytes(8).toString('hex'),databaseId='db_'+randomBytes(8).toString('hex');
    db.exec('BEGIN IMMEDIATE');try{
     vault.put(databaseSecret(databaseId),randomBytes(32).toString('hex'),u.id);vault.put(wordpressSecret(id),randomBytes(32).toString('hex'),u.id);
     db.prepare('INSERT INTO wordpress_requests VALUES(?,?,?,?,?)').run(id,u.id,b.requestKey,metadata,databaseId);db.exec('COMMIT');
    }catch(e){db.exec('ROLLBACK');throw e;}
    row={id,actor:u.id,request_key:b.requestKey,metadata,database_id:databaseId};
   }
   return reply.code(202).send({job:jobs.enqueue(u.id,b.requestKey,{id:row.id},'wordpress.install'),installationId:row.id});
  }catch(e){const conflict=e instanceof Error&&e.message==='request_key_conflict';return reply.code(conflict?409:503).send({error:conflict?'request_key_conflict':'wordpress_request_unavailable'});}
 });
 app.get<{Params:{id:string}}>('/api/apps/wordpress/:id',async(r,reply)=>{
  if(!owner(r,reply))return;if(!/^app_[a-f0-9]{16}$/.test(r.params.id))return reply.code(400).send({error:'invalid_wordpress_request'});
  if(!db.prepare('SELECT id FROM wordpress_requests WHERE id=?').get(r.params.id))return reply.code(404).send({error:'installation_not_found'});
  try{const site=(await inventory()).find(s=>s.application?.id===r.params.id);return {installation:site?{id:r.params.id,siteId:site.id,domain:site.domain,state:site.state,stage:site.application!.stage,tls:site.tls===true}:null};}catch{return reply.code(503).send({error:'wordpress_status_unavailable'});}
 });
 app.post<{Params:{id:string}}>('/api/apps/wordpress/:id/credentials',async(r,reply)=>{
  const u=owner(r,reply,true);if(!u)return;
  const b=r.body as Record<string,unknown>|null;
  if(!/^app_[a-f0-9]{16}$/.test(r.params.id)||!b||Array.isArray(b)||b.confirmed!==true||Object.keys(b).some(k=>!['password','mfaCode','confirmed'].includes(k)))return reply.code(400).send({error:'invalid_wordpress_request'});
  if(!verify(u,b,reply))return;
  try{
   const site=(await inventory()).find(s=>s.application?.id===r.params.id&&s.state==='ready'&&s.application.stage==='complete');
   if(!site)return reply.code(409).send({error:'wordpress_not_ready'});
   if(!site.tls)return reply.code(409).send({error:'wordpress_https_required'});
   const password=vault.get(wordpressSecret(r.params.id));if(!password)throw Error();
   deps.audit(u.id,'wordpress.credentials_revealed',{id:r.params.id,siteId:site.id});
   return {username:'devone_admin',password,loginUrl:'https://'+site.domain+'/wp-login.php'};
  }catch{return reply.code(503).send({error:'wordpress_credentials_unavailable'});}
 });
}
