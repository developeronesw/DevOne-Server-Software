import {test} from "node:test";
import assert from "node:assert/strict";
import {DatabaseSync} from "node:sqlite";
import {JobQueue} from "../apps/api/dist/jobs.js";

test("software install uses existing durable audited JobQueue with idempotency",async()=>{
 const db=new DatabaseSync(":memory:");
 db.exec("CREATE TABLE users(id TEXT PRIMARY KEY,role TEXT NOT NULL); INSERT INTO users VALUES('owner','owner');");
 const events=[],completed=[];
 const queue=new JobQueue(db,async(input,operation)=>{completed.push({input,operation});},(actor,event,details)=>{events.push({actor,event,details});});
 const key="software-job-idempotent-test";
 const job=queue.enqueue("owner",key,{package:"php8.3-fpm",confirmed:true},"software.install");
 await queue.idle();
 assert.equal(queue.get(job.id).state,"succeeded");
 assert.deepEqual(completed,[{input:{package:"php8.3-fpm",confirmed:true},operation:"software.install"}]);
 assert.equal(queue.enqueue("owner",key,{package:"php8.3-fpm",confirmed:true},"software.install").id,job.id);
 assert.equal(completed.length,1);
 assert.ok(events.some(x=>x.event==="job.succeeded"));
 assert.throws(()=>queue.enqueue("owner","new-install-id-1234",{package:"nginx",confirmed:true},"software.install"),/invalid_software_install/);
 await queue.stop();db.close();
});
test("software jobs are Owner-only even if enqueued by a former Owner",async()=>{
 const db=new DatabaseSync(":memory:");
 db.exec("CREATE TABLE users(id TEXT PRIMARY KEY,role TEXT NOT NULL); INSERT INTO users VALUES('admin','admin');");
 const calls=[];
 const queue=new JobQueue(db,async()=>{calls.push("executed");},()=>{});
 const job=queue.enqueue("admin","unauthorized-install-123",{package:"redis-server",confirmed:true},"software.install");
 await queue.idle();
 assert.equal(queue.get(job.id).state,"failed");
 assert.equal(queue.get(job.id).error,"authorization_revoked");
 assert.deepEqual(calls,[]);
 await queue.stop();db.close();
});
