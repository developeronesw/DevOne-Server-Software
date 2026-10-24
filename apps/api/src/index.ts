import {registerCms,cmsJobPayload} from "./cms.js";
import {registerRecoveryBackups} from "./recovery-backups.js";
import {registerWordPress,wordpressJobPayload} from "./wordpress.js";
import {registerDatabases,databaseSecret} from "./databases.js";
import {registerDiagnostics} from "./diagnostics.js";
import {registerAppInstalls} from "./app-installs.js";
import { registerSiteRoutes } from "./sites.js";
import { registerControlRoutes } from "./control.js";
import {registerApplicationQa} from "./application-qa.js";
import {registerDisposableQaRoutes} from "./disposable-qa.js";
import { registerSecurityRoutes } from "./security.js";
import {registerSoftwareRoutes} from "./software.js";
import { listCatalog } from "./catalog.js";
import { JobQueue, OutcomeUnknown } from "./jobs.js";
import {assertAgentMutationResult} from "./job-agent-result.js";
import { Vault, validSecretName } from "./vault.js";
import Fastify from "fastify";
import { readFileSync, unlinkSync } from "node:fs";
import { timingSafeEqual } from "node:crypto";
import { audit, db, closeDb, createOwner, hasOwner, login, logout, userFromToken, verifyOwnerPassword, verifyOwnerStepUp, mfa, createSession, invalidateSessions } from "./auth.js";

const app = Fastify({ logger: { redact: ["req.headers.authorization", "req.headers.cookie", "req.headers.x-devone-setup-token"] }, bodyLimit: 16384 });
const version = "1.0.0-alpha.3";
const setupTokenFile = process.env.DEVONE_SETUP_TOKEN_FILE ?? "/var/lib/devone/owner-setup-token";
function setupTokenMatches(candidate: unknown) {
  if (typeof candidate !== "string" || !/^[0-9a-f]{64}$/.test(candidate)) return false;
  let secret: string;
  try { secret = readFileSync(setupTokenFile, "utf8").trim(); } catch { return false; }
  if (!/^[0-9a-f]{64}$/.test(secret)) return false;
  return timingSafeEqual(Buffer.from(candidate, "hex"), Buffer.from(secret, "hex"));
}
const panelUrl = process.env.DEVONE_PANEL_URL ?? "http://127.0.0.1:8787";
const agentUrl = process.env.DEVONE_AGENT_URL ?? "http://127.0.0.1:8790";
const agentToken = process.env.DEVONE_AGENT_TOKEN ?? "";

function cookies(raw?: string) {
  return Object.fromEntries((raw ?? "").split(";").filter(Boolean).map((part) => {
    const i = part.indexOf("=");
    return i < 0 ? [part.trim(), ""] : [part.slice(0, i).trim(), part.slice(i + 1).trim()];
  }));
}

function setSessionCookie(reply: any, token: string) {
  reply.header("Set-Cookie", `devone_session=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Secure; Max-Age=43200`);
}

function clearSessionCookie(reply: any) {
  reply.header("Set-Cookie", "devone_session=; Path=/; HttpOnly; SameSite=Lax; Secure; Max-Age=0");
}

function requestUser(request: any) {
  return userFromToken(cookies(request.headers.cookie).devone_session);
}

function sameOrigin(request: any) {
  const origin = request.headers.origin;
  if (!origin) return true;
  try {
    return new URL(origin).origin === new URL(panelUrl).origin;
  } catch {
    return false;
  }
}

async function agentHealth(path = "/v1/health") {
  if (!agentToken) return { ok: false, error: "agent_not_configured" };
  try {
    const response = await fetch(`${agentUrl}${path}`, {
      headers: { Authorization: `Bearer ${agentToken}` },
      signal: AbortSignal.timeout(1500)
    });
    return response.ok ? await response.json() : { ok: false, error: `agent_http_${response.status}` };
  } catch {
    return { ok: false, error: "agent_unreachable" };
  }
}

app.get("/api/health", async () => ({ ok: true, service: "devone-api", version }));
app.get("/api/setup/status", async (_request, reply) => {
  reply.header("Cache-Control", "no-store");
  return { setupRequired: !hasOwner(), panelUrl };
});

app.post("/api/auth/setup", async (request, reply) => {
  reply.header("Cache-Control", "no-store");
  if (hasOwner()) return reply.code(409).send({ error: "setup_complete" });
  if (!request.headers.origin || !sameOrigin(request)) return reply.code(403).send({ error: "origin_forbidden" });
  if (!setupTokenMatches(request.headers["x-devone-setup-token"])) return reply.code(403).send({ error: "setup_token_required" });
  const body = (request.body ?? {}) as { email?: string; password?: string };
  try {
    const email = body.email ?? "";
    const password = body.password ?? "";
    const user = createOwner(email, password);
    audit(user.id, "auth.setup_completed");
    try { unlinkSync(setupTokenFile); } catch (error) { app.log.warn({ err: error }, "Could not remove completed setup token"); }
    const session = login(email, password);
    if (!session || "mfaRequired" in session) return reply.code(503).send({ error: "setup_session_failed" });
    setSessionCookie(reply, session.token);
    return reply.send({ ok: true, user });
  } catch (error) {
    const code = error instanceof Error ? error.message : "setup_failed";
    return reply.code(code === "owner_exists" ? 409 : 400).send({ error: code });
  }
});

const loginAttempts = new Map<string, { count: number; expires: number }>();
app.addHook("onRequest", async (request, reply) => {
  if (request.method !== "POST" || !request.url.startsWith("/api/auth/")) return;
  const now = Date.now();
  for (const [ip, entry] of loginAttempts) if (entry.expires <= now) loginAttempts.delete(ip);
  const entry = loginAttempts.get(request.ip) ?? { count: 0, expires: now + 60000 };
  if (entry.count >= 10) return reply.code(429).send({ error: "rate_limited" });
  entry.count++;
  loginAttempts.set(request.ip, entry);
});

app.post("/api/auth/login", async (request, reply) => {
  if (!sameOrigin(request)) return reply.code(403).send({ error: "origin_forbidden" });
  const body = (request.body ?? {}) as { email?: string; password?: string; mfaCode?: string };
  const result = login(body.email ?? "", body.password ?? "", body.mfaCode);
  if (!result) return reply.code(401).send({ error: "invalid_credentials" });
  if ("mfaRequired" in result) return reply.send({mfaRequired:true});
  setSessionCookie(reply, result.token);
  return reply.send({ ok: true, user: result.user });
});

app.post("/api/auth/logout", async (request, reply) => {
  if (!sameOrigin(request)) return reply.code(403).send({ error: "origin_forbidden" });
  logout(cookies(request.headers.cookie).devone_session);
  clearSessionCookie(reply);
  return reply.send({ ok: true });
});

// MFA is opt-in; activation/disabling always requires password and a live Owner session.
// When enabled, a password alone never issues a login session.
app.get("/api/auth/mfa/status",async(request,reply)=>{
 const user=requestUser(request);
 if(!user)return reply.code(401).send({error:"unauthorized"});
 if(user.role!=="owner")return reply.code(403).send({error:"owner_required"});
 reply.header("Cache-Control","no-store");
 return mfa.status(user.id);
});
app.post("/api/auth/mfa/begin",async(request,reply)=>{
 const user=requestUser(request);
 if(!user)return reply.code(401).send({error:"unauthorized"});
 if(user.role!=="owner")return reply.code(403).send({error:"owner_required"});
 if(!request.headers.origin||!sameOrigin(request))return reply.code(403).send({error:"origin_forbidden"});
 const body=request.body as {password?:unknown}|null;
 if(!verifyOwnerPassword(user.id,body?.password))return reply.code(403).send({error:"owner_password_invalid"});
 try{
  const result=mfa.begin(user.id,user.email);
  audit(user.id,"auth.mfa_enrollment_started");
  reply.header("Cache-Control","no-store");
  return result;
 }catch(e){return reply.code(409).send({error:e instanceof Error&&e.message==="mfa_already_enabled"?e.message:"mfa_unavailable"});}
});
app.post("/api/auth/mfa/confirm",async(request,reply)=>{
 const user=requestUser(request);
 if(!user)return reply.code(401).send({error:"unauthorized"});
 if(user.role!=="owner")return reply.code(403).send({error:"owner_required"});
 if(!request.headers.origin||!sameOrigin(request))return reply.code(403).send({error:"origin_forbidden"});
 const code=(request.body as {code?:unknown}|null)?.code;
 try{
  const recoveryCodes=mfa.confirm(user.id,code);
  invalidateSessions(user.id);
  const session=createSession(user.id);
  setSessionCookie(reply,session.token);
  audit(user.id,"auth.mfa_enabled");
  reply.header("Cache-Control","no-store");
  return {enabled:true,recoveryCodes};
 }catch(e){
  const code=e instanceof Error?e.message:"mfa_failed";
  return reply.code(["mfa_setup_expired","invalid_mfa_code"].includes(code)?400:503).send({error:["mfa_setup_expired","invalid_mfa_code"].includes(code)?code:"mfa_failed"});
 }
});
app.post("/api/auth/mfa/disable",async(request,reply)=>{
 const user=requestUser(request);
 if(!user)return reply.code(401).send({error:"unauthorized"});
 if(user.role!=="owner")return reply.code(403).send({error:"owner_required"});
 if(!request.headers.origin||!sameOrigin(request))return reply.code(403).send({error:"origin_forbidden"});
 const body=request.body as {password?:unknown;code?:unknown}|null;
 if(!verifyOwnerPassword(user.id,body?.password))return reply.code(403).send({error:"owner_password_invalid"});
 try{
  mfa.disable(user.id,body?.code);
  invalidateSessions(user.id);
  const session=createSession(user.id);
  setSessionCookie(reply,session.token);
  audit(user.id,"auth.mfa_disabled");
  return {enabled:false};
 }catch(e){
  const code=e instanceof Error?e.message:"mfa_failed";
  return reply.code(400).send({error:["mfa_not_enabled","invalid_mfa_code"].includes(code)?code:"mfa_failed"});
 }
});
app.get("/api/me", async (request, reply) => {
  const user = requestUser(request);
  if (!user) return reply.code(401).send({ error: "unauthorized" });
  return { user };
});

app.get("/api/system/status", async (request, reply) => {
  const user = requestUser(request);
  if (!user) return reply.code(401).send({ error: "unauthorized" });
  return { ok: true, service: "devone", version, panelUrl, user, agent: await agentHealth(), metrics: await agentHealth("/v1/metrics") };
});

app.get("/api/services", async (request, reply) => {
  if (!requestUser(request)) return reply.code(401).send({ error: "unauthorized" });
  const result = await agentHealth("/v1/services");
  if (!Array.isArray(result)) return reply.code(503).send({ error: "agent_unavailable" });
  return { services: result };
});
app.post("/api/services/action", async (request, reply) => {
  const user = requestUser(request);
  if (!user) return reply.code(401).send({ error: "unauthorized" });
  if (!["owner", "admin"].includes(user.role)) return reply.code(403).send({ error: "forbidden" });
  if (!request.headers.origin || !sameOrigin(request)) return reply.code(403).send({ error: "origin_forbidden" });
  const body = request.body as { service?: unknown; action?: unknown; confirmed?: unknown } | null;
  if (!body || body.confirmed !== true || !["nginx", "apache2", "mariadb", "mysql", "postgresql", "redis-server", "php8.3-fpm", "docker"].includes(body.service as string) || !["start", "stop", "restart"].includes(body.action as string)) return reply.code(400).send({ error: "invalid_service_operation" });
  const requestKey = (request.body as { requestKey?: unknown }).requestKey;
  if (typeof requestKey !== "string") return reply.code(400).send({ error: "request_key_required" });
  try {
    const job = jobs.enqueue(user.id, requestKey, { service: body.service as string, action: body.action as string });
    return reply.code(202).send({ job });
  } catch (e) {
    const error = e instanceof Error ? e.message : "queue_error";
    return reply.code(error === "request_key_conflict" ? 409 : error === "queue_full" || error === "queue_stopping" ? 503 : 400).send({ error });
  }
});

const vault = new Vault(db, process.env.DEVONE_MASTER_KEY_FILE ?? "/etc/devone/secrets.key");
const jobs = new JobQueue(db, async (input, operation) => {
  if (!agentToken) throw new Error("agent_not_configured");
  const payload=operation==="cms.install"?cmsJobPayload(db,vault,(input as {id:string}).id):operation==="wordpress.install"?wordpressJobPayload(db,vault,(input as {id:string}).id):operation==="database.create"?{...input,password:vault.get(databaseSecret((input as {id:string}).id))}:input;
  if(operation==="database.create"&&!(payload as {password?:string}).password)throw Error("database_credentials_missing");
  let response: Response;
  try {
    response = await fetch(`${agentUrl}${operation === "cms.install" ? "/v1/apps/devone-cms/install" : operation === "wordpress.install" ? "/v1/apps/wordpress/install" : operation === "database.create" ? "/v1/databases/create" : operation === "app.install" ? "/v1/apps/install" : operation === "site.create" ? "/v1/sites" : operation === "site.action" ? "/v1/sites/action" : operation === "site.tls" ? "/v1/sites/tls" : operation === "software.install" ? "/v1/software/install" : "/v1/services/action"}`, { method: "POST", headers: { Authorization: `Bearer ${agentToken}`, "Content-Type": "application/json" }, body: JSON.stringify(payload), signal: AbortSignal.timeout(operation === "cms.install" ? 240000 : operation === "wordpress.install" ? 960000 : operation === "database.create" ? 60000 : operation === "software.install" ? 320000 : operation === "site.tls" ? 240000 : operation === "app.install" || operation.startsWith("site.") ? 330000 : 35000) });
  } catch { throw new OutcomeUnknown("agent_outcome_unknown"); }
  await assertAgentMutationResult(response,operation);
}, audit);
app.get("/api/jobs", async (request, reply) => {
  const user = requestUser(request);
  if (!user) return reply.code(401).send({ error: "unauthorized" });
  return { jobs: jobs.list(["owner", "admin"].includes(user.role) ? undefined : user.id) };
});
app.get<{ Params: { id: string } }>("/api/jobs/:id", async (request, reply) => {
  const user = requestUser(request);
  if (!user) return reply.code(401).send({ error: "unauthorized" });
  const job = jobs.get(request.params.id);
  if (!job || (job.requested_by !== user.id && !["owner", "admin"].includes(user.role))) return reply.code(404).send({ error: "not_found" });
  return { job };
});
app.get("/api/secrets", async (request, reply) => {
  const user = requestUser(request);
  if (!user) return reply.code(401).send({ error: "unauthorized" });
  if (user.role !== "owner") return reply.code(403).send({ error: "forbidden" });
  return { secrets: vault.list() };
});
app.put<{ Params: { name: string } }>("/api/secrets/:name", async (request, reply) => {
  const user = requestUser(request);
  if (!user) return reply.code(401).send({ error: "unauthorized" });
  if (user.role !== "owner") return reply.code(403).send({ error: "forbidden" });
  if (!request.headers.origin || !sameOrigin(request)) return reply.code(403).send({ error: "origin_forbidden" });
  const value = (request.body as { value?: unknown } | null)?.value;
  if (!validSecretName(request.params.name) || typeof value !== "string" || !value || Buffer.byteLength(value) > 8192) return reply.code(400).send({ error: "invalid_secret" });
  try {
    db.exec("BEGIN IMMEDIATE");
    try {
      vault.put(request.params.name, value, user.id);
      audit(user.id, "secret.updated", { name: request.params.name });
      db.exec("COMMIT");
    } catch (error) { db.exec("ROLLBACK"); throw error; }
    return { ok: true };
  } catch { return reply.code(503).send({ error: "vault_unavailable" }); }
});
app.delete<{ Params: { name: string } }>("/api/secrets/:name", async (request, reply) => {
  const user = requestUser(request);
  if (!user) return reply.code(401).send({ error: "unauthorized" });
  if (user.role !== "owner") return reply.code(403).send({ error: "forbidden" });
  if (!request.headers.origin || !sameOrigin(request)) return reply.code(403).send({ error: "origin_forbidden" });
  if (!validSecretName(request.params.name)) return reply.code(400).send({ error: "invalid_secret" });
  db.exec("BEGIN IMMEDIATE");
  try {
    vault.remove(request.params.name);
    audit(user.id, "secret.deleted", { name: request.params.name });
    db.exec("COMMIT");
    return { ok: true };
  } catch { db.exec("ROLLBACK"); return reply.code(503).send({ error: "vault_unavailable" }); }
});
registerDatabases(app,{db,vault,jobs,agentUrl,agentToken,requestUser,sameOrigin,audit,stepUp:verifyOwnerStepUp});
registerDiagnostics(app,{requestUser,sameOrigin,agentUrl,agentToken,audit});
registerCms(app,{db,vault,jobs,agentUrl,agentToken,requestUser,sameOrigin,audit,stepUp:verifyOwnerStepUp});
registerWordPress(app,{db,vault,jobs,agentUrl,agentToken,requestUser,sameOrigin,audit,stepUp:verifyOwnerStepUp});
registerAppInstalls(app,{jobs,requestUser,sameOrigin});
registerSiteRoutes(app, { requestUser, sameOrigin, agentUrl, agentToken, jobs, audit });
registerControlRoutes(app, {db,vault,agentUrl,agentToken,requestUser,sameOrigin,audit});
registerRecoveryBackups(app,{db,keyPath:process.env.DEVONE_MASTER_KEY_FILE??"/etc/devone/secrets.key",folder:process.env.DEVONE_BACKUP_DIR??"/var/lib/devone/backups",panelUrl,requestUser,sameOrigin,audit,stepUp:verifyOwnerStepUp});
registerApplicationQa(app,{agentUrl,agentToken,requestUser,sameOrigin,audit});
registerDisposableQaRoutes(app,{agentUrl,agentToken,requestUser,sameOrigin,audit});
registerSecurityRoutes(app, {db,agentUrl,agentToken,requestUser,sameOrigin,audit});
registerSoftwareRoutes(app,{agentUrl,agentToken,requestUser,sameOrigin,audit,jobs});
const updateAttempts = new Map<string,{count:number;until:number}>();
app.get("/api/updates",async(request,reply)=>{
  const user=requestUser(request);
  if(!user)return reply.code(401).send({error:"unauthorized"});
  if(user.role!=="owner")return reply.code(403).send({error:"owner_required"});
  reply.header("Cache-Control","no-store");
  try{
    if(!agentToken)throw Error("agent_not_configured");
    const result=await fetch(agentUrl+"/v1/updates/status",{
      headers:{Authorization:"Bearer "+agentToken},
      signal:AbortSignal.timeout(17000)
    });
    if(!result.ok)throw Error("agent_update_unavailable");
    return await result.json();
  }catch{return reply.code(503).send({error:"update_status_unavailable"});}
});
app.post("/api/updates/apply",async(request,reply)=>{
  const user=requestUser(request);
  if(!user)return reply.code(401).send({error:"unauthorized"});
  if(user.role!=="owner")return reply.code(403).send({error:"owner_required"});
  if(!request.headers.origin||!sameOrigin(request))return reply.code(403).send({error:"origin_forbidden"});
  const body=request.body as {targetSha?:unknown;password?:unknown;mfaCode?:unknown;confirmed?:unknown}|null;
  if(!body||body.confirmed!==true||typeof body.targetSha!=="string"||!/^[a-f0-9]{40}$/.test(body.targetSha)||
    typeof body.password!=="string"||body.password.length>1024)
    return reply.code(400).send({error:"invalid_update_request"});
  const now=Date.now();
  const entry=updateAttempts.get(user.id)??{count:0,until:now+60000};
  if(now>entry.until){entry.count=0;entry.until=now+60000;}
  if(entry.count>=5)return reply.code(429).send({error:"update_auth_rate_limited"});
  entry.count++;
  updateAttempts.set(user.id,entry);
  const stepUp=verifyOwnerStepUp(user.id,body.password,body.mfaCode);
  if(stepUp!=="ok")return reply.code(403).send({error:stepUp==="password_invalid"?"owner_password_invalid":stepUp});
  if(!agentToken)return reply.code(503).send({error:"agent_unavailable"});
  try{
    const response=await fetch(agentUrl+"/v1/updates/apply",{
      method:"POST",headers:{"Authorization":"Bearer "+agentToken,"Content-Type":"application/json"},
      body:JSON.stringify({targetSha:body.targetSha,confirmed:true}),
      signal:AbortSignal.timeout(26000)
    });
    const output=await response.json().catch(()=>({})) as {error?:string;update?:unknown};
    if(!response.ok){
      const allowed=new Set(["update_busy","update_target_changed","update_worker_missing","release_checks_not_passed","github_rate_limited","github_unavailable"]);
      return reply.code(response.status===409?409:503).send({error:allowed.has(output.error??"")?output.error:"update_unavailable"});
    }
    audit(user.id,"system.update_requested",{targetSha:body.targetSha});
    return reply.code(202).send({update:output.update});
  }catch{
    // Do not retry automatically: worker may have started even if the network response was lost.
    return reply.code(503).send({error:"update_result_requires_inspection"});
  }
});
app.get("/api/catalog", async (request, reply) => {
  if (!requestUser(request)) return reply.code(401).send({error:"unauthorized"});
  reply.header("Cache-Control", "no-store");
  return listCatalog();
});
jobs.start();
app.addHook("onClose", async () => { await jobs.stop(); closeDb(); });
const port = Number(process.env.PORT ?? 8787);
for (const signal of ["SIGTERM", "SIGINT"] as const) process.once(signal, () => { void app.close(); });
app.listen({ host: "127.0.0.1", port }).catch((error) => {
  app.log.error(error);
  process.exit(1);
});
