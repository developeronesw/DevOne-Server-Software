import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";

export type ServiceInput = { service: string; action: string };
export type SiteInput = { domain: string; webServer: "nginx" | "none" };
export type SiteActionInput = {siteId:string;action:string;expectedRevision:number;domain?:string;aliases?:string[];confirmDomain?:string};
export type SiteTlsInput = {siteId:string;action:string;expectedRevision:number;email?:string;agreeTerms?:boolean};
export type JobInput = ServiceInput | SiteInput | SiteActionInput | SiteTlsInput;
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
    if (!["service.action", "site.create", "site.action", "site.tls"].includes(operation)) throw new Error("invalid_operation");
    const serialized = operation === "service.action"
      ? JSON.stringify({ service: (input as ServiceInput).service, action: (input as ServiceInput).action })
      : operation === "site.create" ? JSON.stringify({ domain: (input as SiteInput).domain, webServer: (input as SiteInput).webServer })
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
        if (!role || !["owner", "admin"].includes(role.role)) throw new Error("authorization_revoked");
        await this.execute(JSON.parse(job.input), job.operation);
      } catch (e) {
        state = e instanceof OutcomeUnknown ? "interrupted" : "failed";
        error = e instanceof Error && e.message === "authorization_revoked" ? "authorization_revoked" : state === "interrupted" ? "agent_outcome_unknown" : "agent_operation_failed";
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
