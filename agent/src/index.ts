import { listServices, mutateService } from "./services.js";
import { cpus, freemem, totalmem, uptime, loadavg, hostname } from "node:os";
import { createServer } from "node:http";

const version = "1.0.0-alpha.3";
const port = Number(process.env.DEVONE_AGENT_PORT ?? 8790);
const token = process.env.DEVONE_AGENT_TOKEN ?? "";

const server = createServer(async (request, response) => {
  if (!token || request.headers.authorization !== `Bearer ${token}`) {
    response.writeHead(401, { "content-type": "application/json" });
    response.end(JSON.stringify({ error: "unauthorized" })); return;
  }
  const send = (code: number, value: unknown) => { response.writeHead(code, { "content-type": "application/json" }); response.end(JSON.stringify(value)); };
  if (request.method === "GET" && request.url === "/v1/services") { send(200, await listServices()); return; }
  if (request.method === "POST" && request.url === "/v1/services/action") {
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
