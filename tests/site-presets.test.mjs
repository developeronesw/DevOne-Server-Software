import test from "node:test";
import assert from "node:assert/strict";
import {siteInput} from "../agent/dist/sites.js";
import {getWebsitePresets,resolvePreset} from "../apps/api/dist/presets.js";

test("website presets are infrastructure-only and do not generate code",()=>{
 const response=getWebsitePresets();
 assert.equal(response.initialContent,"empty");
 assert.deepEqual(response.deployableTypes,["static","files","php","node","python","container"]);
 assert.ok(response.presets.length>=6);
 assert.equal(new Set(response.presets.map(p=>p.id)).size,response.presets.length);
 for(const item of response.presets){
   assert.equal(item.initialContent,"empty");
   assert.ok(item.webServers.length>0);
   assert.ok(item.root==="public"||item.root==="app");
 }
 assert.equal(response.presets.find(p=>p.id==="php").available,true);
 assert.equal(response.presets.find(p=>p.id==="node").available,true);
 assert.ok(response.presets.find(p=>p.id==="php").versions.includes("8.3"));
 assert.ok(response.presets.find(p=>p.id==="node").versions.includes("22"));
});

test("site creation accepts PHP 8.3/Node 22 and refuses unsupported runtimes",()=>{
 assert.deepEqual(resolvePreset("static","nginx",""),{siteType:"static",webServer:"nginx"});
 assert.deepEqual(resolvePreset("files","none",undefined),{siteType:"files",webServer:"none"});
 for(const [type,server,version] of [
  ["php","nginx","8.4"],["php","apache","8.5"],["node","nginx","24"],
  ["python","apache","3.13"],["container","apache",undefined]
 ]){
  assert.throws(()=>resolvePreset(type,server,version),/runtime_not_available|unsupported_runtime_version|unsupported_web_server/);
 }
 assert.throws(()=>resolvePreset("static","apache",""),/unsupported_web_server/);
 assert.throws(()=>resolvePreset("php","nginx","99.99"),/unsupported_runtime_version/);
 assert.throws(()=>resolvePreset("static","nginx","22"),/unsupported_runtime_version/);
 assert.throws(()=>siteInput({domain:"x.example.com",webServer:"nginx",siteType:"php"}),/unsupported_runtime_version/);
 assert.equal(siteInput({domain:"x.example.com",webServer:"nginx",siteType:"php",runtimeVersion:"8.3"}).siteType,"php");
 assert.equal(resolvePreset("node","nginx","22").siteType,"node");
 assert.equal(resolvePreset("python","nginx","3.12").siteType,"python");
 assert.equal(resolvePreset("container","nginx","").siteType,"container");
 assert.deepEqual(siteInput({domain:"x.example.com",webServer:"nginx"}),{domain:"x.example.com",webServer:"nginx",siteType:"static"});
 assert.deepEqual(siteInput({domain:"x.example.com",webServer:"none"}),{domain:"x.example.com",webServer:"none",siteType:"files"});
});
