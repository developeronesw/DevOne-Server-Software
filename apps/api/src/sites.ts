import type { FastifyInstance } from 'fastify';
import type { JobQueue } from './jobs.js';
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
  app.post('/api/sites/files',{bodyLimit:1500000},async (request,reply) => {
    const user = authorize(request,reply,true); if (!user) return;
    const body = request.body as Record<string,unknown> | null;
    if (!body || typeof body.siteId !== 'string' || !/^site_[a-f0-9]{16}$/.test(body.siteId) || !['list','read','create','replace','rename','mkdir','remove'].includes(body.operation as string) || typeof body.path !== 'string' || body.path.length > 1024) return reply.code(400).send({error:'invalid_file_operation'});
    if (['replace','rename'].includes(body.operation as string) && (typeof body.expectedRevision !== 'string' || !/^[a-f0-9]{64}$/.test(body.expectedRevision))) return reply.code(400).send({error:'invalid_revision'});
    if (body.operation === 'rename' && (typeof body.destination !== 'string' || body.destination.length > 1024)) return reply.code(400).send({error:'invalid_destination'});
    const mutation = !['list','read'].includes(body.operation as string);
    if (mutation && body.confirmed !== true) return reply.code(400).send({error:'confirmation_required'});
    const details = { siteId:body.siteId, operation:body.operation, path:body.path, ...(body.operation === 'rename' ? {destination:body.destination} : {}) };
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
