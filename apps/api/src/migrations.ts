import type {FastifyInstance} from 'fastify';
import type {DatabaseSync} from 'node:sqlite';
import {Readable} from 'node:stream';
import {lstat} from 'node:fs/promises';
const validId=(x:unknown):x is string=>typeof x==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(x);
type Deps={db:DatabaseSync;agentUrl:string;agentToken:string;panelUrl:string;requestUser:(r:any)=>{id:string;role:string}|null|undefined;sameOrigin:(r:any)=>boolean;stepUp:(id:string,password:string,mfaCode?:unknown)=>string;audit:(id:string|null,action:string,details?:unknown)=>void;maintenance?:()=>Promise<boolean>};
export function registerMigrations(app:FastifyInstance,deps:Deps){
 const attempts=new Map<string,{n:number;until:number}>(),timer=setInterval(()=>{for(const [id,a] of attempts)if(a.until<Date.now())attempts.delete(id);},60000);timer.unref();app.addHook('onClose',async()=>clearInterval(timer));
 deps.db.exec('CREATE TABLE IF NOT EXISTS migration_uploads(id TEXT PRIMARY KEY,actor TEXT NOT NULL);');
 async function agent(path:string,body?:unknown){
  if(!deps.agentToken)throw Error('migration_agent_unconfigured');
  const response=await fetch(deps.agentUrl+'/v1/migrations/'+path,{method:body===undefined?'GET':'POST',redirect:'error',headers:{Authorization:'Bearer '+deps.agentToken,...(body===undefined?{}:{'Content-Type':'application/json'})},...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(path==='start'?45000:15000)});
  const result=await response.json() as any;if(!response.ok)throw Error(typeof result.error==='string'&&/^migration_[a-z_]+$/.test(result.error)?result.error:'migration_unavailable');return result;
 }
 // Maintenance covers direct panel mutations as well as Agent jobs. Reads/login remain available.
 app.addHook('preHandler',async(r,reply)=>{
  if(['GET','HEAD','OPTIONS'].includes(r.method)||r.url.startsWith('/api/migrations')||['/api/auth/login','/api/auth/logout'].includes(r.url.split('?')[0]))return;
  try{const locked=deps.maintenance?await deps.maintenance():await lstat('/var/lib/devone-migration.guard').then(s=>{if(!s.isFile()||s.isSymbolicLink()||s.uid!==0||(s.mode&0o022))throw Error();return true;}).catch(e=>{if(e.code==='ENOENT')return false;throw e;});if(locked)return reply.code(409).send({error:'migration_maintenance'});}
  catch{return reply.code(503).send({error:'migration_guard_unavailable'});}
 });
 function owner(r:any,reply:any,write=false){
  reply.header('Cache-Control','no-store');reply.header('X-Content-Type-Options','nosniff');const u=deps.requestUser(r);
  if(!u){reply.code(401).send({error:'unauthorized'});return null;}if(u.role!=='owner'){reply.code(403).send({error:'owner_required'});return null;}
  if(write&&(!r.headers.origin||!deps.sameOrigin(r))){reply.code(403).send({error:'origin_forbidden'});return null;}if(!deps.panelUrl.startsWith('https://')){reply.code(409).send({error:'migration_https_required'});return null;}return u;
 }
 function approve(u:{id:string},b:any,reply:any){
  if(!b||b.confirmed!==true||typeof b.password!=='string'||!b.password||b.password.length>1024||b.mfaCode!==undefined&&(typeof b.mfaCode!=='string'||b.mfaCode.length>64)){reply.code(400).send({error:'owner_confirmation_required'});return false;}
  const now=Date.now();let a=attempts.get(u.id);if(!a||a.until<=now)a={n:0,until:now+60000};if(a.n>=5){reply.code(429).send({error:'migration_rate_limited'});return false;}a.n++;attempts.set(u.id,a);const result=deps.stepUp(u.id,b.password,b.mfaCode);if(result!=='ok'){reply.code(403).send({error:result==='password_invalid'?'owner_password_invalid':result});return false;}return true;
 }
 const strict=(b:unknown,keys:string[])=>Boolean(b&&typeof b==='object'&&!Array.isArray(b)&&Object.keys(b).every(k=>keys.includes(k)));
 const fail=(reply:any,e:unknown)=>{const code=e instanceof Error&&/^migration_[a-z_]+$/.test(e.message)?e.message:'migration_unavailable';return reply.code(code.includes('busy')||code.includes('conflict')||code.includes('fresh')?409:503).send({error:code});};
 app.get('/api/migrations',async(r,reply)=>{if(!owner(r,reply))return;try{return await agent('status');}catch(e){return fail(reply,e);}});
 app.post('/api/migrations/start',async(r,reply)=>{
  const u=owner(r,reply,true);if(!u)return;const b=r.body as Record<string,unknown>;
  if(!strict(b,['operation','passphrase','passphraseConfirm','uploadId','planId','confirmTarget','confirmed','password','mfaCode','acceptScope','acceptDowntime','acceptAccountReplacement','stopWorker','keepSourcePaused'])||!['export','inspect','apply','resume','rollback','discard'].includes(String(b.operation)))return reply.code(400).send({error:'migration_request_invalid'});
  if(b.operation==='export'&&(b.acceptScope!==true||b.acceptDowntime!==true||b.passphrase!==b.passphraseConfirm)||b.operation==='apply'&&(b.acceptAccountReplacement!==true||b.confirmTarget!==new URL(deps.panelUrl).hostname))return reply.code(400).send({error:'migration_scope_confirmation_required'});
  if(['export','inspect'].includes(String(b.operation))&&(typeof b.passphrase!=='string'||b.passphrase.length<16||b.passphrase.length>128||/[\x00-\x1f\x7f]/.test(b.passphrase)))return reply.code(400).send({error:'migration_passphrase_invalid'});
  if(b.operation==='inspect'&&!validId(b.uploadId)||['apply','resume','rollback','discard'].includes(String(b.operation))&&!validId(b.planId))return reply.code(400).send({error:'migration_request_invalid'});
  if(!approve(u,b,reply))return;
  const payload={operation:b.operation,...(['export','inspect'].includes(String(b.operation))?{passphrase:b.passphrase}:{}),...(b.operation==='export'?{keepSourcePaused:b.keepSourcePaused===true}:{}),...(b.operation==='inspect'?{uploadId:b.uploadId}:{}),...(['apply','resume','rollback','discard'].includes(String(b.operation))?{planId:b.planId,...(b.operation==='apply'?{confirmTarget:b.confirmTarget}:{}),...(b.stopWorker===true?{stopWorker:true}:{})}:{})};
  try{const job=await agent('start',payload);deps.audit(u.id,'migration.started',{id:job.id,operation:b.operation});return reply.code(202).send({job});}catch(e){return fail(reply,e);}
 });
 app.post('/api/migrations/uploads',async(r,reply)=>{
  const u=owner(r,reply,true);if(!u)return;const b=r.body as Record<string,unknown>;if(!strict(b,['bytes','confirmed','password','mfaCode'])||!Number.isSafeInteger(b.bytes)||Number(b.bytes)<64||Number(b.bytes)>1024**4)return reply.code(400).send({error:'migration_upload_size_invalid'});if(!approve(u,b,reply))return;
  try{const result=await agent('upload/start',{bytes:b.bytes});deps.db.prepare('INSERT INTO migration_uploads VALUES(?,?)').run(result.id,u.id);deps.audit(u.id,'migration.upload_started',{id:result.id,bytes:b.bytes});return reply.code(201).send(result);}catch(e){return fail(reply,e);}
 });
 app.post('/api/migrations/uploads/chunk',{bodyLimit:6*1024*1024},async(r,reply)=>{
  const u=owner(r,reply,true);if(!u)return;const b=r.body as Record<string,unknown>;if(!strict(b,['id','offset','content'])||!validId(b.id)||!Number.isSafeInteger(b.offset)||Number(b.offset)<0||typeof b.content!=='string'||b.content.length>5592408)return reply.code(400).send({error:'migration_upload_invalid'});
  const row=deps.db.prepare('SELECT actor FROM migration_uploads WHERE id=?').get(b.id) as {actor:string}|undefined;if(!row||row.actor!==u.id)return reply.code(403).send({error:'migration_upload_owner_required'});
  try{return await agent('upload/chunk',b);}catch(e){return fail(reply,e);}
 });
 app.post('/api/migrations/delete',async(r,reply)=>{
  const u=owner(r,reply,true);if(!u)return;const b=r.body as Record<string,unknown>;if(!strict(b,['kind','id','confirmed','password','mfaCode'])||!['export','upload','plan'].includes(String(b.kind))||!validId(b.id))return reply.code(400).send({error:'migration_request_invalid'});if(!approve(u,b,reply))return;
  try{const result=await agent('delete',{kind:b.kind,id:b.id});if(b.kind==='upload')deps.db.prepare('DELETE FROM migration_uploads WHERE id=?').run(b.id);deps.audit(u.id,'migration.deleted',{kind:b.kind,id:b.id});return result;}catch(e){return fail(reply,e);}
 });
 app.get<{Params:{id:string}}>('/api/migrations/exports/:id/download',async(r,reply)=>{
  const u=owner(r,reply);if(!u)return;if(!validId(r.params.id))return reply.code(400).send({error:'migration_request_invalid'});
  try{const response=await fetch(deps.agentUrl+'/v1/migrations/exports/'+r.params.id,{headers:{Authorization:'Bearer '+deps.agentToken},redirect:'error',signal:AbortSignal.timeout(3600000)});if(!response.ok||!response.body)throw Error();reply.header('Content-Type','application/octet-stream');reply.header('Content-Disposition','attachment; filename="devone-'+r.params.id+'.devone-migration"');if(response.headers.has('content-length'))reply.header('Content-Length',response.headers.get('content-length')!);deps.audit(u.id,'migration.downloaded',{id:r.params.id});return reply.send(Readable.fromWeb(response.body as any));}catch{return reply.code(404).send({error:'migration_export_unavailable'});}
 });
}
