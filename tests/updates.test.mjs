import test from "node:test";
import assert from "node:assert/strict";
import {UpdatesManager} from "../agent/dist/updates.js";
const current="a".repeat(40),next="b".repeat(40),other="c".repeat(40);
const success=[{name:"validate",status:"completed",conclusion:"success"},{name:"installer",status:"completed",conclusion:"success"}];
function fixture({remoteSha=next,checks=success,worker=true,runState=null,launchFailure=false}={}){
 const calls=[],queued=[];
 const manager=new UpdatesManager({
  run:async(command,args)=>{assert.equal(command,"/usr/bin/git");assert.deepEqual(args.slice(-2),["rev-parse","HEAD"]);return current;},
  fetchJson:async url=>{
   calls.push(url);
   return url.includes("/git/ref/heads/main")?{object:{sha:remoteSha}}:{check_runs:checks};
  },
  readStatus:async()=>runState,
  workerReady:async()=>worker,
  writeStatus:async state=>{queued.push(state);},
  launch:async target=>{if(launchFailure)throw Error("start_failed");calls.push("LAUNCH:"+target);}
 });
 return {manager,calls,queued};
}
test("checks fixed main branch and requires both unambiguous passed workflows",async()=>{
 const x=fixture();
 const status=await x.manager.status();
 assert.equal(status.currentSha,current);
 assert.equal(status.latestSha,next);
 assert.equal(status.updateAvailable,true);
 assert.equal(status.approved,true);
 assert.equal(status.workerInstalled,true);
 assert.equal(x.calls.length,2);
 assert.match(x.calls[0],/\/git\/ref\/heads\/main$/);
 assert.match(x.calls[1],new RegExp(next+"/check-runs"));
 const duplicate=fixture({checks:[...success,success[0]]});
 assert.equal((await duplicate.manager.status()).approved,false);
 const failed=fixture({checks:[success[0],{...success[1],conclusion:"failure"}]});
 assert.equal((await failed.manager.status()).approved,false);
 const missing=fixture({checks:[success[0]]});
 assert.equal((await missing.manager.status()).approved,false);
});
test("prevents arbitrary commits, no-worker operation, stale head, repeat jobs",async()=>{
 const f=fixture();
 await assert.rejects(f.manager.start(";rm -rf /"),/invalid_update_target/);
 await assert.rejects(f.manager.start(other),/update_target_changed/);
 assert.equal(f.queued.length,0);
 const noWorker=fixture({worker:false});await assert.rejects(noWorker.manager.start(next),/update_worker_missing/);
 const busy=fixture({runState:{state:"running",target:other,updatedAt:"2026-10-15T00:00:00Z"}});await assert.rejects(busy.manager.start(next),/update_busy/);
 const unverified=fixture({checks:[]});await assert.rejects(unverified.manager.start(next),/release_checks_not_passed/);
 const currentInstalled=fixture({remoteSha:current});await assert.rejects(currentInstalled.manager.start(current),/update_target_changed/);
});
test("approved target queues only one fixed launch; failure persists sanitized failure",async()=>{
 const f=fixture();
 const started=await f.manager.start(next);
 assert.equal(started.target,next);
 assert.equal(started.state,"queued");
 assert.deepEqual(f.queued.map(x=>x.state),["queued"]);
 assert.ok(f.calls.includes("LAUNCH:"+next));
 const failure=fixture({launchFailure:true});await assert.rejects(failure.manager.start(next),/start_failed/);
 assert.deepEqual(failure.queued.map(x=>x.state),["queued","failed"]);
});
