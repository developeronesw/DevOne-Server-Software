import type { FastifyInstance } from 'fastify';
import type { JobQueue, SiteActionInput, SiteTlsInput } from './jobs.js';
type Dependencies = { requestUser: (request: any) => {id:string;role:string} | undefined | null; sameOrigin: (request:any) => boolean; agentUrl:string; agentToken:string; jobs:JobQueue; audit:(actor:string|null,action:string,details?:unknown)=>void };
function validDomain(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 253 && value.includes('.') && /^[a-z]{2,63}$/.test(value.split('.').at(-1)!) && value.split('.').every(label => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label));
}
export function registerSiteRoutes(app: FastifyInstance, dependencies: Dependencies) {
  const {requestUser,sameOrigin,agentUrl,agentToken,jobs,audit} = dependencies;
  const authorize = (request:any,reply:any,mutation=false) => {
    const user = requestUser(request);
    if (!user) { reply.code(401).send({error:'unauthorized'}); return null; }
    if (!['owner','admin'].includes(user.role)) { reply.code(403).send({error:'forbidden'}); return null; }
    if (mutation && (!request.headers.origin || !sameOrigin(request))) { reply.code(403).send({error:'origin_forbidden'}); return null; }
    return user;
  };
  app.get('/api/sites',async (request,reply) => {
    if (!authorize(request,reply)) return;
    try {
      if (!agentToken) throw new Error();
      const response = await fetch(`${agentUrl}/v1/sites`,{headers:{Authorization:`Bearer ${agentToken}`},signal:AbortSignal.timeout(5000)});
      if (!response.ok) throw new Error();
      return await response.json();
    } catch { return reply.code(503).send({error:'sites_unavailable'}); }
  });
  // Advisory preflight; Agent repeats all validations when applying changes.
  app.post('/api/sites/preflight',async (request,reply) => {
    const user = authorize(request,reply,true); if (!user) return;
    const body = request.body as Record<string,unknown> | null;
    if (!body || !validDomain(body.domain) || !['nginx','none'].includes(body.webServer as string) || (body.aliases !== undefined && (!Array.isArray(body.aliases) || body.aliases.length > 20 || !body.aliases.every(validDomain))) || (body.siteId !== undefined && (typeof body.siteId !== 'string' || !/^site_[a-f0-9]{16}$/.test(body.siteId) || !Number.isSafeInteger(body.expectedRevision)))) return reply.code(400).send({error:'invalid_site_preflight'});
    try {
      if (!agentToken) throw new Error();
      const response = await fetch(`${agentUrl}/v1/sites/preflight`,{method:'POST',headers:{Authorization:`Bearer ${agentToken}`,'Content-Type':'application/json'},body:JSON.stringify({domain:body.domain,aliases:body.aliases,webServer:body.webServer,siteId:body.siteId,expectedRevision:body.expectedRevision}),signal:AbortSignal.timeout(8000)});
      const result = await response.json() as {error?:string};
      if (!response.ok) return reply.code(response.status === 409 ? 409 : response.status === 400 ? 400 : 503).send({error:response.status === 409 && result.error === 'domain_in_use' ? 'domain_in_use' : 'preflight_failed'});
      return result;
    } catch {return reply.code(503).send({error:'preflight_unavailable'});}
  });
  app.post('/api/sites',async (request,reply) => {
    const user = authorize(request,reply,true); if (!user) return;
    const body = request.body as Record<string,unknown> | null;
    if (!body || body.confirmed !== true || !validDomain(body.domain) || !['nginx','none'].includes(body.webServer as string) || typeof body.requestKey !== 'string') return reply.code(400).send({error:'invalid_site'});
    try {
      return reply.code(202).send({job:jobs.enqueue(user.id,body.requestKey,{domain:body.domain,webServer:body.webServer as 'nginx'|'none'},'site.create')});
    } catch (error) {
      const code = error instanceof Error ? error.message : 'queue_error';
      return reply.code(code === 'request_key_conflict' ? 409 : ['queue_full','queue_stopping'].includes(code) ? 503 : 400).send({error:code});
    }
  });
  app.post('/api/sites/action',async(request,reply)=>{
    const user = authorize(request,reply,true); if (!user) return;
    const body = request.body as Record<string,unknown> | null;
    if (!body || typeof body.siteId !== 'string' || !/^site_[a-f0-9]{16}$/.test(body.siteId) || !['update','disable','enable','delete'].includes(body.action as string) || body.confirmed !== true || typeof body.requestKey !== 'string' || !Number.isSafeInteger(body.expectedRevision) || Number(body.expectedRevision) < 1) return reply.code(400).send({error:'invalid_site_action'});
    if (body.action === 'update' && (!validDomain(body.domain) || !Array.isArray(body.aliases) || body.aliases.length > 20 || !body.aliases.every(validDomain))) return reply.code(400).send({error:'invalid_site_domains'});
    if (body.action === 'delete' && !validDomain(body.confirmDomain)) return reply.code(400).send({error:'delete_confirmation_required'});
    const input:SiteActionInput={siteId:body.siteId,action:body.action as string,expectedRevision:body.expectedRevision as number};
    if(body.action === 'update') {input.domain=body.domain as string;input.aliases=body.aliases as string[];}
    if(body.action === 'delete') input.confirmDomain=body.confirmDomain as string;
    try {return reply.code(202).send({job:jobs.enqueue(user.id,body.requestKey,input,'site.action')});}
    catch(error) {const code=error instanceof Error ? error.message : 'queue_error';return reply.code(code === 'request_key_conflict' ? 409 : ['queue_full','queue_stopping'].includes(code) ? 503 : 400).send({error:code});}
  });
  app.get<{Params:{siteId:string}}>('/api/sites/:siteId/tls/status',async (request,reply) => {
    if (!authorize(request,reply)) return;
    if (!/^site_[a-f0-9]{16}$/.test(request.params.siteId)) return reply.code(400).send({error:'invalid_site'});
    try {
      if (!agentToken) throw new Error();
      const response = await fetch(`${agentUrl}/v1/sites/tls/status?siteId=${encodeURIComponent(request.params.siteId)}`,{headers:{Authorization:`Bearer ${agentToken}`},signal:AbortSignal.timeout(5000)});
      if (!response.ok) throw new Error();
      return await response.json();
    } catch {return reply.code(503).send({error:'tls_status_unavailable'});}
  });
  app.post('/api/sites/tls',async(request,reply)=>{
    const user=authorize(request,reply,true);if(!user) return;
    const body=request.body as Record<string,unknown> | null;
    if(!body || typeof body.siteId !== 'string' || !/^site_[a-f0-9]{16}$/.test(body.siteId) || !['issue','renew','disable'].includes(body.action as string) || body.confirmed !== true || typeof body.requestKey !== 'string' || !Number.isSafeInteger(body.expectedRevision) || Number(body.expectedRevision)<1) return reply.code(400).send({error:'invalid_tls_operation'});
    if(body.action === 'issue' && (body.agreeTerms !== true || typeof body.email !== 'string' || body.email.length>254 || !/^[a-zA-Z0-9][a-zA-Z0-9._+%-]*@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,63}$/.test(body.email))) return reply.code(400).send({error:'tls_consent_required'});
    const input:SiteTlsInput={siteId:body.siteId,action:body.action as string,expectedRevision:body.expectedRevision as number};
    if(body.action === 'issue') {input.email=body.email as string;input.agreeTerms=true;}
    try {return reply.code(202).send({job:jobs.enqueue(user.id,body.requestKey,input,'site.tls')});}
    catch(error){const code=error instanceof Error ? error.message : 'queue_error';return reply.code(code === 'request_key_conflict' ? 409 : ['queue_full','queue_stopping'].includes(code) ? 503 : 400).send({error:code});}
  });
  app.post('/api/sites/files',{bodyLimit:1500000},async (request,reply) => {
    const user = authorize(request,reply,true); if (!user) return;
    const body = request.body as Record<string,unknown> | null;
    if (!body || typeof body.siteId !== 'string' || !/^site_[a-f0-9]{16}$/.test(body.siteId) || !['list','read','create','replace','rename','copy','mkdir','remove'].includes(body.operation as string) || typeof body.path !== 'string' || body.path.length > 1024) return reply.code(400).send({error:'invalid_file_operation'});
    if (['replace','rename','copy'].includes(body.operation as string) && (typeof body.expectedRevision !== 'string' || !/^[a-f0-9]{64}$/.test(body.expectedRevision))) return reply.code(400).send({error:'invalid_revision'});
    if (['rename','copy'].includes(body.operation as string) && (typeof body.destination !== 'string' || body.destination.length > 1024)) return reply.code(400).send({error:'invalid_destination'});
    const mutation = !['list','read'].includes(body.operation as string);
    if (mutation && body.confirmed !== true) return reply.code(400).send({error:'confirmation_required'});
    const details = { siteId:body.siteId, operation:body.operation, path:body.path, ...(['rename','copy'].includes(body.operation as string) ? {destination:body.destination} : {}) };
    try {
      if (!agentToken) throw new Error();
      if (mutation) audit(user.id,'site.file.requested',details);
      const response = await fetch(`${agentUrl}/v1/sites/files`,{method:'POST',headers:{Authorization:`Bearer ${agentToken}`,'Content-Type':'application/json'},body:JSON.stringify({siteId:body.siteId,operation:body.operation,path:body.path,content:body.content,kind:body.kind,expectedRevision:body.expectedRevision,destination:body.destination}),signal:AbortSignal.timeout(20000)});
      if (!response.ok) { if (mutation) audit(user.id,'site.file.failed',details); const result = await response.json() as {error?:string}; return reply.code(response.status === 409 ? 409 : response.status >= 500 ? 503 : 400).send({error:response.status === 409 && ['file_conflict','destination_exists'].includes(result.error ?? '') ? result.error : 'file_operation_failed'}); }
      const result = await response.json();
      if (mutation) audit(user.id,'site.file.completed',details);
      return result;
    } catch { return reply.code(503).send({error:mutation ? 'file_outcome_requires_inspection' : 'files_unavailable'}); }
  });
}
