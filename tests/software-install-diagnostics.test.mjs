import {test} from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {parseInstallFailure,installFailureReasons,SoftwareInstallFailure} from "../agent/dist/software.js";
import {safeInstallFailureReasons,isSafeInstallFailureReason} from "../apps/api/dist/software-reasons.js";
import {assertAgentMutationResult} from "../apps/api/dist/job-agent-result.js";

const sh=readFileSync(new URL("../scripts/software-runtime-pilot.sh",import.meta.url),"utf8");
test("Agent and API agree on every allowlisted script failure",()=>{
 assert.deepEqual([...installFailureReasons].sort(),safeInstallFailureReasons.filter(x=>x!=="unclassified").sort());
 for(const r of installFailureReasons){
  assert.match(sh,new RegExp('fail "'+r+'"|DEVONE_INSTALL_ERROR:'+r),"script must emit "+r);
  assert.equal(parseInstallFailure("DEVONE_INSTALL_ERROR:"+r+"\nordinary APT stderr\n"),r);
  assert.equal(isSafeInstallFailureReason(r),true);
 }
});
test("untrusted stderr and malformed Agent reason never reach job errors",()=>{
 for(const input of [null,undefined,42,"/etc/shadow","DEVONE_INSTALL_ERROR:../../etc/shadow\n","DEVONE_INSTALL_ERROR:unknown_fake\n"]){
  assert.equal(parseInstallFailure(input),"unclassified");
 }
 assert.equal(parseInstallFailure("oops\nDEVONE_INSTALL_ERROR:apt_simulation_failed\n"),"apt_simulation_failed");
 assert.equal(parseInstallFailure("DEVONE_INSTALL_ERROR:apt_transaction_failed\npassword=mypassword"),"apt_transaction_failed");
 assert.equal(isSafeInstallFailureReason("/etc/secret"),false);
});
test("known server package errors propagate without exposing raw APT content",async()=>{
 const r=new Response(JSON.stringify({error:"software_install_requires_inspection",reason:"apt_transaction_failed",stderr:"/var/lib/secret"}),{status:503,headers:{"Content-Type":"application/json"}});
 await assert.rejects(assertAgentMutationResult(r,"software.install"),{message:"software_install_apt_transaction_failed"});
 const unknown=new Response(JSON.stringify({error:"software_install_requires_inspection",reason:"malicious_command"}),{status:503});
 await assert.rejects(assertAgentMutationResult(unknown,"software.install"),{message:"software_install_unclassified"});
});
test("public failure instance always uses constant error message",()=>{
 const e=new SoftwareInstallFailure("apt_simulation_failed");
 assert.equal(e.message,"software_install_requires_inspection");
 assert.equal(e.reason,"apt_simulation_failed");
});
