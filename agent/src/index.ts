import { SiteManager } from "./sites.js";
import { listServices, mutateService } from "./services.js";
import { cpus, freemem, totalmem, uptime, loadavg, hostname } from "node:os";
import { createServer } from "node:http";

const version = "1.0.0-alpha.3";
const port = Number(process.env.DEVONE_AGENT_PORT ?? 8790);
const token = process.env.DEVONE_AGENT_TOKEN ?? "";

const sites = new SiteManager({registry:'/var/lib/devone-agent',base:'/home/devone-sites',nginx:'/etc/nginx/conf.d',panelDomain:new URL(process.env.DEVONE_PANEL_URL ?? 'http://localhost').hostname});
const server = createServer(async (request, response) => {
  if (!token || request.headers.authorization !== `Bearer ${token}`) {
    response.writeHead(401, { "content-type": "application/json" });
    response.end(JSON.stringify({ error: "unauthorized" })); return;
  }
  const send = (code: number, value: unknown) => { response.writeHead(code, { "content-type": "application/json" }); response.end(JSON.stringify(value)); };
  if (request.method === "POST" && request.url === "/v1/sites/preflight") {
    try {
      request.setEncoding("utf8");
      let body = "";
      for await (const chunk of request) { body += chunk; if (Buffer.byteLength(body) > 4096) { send(413,{error:"body_too_large"}); return; } }
      send(200,await sites.preflight(JSON.parse(body)));
    } catch (error) {
      const code = error instanceof Error ? error.message : "site_preflight_failed";
      send(["invalid_domain","invalid_aliases","invalid_web_server"].includes(code) ? 400 : ["domain_in_use","site_not_ready"].includes(code) ? 409 : 503,{error:["domain_in_use","site_not_ready"].includes(code) ? code : "site_preflight_failed"});
    }
    return;
  }
  if (request.method === "GET" && request.url?.startsWith("/v1/sites/tls/status?")) {
    try {
      const url = new URL(request.url,"http://127.0.0.1");
      send(200,await sites.tlsStatus(url.searchParams.get("siteId")));
    } catch { send(503,{error:"tls_status_unavailable"}); }
    return;
  }
  if ((request.method === "GET" && request.url === "/v1/sites") || (request.method === "POST" && ["/v1/sites", "/v1/sites/action", "/v1/sites/tls", "/v1/sites/files"].includes(request.url ?? ""))) {
    try {
      if (request.method === "GET") { send(200,{sites:await sites.list()}); return; }
      request.setEncoding("utf8");
      let body = "";
      for await (const chunk of request) { body += chunk; if (Buffer.byteLength(body) > 1500000) { send(413,{error:"body_too_large"}); return; } }
      const input = JSON.parse(body);
      send(200,request.url === "/v1/sites" ? await sites.create(input) : request.url === "/v1/sites/action" ? await sites.action(input) : request.url === "/v1/sites/tls" ? await sites.tls(input) : await sites.files(input));
    } catch (error) { const invalid = error instanceof Error && /^(invalid_|domain_in_use|site_limit|site_not_ready|file_too_large)/.test(error.message); const conflict = error instanceof Error && ["file_conflict","destination_exists","site_revision_conflict"].includes(error.message); send(conflict ? 409 : invalid ? 400 : 503,{error:conflict && error instanceof Error ? error.message : "site_operation_failed"}); }
    return;
  }
  if (request.method === "GET" && request.url === "/v1/services") { send(200, await listServices()); return; }
  if (request.method === "POST" && request.url === "/v1/services/action") {
    request.setEncoding("utf8");
    let body = "";
    try {
      for await (const chunk of request) { body += chunk; if (Buffer.byteLength(body) > 4096) { send(413, { error: "body_too_large" }); return; } }
      send(200, await mutateService(JSON.parse(body)));
    } catch (error) { send(error instanceof Error && error.message === "invalid_service_operation" ? 400 : 503, { error: "service_operation_failed" }); }
    return;
  }
  if (request.method !== "GET" || !["/v1/health", "/v1/metrics"].includes(request.url ?? "")) { send(404, { error: "not_found" }); return; }
  response.writeHead(200, { "content-type": "application/json" });
  response.end(JSON.stringify(request.url === "/v1/metrics" ? { ok: true, hostname: hostname(), cpuCount: cpus().length, load: loadavg(), memoryTotal: totalmem(), memoryFree: freemem(), uptime: uptime() } : { ok: true, service: "devone-agent", version }));
});

server.listen(port, "127.0.0.1", () => {
  console.log(`DevOne Agent listening on 127.0.0.1:${port}`);
});
