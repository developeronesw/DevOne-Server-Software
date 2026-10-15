import {test} from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {parseRuntimePreflight,parseRuntimeInstall,softwareCapabilities,softwarePreflight,softwareInstall,softwareStatus} from "../agent/dist/software.js";

test("managed software catalog is explicit, operational and strictly allowlisted",()=>{
 const capabilities=softwareCapabilities();
 assert.equal(capabilities.mode,"managed-install");
 assert.equal(capabilities.installAvailable,true);
 assert.deepEqual(capabilities.options.map(v=>v.package),["php8.3-fpm","redis-server"]);
 assert.ok(capabilities.options.every(v=>v.installAvailable===true));
 for(const entry of [null,{},[],{package:"php8.3-fpm;id"},{package:"nginx"},{package:"redis-server",run:"install"},{package:"redis-server",path:"/tmp"}])
  assert.throws(()=>parseRuntimePreflight(entry),/invalid_software_preflight/);
 for(const entry of [null,{},[],{package:"curl",confirmed:true},{package:"redis-server",confirmed:false},{package:"redis-server",confirmed:true,command:"rm -rf /"}])
  assert.throws(()=>parseRuntimeInstall(entry),/invalid_software_install/);
 assert.equal(parseRuntimeInstall({package:"redis-server",confirmed:true}),"redis-server");
});
test("Ubuntu installed state is from actual dpkg-query and systemd results",async()=>{
 const commands=[];
 const run=async(bin,args,opts)=>{
  commands.push([bin,args,opts]);
  if(bin==="/usr/bin/dpkg-query")return {stdout:args.at(-1)==="redis-server"?"install ok installed 7:7.0.15-1ubuntu2\n":"",stderr:""};
  if(bin==="/usr/bin/systemctl")return {stdout:"active\n",stderr:""};
  throw Error("unknown_command");
 };
 const state=await softwareStatus(run);
 assert.equal(state.installAvailable,true);
 assert.deepEqual(state.packages.map(p=>p.installed),[false,true]);
 assert.equal(state.packages[1].serviceActive,true);
 assert.ok(commands.every(x=>x[0]==="/usr/bin/dpkg-query"||x[0]==="/usr/bin/systemctl"));
});
test("Owner-approved install runs real package manager script, then verifies dpkg and service",async()=>{
 const commands=[];
 const run=async(bin,args,opts)=>{
  commands.push([bin,args,opts]);
  if(bin==="/usr/bin/bash")return {stdout:"Managed package installed\n",stderr:""};
  if(bin==="/usr/bin/dpkg-query")return {stdout:args.at(-1)==="php8.3-fpm"?"install ok installed 8.3.6-0ubuntu0.24.04.1":"",stderr:""};
  if(bin==="/usr/bin/systemctl")return {stdout:"active\n",stderr:""};
  throw Error("unexpected command");
 };
 const result=await softwareInstall({package:"php8.3-fpm",confirmed:true},run);
 assert.equal(result.installed,true);
 assert.equal(result.serviceActive,true);
 assert.deepEqual(commands[0].slice(0,2),["/usr/bin/bash",["/opt/devone/current/scripts/software-runtime-pilot.sh","--managed-install","php8.3-fpm"]]);
 assert.ok(commands[0][2].timeout>=300000);
});
test("install requires confirmed allowlisted request and fails closed on errors",async()=>{
 let invoked=false;
 await assert.rejects(softwareInstall({package:"foo",confirmed:true},async()=>{invoked=true;}),/invalid_software_install/);
 assert.equal(invoked,false);
 await assert.rejects(softwareInstall({package:"redis-server",confirmed:true},async()=>{throw Error("apt log secret");}),/software_install_requires_inspection/);
});
test("legacy CLI preflight stays read-only; managed install uses fixed script and no shell",async()=>{
 const run=async()=>({stdout:"Software Center pilot preflight passed: redis-server 7.0\n",stderr:""});
 const result=await softwarePreflight({package:"redis-server"},run);
 assert.equal(result.status,"ready");
 assert.equal(result.installAvailable,false);
 const code=readFileSync(new URL("../agent/src/software.ts",import.meta.url),"utf8");
 assert.match(code,/--managed-install/);
 assert.doesNotMatch(code,/shell:true|exec\(|spawn\(|curl.*\|.*bash/);
});
