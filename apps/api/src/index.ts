import Fastify from "fastify";
import { audit, closeDb, createOwner, hasOwner, login, logout, userFromToken } from "./auth.js";

const app = Fastify({ logger: { redact: ["req.headers.authorization", "req.headers.cookie"] }, bodyLimit: 16384 });
const version = "1.0.0-alpha.3";
const setupToken = process.env.DEVONE_SETUP_TOKEN ?? "";
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
app.get("/api/setup/status", async () => ({ setupRequired: !hasOwner(), panelUrl }));

app.post("/api/auth/setup", async (request, reply) => {
  if (!sameOrigin(request)) return reply.code(403).send({ error: "origin_forbidden" });
  if (!setupToken || request.headers["x-devone-setup-token"] !== setupToken) return reply.code(403).send({ error: "setup_token_required" });
  if (hasOwner()) return reply.code(409).send({ error: "setup_complete" });
  const body = (request.body ?? {}) as { email?: string; password?: string };
  try {
    const user = createOwner(body.email ?? "", body.password ?? "");
    audit(user.id, "auth.setup_completed");
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
  const body = (request.body ?? {}) as { email?: string; password?: string };
  const result = login(body.email ?? "", body.password ?? "");
  if (!result) return reply.code(401).send({ error: "invalid_credentials" });
  setSessionCookie(reply, result.token);
  return reply.send({ ok: true, user: result.user });
});

app.post("/api/auth/logout", async (request, reply) => {
  if (!sameOrigin(request)) return reply.code(403).send({ error: "origin_forbidden" });
  logout(cookies(request.headers.cookie).devone_session);
  clearSessionCookie(reply);
  return reply.send({ ok: true });
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
  if (!body || body.confirmed !== true || !["nginx", "apache2", "mariadb", "mysql", "postgresql", "redis-server", "docker"].includes(body.service as string) || !["start", "stop", "restart"].includes(body.action as string)) return reply.code(400).send({ error: "invalid_service_operation" });
  audit(user.id, "service.operation_requested", { service: body.service, action: body.action });
  try {
    const result = await fetch(`${agentUrl}/v1/services/action`, { method: "POST", headers: { Authorization: `Bearer ${agentToken}`, "Content-Type": "application/json" }, body: JSON.stringify({ service: body.service, action: body.action }), signal: AbortSignal.timeout(35000) });
    audit(user.id, "service.operation_completed", { service: body.service, action: body.action, ok: result.ok });
    return reply.code(result.ok ? 200 : 503).send(result.ok ? { ok: true } : { error: "service_operation_failed" });
  } catch { audit(user.id, "service.operation_failed", { service: body.service, action: body.action }); return reply.code(503).send({ error: "agent_unavailable" }); }
});

app.addHook("onClose", async () => closeDb());
const port = Number(process.env.PORT ?? 8787);
app.listen({ host: "127.0.0.1", port }).catch((error) => {
  app.log.error(error);
  process.exit(1);
});
