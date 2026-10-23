import {test} from "node:test";
import assert from "node:assert/strict";
import {DatabaseSync} from "node:sqlite";
import {assertAgentMutationResult} from "../apps/api/dist/job-agent-result.js";
import {JobQueue,OutcomeUnknown} from "../apps/api/dist/jobs.js";
const response=(code,body)=>new Response(JSON.stringify(body),{status:code,headers:{"Content-Type":"application/json"}});
test("known Agent 503 package inspection result is a definitive failed job, not transport interruption",async()=>{
 await assert.rejects(assertAgentMutationResult(response(503,{error:"software_install_requires_inspection",reason:"repository_origin_unverified"}),"software.install"),{message:"software_install_repository_origin_unverified"});
 const db=new DatabaseSync(":memory:");
 db.exec("CREATE TABLE users(id TEXT PRIMARY KEY,role TEXT NOT NULL); INSERT INTO users VALUES('owner','owner');");
 const queue=new JobQueue(db,async(_input,operation)=>assertAgentMutationResult(response(503,{error:"software_install_requires_inspection",reason:"repository_origin_unverified"}),operation),()=>{});
 const job=queue.enqueue("owner","redis-inspection-test-1234",{package:"redis-server",confirmed:true},"software.install");
 await queue.idle();
 const result=queue.get(job.id);
 assert.equal(result.state,"failed");
 assert.equal(result.error,"software_install_repository_origin_unverified");
 await queue.stop();db.close();
});
test("unknown Agent 5xx and lost response remain interrupted; no claim of install success",async()=>{
 await assert.rejects(assertAgentMutationResult(response(503,{error:"agent_unavailable"}),"software.install"),OutcomeUnknown);
 await assert.rejects(assertAgentMutationResult(response(504,{error:"timeout"}),"software.install"),OutcomeUnknown);
 await assert.rejects(assertAgentMutationResult(new Response("bad gateway",{status:502}),"software.install"),OutcomeUnknown);
 await assert.doesNotReject(assertAgentMutationResult(response(200,{ok:true}),"software.install"));
});
test("arbitrary Agent errors are not exposed as command output or raw messages",async()=>{
 await assert.rejects(assertAgentMutationResult(response(409,{error:"/etc/secrets-key"}),"software.install"),{message:"agent_operation_failed"});
 await assert.rejects(assertAgentMutationResult(response(500,{error:"software_install_requires_inspection",reason:"repository_origin_unverified"}),"software.install"),OutcomeUnknown);
 await assert.rejects(assertAgentMutationResult(response(503,{error:"software_install_requires_inspection",reason:"/etc/shadow"}),"software.install"),{message:"software_install_unclassified"});
});
