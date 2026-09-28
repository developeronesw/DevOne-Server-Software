import { createServer } from "node:http";

const version = "1.0.0-alpha.2";
const port = Number(process.env.DEVONE_AGENT_PORT ?? 8790);
const token = process.env.DEVONE_AGENT_TOKEN ?? "";

const server = createServer((request, response) => {
  if (request.method !== "GET" || request.url !== "/v1/health") {
    response.writeHead(404, { "content-type": "application/json" });
    response.end(JSON.stringify({ error: "not_found" }));
    return;
  }
  if (!token || request.headers.authorization !== `Bearer ${token}`) {
    response.writeHead(401, { "content-type": "application/json" });
    response.end(JSON.stringify({ error: "unauthorized" }));
    return;
  }
  response.writeHead(200, { "content-type": "application/json" });
  response.end(JSON.stringify({ ok: true, service: "devone-agent", version }));
});

server.listen(port, "127.0.0.1", () => {
  console.log(`DevOne Agent listening on 127.0.0.1:${port}`);
});
