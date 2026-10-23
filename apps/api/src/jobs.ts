import { randomUUID } from "node:crypto";
import {isSafeInstallFailureReason} from "./software-reasons.js";
import type { DatabaseSync } from "node:sqlite";

export type ServiceInput = { service: string; action: string };
export type SiteInput = { domain: string; webServer: "nginx" | "none"; siteType?: "static" | "files" | "php" | "node" | "python" | "container"; runtimeVersion?:string };
export type SiteActionInput = {siteId:string;action:string;expectedRevision:number;domain?:string;aliases?:string[];confirmDomain?:string};
export type SiteTlsInput = {siteId:string;action:string;expectedRevision:number;email?:string;agreeTerms?:boolean};
export type SoftwareInstallInput={package:"php8.3-fpm"|"redis-server"|"docker.io"|"mariadb-server"|"postgresql";confirmed:true};
export type AppInstallInput={appId:string;siteId?:string;domain?:string;expectedRevision?:number};
export type DatabaseCreateInput={id:string;siteId:string;engine:"mariadb"|"postgresql"};
export type WordPressJobInput={id:string};
export type JobInput = WordPressJobInput | DatabaseCreateInput | AppInstallInput | ServiceInput | SiteInput | SiteActionInput | SiteTlsInput | SoftwareInstallInput;
export type JobState = "queued" | "running" | "succeeded" | "failed" | "interrupted";
export type Job = { id: string; requested_by: string; operation: string; input: string; state: JobState; error: string | null; created_at: string; started_at: string | null; finished_at: string | null };
export class OutcomeUnknown extends Error {}
export class JobQueue {
  private active: Promise<void> | null = null;
  private stopped = false;
  constructor(private db: DatabaseSync, private execute: (input: JobInput, operation: string) => Promise<void>, private audit: (actor: string | null, action: string, details: unknown) => void) {
    db.exec(`CREATE TABLE IF NOT EXISTS jobs (
      id TEXT PRIMARY KEY, requested_by TEXT NOT NULL REFERENCES users(id),
      request_key TEXT NOT NULL, operation TEXT NOT NULL, input TEXT NOT NULL,
      state TEXT NOT NULL CHECK(state IN ('queued','running','succeeded','failed','interrupted')),
      error TEXT, created_at TEXT NOT NULL, started_at TEXT, finished_at TEXT,
      UNIQUE(requested_by,request_key));
      CREATE INDEX IF NOT EXISTS jobs_state_created ON jobs(state,created_at);
    `);
    // Never replay a host mutation whose outcome is unknown after process loss.
    const interrupted = db.prepare("SELECT id,requested_by FROM jobs WHERE state='running'").all() as {id: string;requested_by: string}[];
    this.transaction(() => {
      db.prepare("UPDATE jobs SET state='interrupted',error='api_restart_outcome_unknown',finished_at=? WHERE state='running'").run(new Date().toISOString());
      for (const row of interrupted) audit(row.requested_by, "job.interrupted", { id: row.id, error: "api_restart_outcome_unknown" });
    });
  }
  enqueue(actor: string, key: string, input: JobInput, operation = "service.action"): Job {
    if (!/^[a-zA-Z0-9_-]{16,128}$/.test(key)) throw new Error("invalid_request_key");
    if (!["service.action", "site.create", "site.action", "site.tls", "database.create", "app.install", "wordpress.install", "software.install"].includes(operation)) throw new Error("invalid_operation");
    if(operation==="software.install" && (!input || !["php8.3-fpm","redis-server","docker.io","mariadb-server","postgresql"].includes((input as SoftwareInstallInput).package) || (input as SoftwareInstallInput).confirmed!==true)) throw Error("invalid_software_install");
    if(operation==="wordpress.install"&&(!input||!/^app_[a-f0-9]{16}$/.test((input as WordPressJobInput).id)))throw Error("invalid_wordpress_request");
    if(operation==="app.install" && !["static-starter","php-starter","node-starter"].includes((input as AppInstallInput).appId))throw Error("unsupported_app");
    if(operation==="database.create" && (!/^db_[a-f0-9]{16}$/.test((input as DatabaseCreateInput).id)||!/^site_[a-f0-9]{16}$/.test((input as DatabaseCreateInput).siteId)||!["mariadb","postgresql"].includes((input as DatabaseCreateInput).engine)))throw Error("invalid_database_request");
    const serialized = operation === "service.action"
      ? JSON.stringify({ service: (input as ServiceInput).service, action: (input as ServiceInput).action })
      : operation === "wordpress.install" ? JSON.stringify({id:(input as WordPressJobInput).id})
      : operation === "database.create" ? JSON.stringify({id:(input as DatabaseCreateInput).id,siteId:(input as DatabaseCreateInput).siteId,engine:(input as DatabaseCreateInput).engine})
      : operation === "app.install" ? JSON.stringify({appId:(input as AppInstallInput).appId,siteId:(input as AppInstallInput).siteId,domain:(input as AppInstallInput).domain,expectedRevision:(input as AppInstallInput).expectedRevision})
      : operation === "software.install" ? JSON.stringify({package:(input as SoftwareInstallInput).package,confirmed:(input as SoftwareInstallInput).confirmed})
      : operation === "site.create" ? JSON.stringify({ domain: (input as SiteInput).domain, webServer: (input as SiteInput).webServer, siteType:(input as SiteInput).siteType, runtimeVersion:(input as SiteInput).runtimeVersion })
      : operation === "site.tls" ? JSON.stringify({siteId:(input as SiteTlsInput).siteId,action:(input as SiteTlsInput).action,expectedRevision:(input as SiteTlsInput).expectedRevision,email:(input as SiteTlsInput).email,agreeTerms:(input as SiteTlsInput).agreeTerms})
      : JSON.stringify({siteId:(input as SiteActionInput).siteId,action:(input as SiteActionInput).action,expectedRevision:(input as SiteActionInput).expectedRevision,domain:(input as SiteActionInput).domain,aliases:(input as SiteActionInput).aliases,confirmDomain:(input as SiteActionInput).confirmDomain});
    const existing = this.db.prepare("SELECT * FROM jobs WHERE requested_by=? AND request_key=?").get(actor, key) as Job | undefined;
    if (existing) {
      if (existing.input !== serialized || existing.operation !== operation) throw new Error("request_key_conflict");
      return this.get(existing.id)!;
    }
    if (this.stopped) throw new Error("queue_stopping");
    const pending = this.db.prepare("SELECT count(*) AS n FROM jobs WHERE state IN ('queued','running')").get() as {n:number};
    if (pending.n >= 100) throw new Error("queue_full");
    const id = randomUUID();
    this.transaction(() => {
      this.db.prepare("INSERT INTO jobs(id,requested_by,request_key,operation,input,state,created_at) VALUES(?,?,?,?,?,'queued',?)").run(id, actor, key, operation, serialized, new Date().toISOString());
      this.audit(actor, "job.queued", { id, operation, ...JSON.parse(serialized) });
    });
    this.start();
    return this.get(id)!;
  }
  get(id: string) { return this.db.prepare("SELECT id,requested_by,operation,input,state,error,created_at,started_at,finished_at FROM jobs WHERE id=?").get(id) as Job | undefined; }
  list(actor?: string) {
    return (actor ? this.db.prepare("SELECT id,requested_by,operation,input,state,error,created_at,started_at,finished_at FROM jobs WHERE requested_by=? ORDER BY created_at DESC LIMIT 100").all(actor) : this.db.prepare("SELECT id,requested_by,operation,input,state,error,created_at,started_at,finished_at FROM jobs ORDER BY created_at DESC LIMIT 100").all()) as Job[];
  }
  start() {
    if (this.active || this.stopped) return;
    this.active = this.drain().catch(error => {
      this.stopped = true;
      console.error("Job worker storage failure", error instanceof Error ? error.name : "unknown");
    }).finally(() => {
      this.active = null;
      if (!this.stopped && this.db.prepare("SELECT id FROM jobs WHERE state='queued' LIMIT 1").get()) this.start();
    });
  }
  private async drain() {
    while (!this.stopped) {
      const job = this.db.prepare("SELECT * FROM jobs WHERE state='queued' ORDER BY created_at,rowid LIMIT 1").get() as Job | undefined;
      if (!job) return;
      const role = this.db.prepare("SELECT role FROM users WHERE id=?").get(job.requested_by) as {role: string} | undefined;
      this.transaction(() => {
        this.db.prepare("UPDATE jobs SET state='running',started_at=? WHERE id=? AND state='queued'").run(new Date().toISOString(), job.id);
        this.audit(job.requested_by, "job.started", { id: job.id });
      });
      let state: JobState = "succeeded", error: string | null = null;
      try {
        if (!role || !["owner", "admin"].includes(role.role) || (["software.install","database.create","wordpress.install"].includes(job.operation) && role.role !== "owner")) throw new Error("authorization_revoked");
        await this.execute(JSON.parse(job.input), job.operation);
      } catch (e) {
        state = e instanceof OutcomeUnknown ? "interrupted" : "failed";
        const reason=e instanceof Error?e.message:"agent_operation_failed";
        const known=new Set(["site_provisioning_requires_inspection","domain_in_use","site_limit","wordpress_install_requires_inspection","wordpress_prerequisites_unavailable","wordpress_artifact_unavailable","wordpress_already_recorded","wordpress_credentials_missing","database_provisioning_requires_inspection","database_engine_unavailable","database_credentials_missing","database_site_not_ready","database_already_recorded","database_limit","app_install_requires_inspection","app_target_not_empty","app_target_incompatible","site_revision_conflict","software_install_requires_inspection","authorization_revoked","runtime_entry_missing","runtime_not_healthy","python312_runtime_not_available","docker_runtime_not_running","node_entry_missing","site_runtime_not_available","php83_runtime_not_running","node22_runtime_not_available","site_port_unavailable","unsupported_runtime_version"]);
        error=state==="interrupted"?"agent_outcome_unknown":(known.has(reason)||(reason.startsWith("software_install_")&&isSafeInstallFailureReason(reason.slice("software_install_".length))))?reason:"agent_operation_failed";
      }
      this.transaction(() => {
        this.db.prepare("UPDATE jobs SET state=?,error=?,finished_at=? WHERE id=?").run(state, error, new Date().toISOString(), job.id);
        this.audit(job.requested_by, `job.${state}`, { id: job.id, error });
      });
    }
  }
  private transaction<T>(work: () => T): T {
    this.db.exec("BEGIN IMMEDIATE");
    try { const result = work(); this.db.exec("COMMIT"); return result; }
    catch (error) { this.db.exec("ROLLBACK"); throw error; }
  }
  async idle() { await this.active; }
  async stop() { this.stopped = true; await this.active; }
}
