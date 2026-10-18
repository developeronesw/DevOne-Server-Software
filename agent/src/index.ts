import { SiteManager } from "./sites.js";
import {DisposableHostQa} from "./disposable-qa.js";
import { UpdatesManager } from "./updates.js";
import { discoverSoftware } from "./discovery.js";
import { softwareCapabilities, softwarePreflight, softwareStatus, softwareInstall } from "./software.js";
import { inspectSecurity } from "./security.js";
import { crowdSecReadiness } from "./crowdsec.js";
import {recentCrowdSecEvents} from "./crowdsec-events.js";
import { listServices, mutateService } from "./services.js";
import { cpus, freemem, totalmem, uptime, loadavg, hostname } from "node:os";
import { createServer } from "node:http";

const version = "1.0.0-alpha.3";
const port = Number(process.env.DEVONE_AGENT_PORT ?? 8790);
const token = process.env.DEVONE_AGENT_TOKEN ?? "";

const updates = new UpdatesManager();
const sites = new SiteManager({registry:'/var/lib/devone-agent',base:'/home/devone-sites',nginx:'/etc/nginx/conf.d',panelDomain:new URL(process.env.DEVONE_PANEL_URL ?? 'http://localhost').hostname});
const disposableQa=new DisposableHostQa(sites);
const server = createServer(async (request, response) => {
  if (!token || request.headers.authorization !== `Bearer ${token}`) {
    response.writeHead(401, { "content-type": "application/json" });
    response.end(JSON.stringify({ error: "unauthorized" })); return;
  }
  const send = (code: number, value: unknown) => { response.writeHead(code, { "content-type": "application/json" }); response.end(JSON.stringify(value)); };
  if (request.method === "GET" && request.url === "/v1/updates/status") {
    try { send(200,await updates.status()); } catch { send(503,{error:"update_status_unavailable"}); }
    return;
  }
  if (request.method === "POST" && request.url === "/v1/updates/apply") {
    try {
      request.setEncoding("utf8");
      let body="";
      for await (const part of request){body+=part;if(Buffer.byteLength(body)>512){send(413,{error:"body_too_large"});return;}}
      const data=JSON.parse(body) as {targetSha?:unknown;confirmed?:unknown};
      if(data.confirmed!==true){send(400,{error:"confirmation_required"});return;}
      const result=await updates.start(data.targetSha);
      send(202,{update:result});
    } catch(error) {
      const message=error instanceof Error?error.message:"update_unavailable";
      const safe=["update_busy","invalid_update_target","update_worker_missing","release_checks_not_passed","update_target_changed","github_rate_limited","github_unavailable"].includes(message)?message:"update_unavailable";
      send(safe==="update_busy"||safe==="update_target_changed"?409:safe==="invalid_update_target"?400:503,{error:safe});
    }
    return;
  }
  if(request.method==="GET"&&request.url==="/v1/qa/disposable/status"){
    send(200,disposableQa.status());return;
  }
  if(request.method==="POST"&&request.url==="/v1/qa/disposable/start"){
    try{
      request.setEncoding("utf8");let body="";
      for await(const chunk of request){body+=chunk;if(Buffer.byteLength(body)>256){send(413,{error:"body_too_large"});return;}}
      const value=JSON.parse(body);
      if(!value||Object.keys(value).length!==1||value.confirmed!==true)throw Error("confirmation_required");
      send(202,disposableQa.start());
    }catch(e){const code=e instanceof Error?e.message:"qa_unavailable";send(code==="qa_disposable_busy"?409:code==="confirmation_required"?400:503,{error:code==="qa_disposable_busy"?code:code==="confirmation_required"?code:"qa_unavailable"});}
    return;
  }
  if(request.method==="GET"&&request.url==="/v1/sites/runtime/status"){
    try{send(200,await sites.runtimeStatus());}
    catch{send(503,{error:"runtime_status_unavailable"});}
    return;
  }
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
    } catch (error) { const code=error instanceof Error?error.message:"site_operation_failed";
      const invalid=/^(invalid_|domain_in_use|site_limit|site_not_ready|file_too_large|unsupported_)/.test(code);
      const conflict=["file_conflict","destination_exists","site_revision_conflict","node_entry_missing","site_runtime_not_available","php83_runtime_not_running","node22_runtime_not_available","site_port_unavailable"].includes(code);
      send(conflict?409:invalid?400:503,{error:conflict||code==="unsupported_runtime_version"?code:"site_operation_failed"}); }
    return;
  }
  if(request.method==="POST"&&request.url==="/v1/sites/waf"){
    try{
      request.setEncoding("utf8");let body="";
      for await (const part of request){
        body+=part;if(Buffer.byteLength(body)>2048){send(413,{error:"body_too_large"});return;}
      }
      send(200,await sites.setWaf(JSON.parse(body)));
    }catch(error){
      const code=error instanceof Error?error.message:"waf_operation_failed";
      const conflict=["site_revision_conflict","site_config_changed","site_not_ready"].includes(code);
      const bad=["invalid_waf_action","invalid_waf_policy","invalid_site"].includes(code);
      send(conflict?409:bad?400:503,{error:conflict||bad?code:"waf_operation_failed"});
    }
    return;
  }
  if (request.method==="GET"&&request.url==="/v1/security/crowdsec") {
    try{send(200,await crowdSecReadiness());}catch{send(503,{error:"crowdsec_readiness_unavailable"});}
    return;
  }
  if(request.method==="GET"&&request.url==="/v1/security/crowdsec/events"){
    try{send(200,await recentCrowdSecEvents());}
    catch{send(503,{error:"crowdsec_events_unavailable"});}
    return;
  }
  if (request.method === "GET" && request.url === "/v1/security/scan") {
    try { send(200,await inspectSecurity()); }
    catch { send(503,{error:"security_scan_unavailable"}); }
    return;
  }
  // The software phase starts with a non-mutating, audited host preflight.
  // No remote package installations or arbitrary commands are enabled.
  if(request.method==="GET"&&request.url==="/v1/software/capabilities"){
    send(200,softwareCapabilities());return;
  }
  if(request.method==="GET"&&request.url==="/v1/software/status"){
    try{send(200,await softwareStatus());}
    catch{send(503,{error:"software_status_unavailable"});}
    return;
  }
  if(request.method==="POST"&&request.url==="/v1/software/install"){
    try{
      request.setEncoding("utf8");let body="";
      for await(const chunk of request){
        body+=chunk;if(Buffer.byteLength(body)>512){send(413,{error:"body_too_large"});return;}
      }
      send(200,await softwareInstall(JSON.parse(body)));
    }catch(error){
      const message=error instanceof Error?error.message:"software_install_requires_inspection";
      const invalid=message==="invalid_software_install",busy=message==="software_install_busy";
      send(invalid?400:busy?409:503,{error:invalid?"invalid_software_install":busy?"software_install_busy":"software_install_requires_inspection"});
    }
    return;
  }
  if(request.method==="POST"&&request.url==="/v1/software/preflight"){
    try{
      request.setEncoding("utf8");let body="";
      for await (const chunk of request){
        body+=chunk;if(Buffer.byteLength(body)>512){send(413,{error:"body_too_large"});return;}
      }
      send(200,await softwarePreflight(JSON.parse(body)));
    }catch(error){
      const invalid=error instanceof Error&&error.message==="invalid_software_preflight";
      send(invalid?400:503,{error:invalid?"invalid_software_preflight":"software_preflight_unavailable"});
    }
    return;
  }
  if (request.method === "GET" && request.url === "/v1/discovery") {
    try { send(200,await discoverSoftware()); } catch { send(503,{error:"discovery_unavailable"}); }
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
