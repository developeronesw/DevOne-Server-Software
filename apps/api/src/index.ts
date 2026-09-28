import Fastify from "fastify";
import { audit, closeDb, createOwner, hasOwner, login, logout, userFromToken } from "./auth.js";

const app = Fastify({ logger: true });
const version = "1.0.0-alpha.2";
const panelUrl = process.env.DEVONE_PANEL_URL ?? "http://127.0.0.1:8787";
const agentUrl = process.env.DEVONE_AGENT_URL ?? "http://127.0.0.1:8790";
const agentToken = process.env.DEVONE_AGENT_TOKEN ?? "";

function cookies(raw?: string) {
  return Object.fromEntries((raw ?? "").split(";").filter(Boolean).map((part) => {
    const i = part.indexOf("=");
    return i < 0 ? [part.trim(), ""] : [part.slice(0, i).trim(), decodeURIComponent(part.slice(i + 1).trim())];
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
    return new URL(origin).host === request.headers.host;
  } catch {
    return false;
  }
}

async function agentHealth() {
  if (!agentToken) return { ok: false, error: "agent_not_configured" };
  try {
    const response = await fetch(`${agentUrl}/v1/health`, {
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
  return { ok: true, service: "devone", version, panelUrl, user, agent: await agentHealth() };
});

app.addHook("onClose", async () => closeDb());
const port = Number(process.env.PORT ?? 8787);
app.listen({ host: "127.0.0.1", port }).catch((error) => {
  app.log.error(error);
  process.exit(1);
});
