import {test} from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {parseRuntimePreflight,softwareCapabilities,softwarePreflight} from "../agent/dist/software.js";

test("runtime preflight refuses arbitrary package names, command options and extra fields",()=>{
 for(const input of [null,{},[],{package:"php8.3-fpm;id"},{package:"nginx"},{package:"redis-server",run:"install"},{package:"redis-server",path:"/tmp/evil"},{package:["redis-server"]}]){
  assert.throws(()=>parseRuntimePreflight(input),/invalid_software_preflight/);
 }
 assert.equal(parseRuntimePreflight({package:"php8.3-fpm"}),"php8.3-fpm");
 assert.equal(parseRuntimePreflight({package:"redis-server"}),"redis-server");
 const info=softwareCapabilities();
 assert.equal(info.installAvailable,false);
 assert.equal(info.mode,"read-only-preflight");
 assert.deepEqual(info.options.map(o=>o.package),["php8.3-fpm","redis-server"]);
 assert.ok(info.options.every(o=>o.installAvailable===false));
});

test("runtime preflight uses only fixed Bash script and --check without installation",async()=>{
 const commands=[];
 const runner=async(binary,args,options)=>{
  commands.push({binary,args,options});
  return {stdout:"Software Center pilot preflight passed: php8.3-fpm 8.3.6\n",stderr:""};
 };
 const report=await softwarePreflight({package:"php8.3-fpm"},runner);
 assert.equal(report.status,"ready");
 assert.equal(report.installAvailable,false);
 assert.equal(commands.length,1);
 assert.equal(commands[0].binary,"/usr/bin/bash");
 assert.deepEqual(commands[0].args,["/opt/devone/current/scripts/software-runtime-pilot.sh","--check","php8.3-fpm"]);
 assert.ok(commands[0].options.timeout<=45000);
 assert.equal(commands[0].args.includes("--install"),false);
});

test("preflight fails closed when script fails or output cannot be authenticated",async()=>{
 const error=await softwarePreflight({package:"redis-server"},async()=>{throw Error("apt failure /etc/secrets");});
 assert.deepEqual(error,{package:"redis-server",status:"blocked",installAvailable:false,reason:"host_preflight_requirements_not_met"});
 const changed=await softwarePreflight({package:"redis-server"},async()=>({stdout:"unexpected",stderr:""}));
 assert.equal(changed.status,"blocked");
 assert.equal(changed.reason,"preflight_output_invalid");
});

test("agent preflight source never promotes a host pilot into a dashboard installer",()=>{
 const code=readFileSync(new URL("../agent/src/software.ts",import.meta.url),"utf8");
 assert.match(code,/SCRIPT=.*software-runtime-pilot\.sh/);
 assert.match(code,/--check/);
 assert.doesNotMatch(code,/--install|shell:true|exec\(|spawn\(|apt-get|curl.*\|.*bash/);
});
