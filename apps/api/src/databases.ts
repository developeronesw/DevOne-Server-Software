import type {FastifyInstance} from 'fastify';
import type {DatabaseSync} from 'node:sqlite';
import {randomBytes} from 'node:crypto';
import type {Vault} from './vault.js';
import type {JobQueue} from './jobs.js';
export const databaseSecret=(id:string)=>{if(!/^db_[a-f0-9]{16}$/.test(id))throw Error('invalid_database');return 'database.'+id+'.password';};
type Deps={db:DatabaseSync;vault:Vault;jobs:JobQueue;agentUrl:string;agentToken:string;requestUser:(r:any)=>{id:string;role:string}|null|undefined;sameOrigin:(r:any)=>boolean;audit:(actor:string|null,action:string,details?:unknown)=>void;stepUp:(id:string,password:string,mfaCode?:unknown)=>string};
export function registerDatabases(app:FastifyInstance,deps:Deps){
 const {db,vault,jobs}=deps;db.exec(`CREATE TABLE IF NOT EXISTS database_requests(id TEXT PRIMARY KEY,actor TEXT NOT NULL REFERENCES users(id),request_key TEXT NOT NULL,site_id TEXT NOT NULL,engine TEXT NOT NULL,created_at TEXT NOT NULL,UNIQUE(actor,request_key));`);
 const attempts=new Map<string,{count:number;reset:number}>();const timer=setInterval(()=>{for(const [k,v] of attempts)if(v.reset<Date.now())attempts.delete(k);},60000);timer.unref();app.addHook('onClose',async()=>clearInterval(timer));
 function authorize(r:any,reply:any,mutation=false){
  const user=deps.requestUser(r);if(!user){reply.code(401).send({error:'unauthorized'});return null;}
  if(user.role!=='owner'){reply.code(403).send({error:'owner_required'});return null;}
  if(mutation&&(!r.headers.origin||!deps.sameOrigin(r))){reply.code(403).send({error:'origin_forbidden'});return null;}
  reply.header('Cache-Control','no-store');return user;
 }
 function stepUp(user:{id:string},body:{password?:unknown;mfaCode?:unknown},reply:any){
  if(typeof body.password!=='string'||!body.password||body.password.length>1024||(body.mfaCode!==undefined&&typeof body.mfaCode!=='string')){reply.code(400).send({error:'database_confirmation_required'});return false;}
  const now=Date.now(),a=attempts.get(user.id)??{count:0,reset:now+60000};if(a.reset<=now){a.count=0;a.reset=now+60000;}if(a.count>=5){reply.code(429).send({error:'database_rate_limited'});return false;}a.count++;attempts.set(user.id,a);
  const verified=deps.stepUp(user.id,body.password,body.mfaCode);if(verified!=='ok'){reply.code(403).send({error:verified==='password_invalid'?'owner_password_invalid':verified});return false;}return true;
 }
 async function inventory(){if(!deps.agentToken)throw Error();const r=await fetch(deps.agentUrl+'/v1/databases',{headers:{Authorization:'Bearer '+deps.agentToken},signal:AbortSignal.timeout(6000),redirect:'error'});if(!r.ok)throw Error();return r.json() as Promise<{databases:{id:string;state:string;name:string;username:string;host:string;siteId:string;engine:string}[]}>;}
 app.get('/api/databases',async(r,reply)=>{if(!authorize(r,reply))return;try{return await inventory();}catch{return reply.code(503).send({error:'databases_unavailable'});}});
 app.post('/api/databases',async(r,reply)=>{
  const user=authorize(r,reply,true);if(!user)return;
  const b=r.body as {siteId?:unknown;engine?:unknown;requestKey?:unknown;confirmed?:unknown;password?:unknown;mfaCode?:unknown}|null;
  if(!b||Array.isArray(b)||Object.keys(b).some(k=>!['siteId','engine','requestKey','confirmed','password','mfaCode'].includes(k))||b.confirmed!==true||typeof b.siteId!=='string'||!/^site_[a-f0-9]{16}$/.test(b.siteId)||!['mariadb','postgresql'].includes(b.engine as string)||typeof b.requestKey!=='string'||!/^[a-zA-Z0-9_-]{16,128}$/.test(b.requestKey))return reply.code(400).send({error:'invalid_database_request'});
  if(!stepUp(user,b,reply))return;
  let request=db.prepare('SELECT * FROM database_requests WHERE actor=? AND request_key=?').get(user.id,b.requestKey) as {id:string;site_id:string;engine:string}|undefined;
  if(request&&(request.site_id!==b.siteId||request.engine!==b.engine))return reply.code(409).send({error:'request_key_conflict'});
  try{
   if(!request){
    const id='db_'+randomBytes(8).toString('hex');
    db.exec('BEGIN IMMEDIATE');try{vault.put(databaseSecret(id),randomBytes(32).toString('hex'),user.id);db.prepare('INSERT INTO database_requests VALUES(?,?,?,?,?,?)').run(id,user.id,b.requestKey,b.siteId,b.engine as string,new Date().toISOString());db.exec('COMMIT');}catch(e){db.exec('ROLLBACK');throw e;}
    request={id,site_id:b.siteId,engine:b.engine as string};
   }
   const job=jobs.enqueue(user.id,b.requestKey,{id:request.id,siteId:request.site_id,engine:request.engine as 'mariadb'|'postgresql'},'database.create');return reply.code(202).send({job,databaseId:request.id});
  }catch(e){const code=e instanceof Error?e.message:'';return reply.code(code==='request_key_conflict'?409:503).send({error:code==='request_key_conflict'?code:'database_request_unavailable'});}
 });
 app.post<{Params:{id:string}}>('/api/databases/:id/credentials',async(r,reply)=>{
  const user=authorize(r,reply,true);if(!user)return;
  const b=r.body as {password?:unknown;mfaCode?:unknown;confirmed?:unknown}|null;
  if(!/^db_[a-f0-9]{16}$/.test(r.params.id)||!b||Array.isArray(b)||b.confirmed!==true||Object.keys(b).some(k=>!['password','mfaCode','confirmed'].includes(k)))return reply.code(400).send({error:'invalid_database_request'});
  if(!stepUp(user,b,reply))return;
  try{
   const record=(await inventory()).databases.find(d=>d.id===r.params.id&&d.state==='ready');if(!record)return reply.code(409).send({error:'database_not_ready'});
   const password=vault.get(databaseSecret(record.id));if(!password)return reply.code(409).send({error:'database_credentials_missing'});
   deps.audit(user.id,'database.credentials_revealed',{id:record.id});return {id:record.id,database:record.name,username:record.username,host:record.host,port:record.engine==='postgresql'?5432:3306,password};
  }catch{return reply.code(503).send({error:'database_credentials_unavailable'});}
 });
}
