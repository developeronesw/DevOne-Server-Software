import {test} from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {spawnSync} from "node:child_process";

const script=readFileSync(new URL("../scripts/software-runtime-pilot.sh",import.meta.url),"utf8");
const begin=script.indexOf("# Capture APT policy exactly once");
const end=script.indexOf('simulation="$(mktemp ',begin);
assert.ok(begin>=0&&end>begin,"APT candidate and origin validation block must exist");
const policyCheck=script.slice(begin,end);

// Use a huge policy output to emulate the original premature-close SIGPIPE
// without requiring sudo, systemd, actual APT or any host package mutation.
function executePolicy(origin){
 const output=[
  "redis-server:",
  "  Installed: (none)",
  "  Candidate: 5:7.0.15-1ubuntu0.24.04.5",
  "  Version table:",
  "     5:7.0.15-1ubuntu0.24.04.5 500",
  "        500 http://us-east-1.ec2.archive.ubuntu.com/ubuntu noble-updates/universe amd64 Packages",
  "            release v=24.04,o="+origin+",a=noble-updates,n=noble,l="+origin+",c=universe,b=amd64",
  "            origin archive.ubuntu.com",
  ...Array.from({length:15000},(_,i)=>"  extra-policy-entry-"+i+": "+"x".repeat(90)),
  "     5:7.0.15-1build2 500",
 ].join("\n");
 const body="set -Eeuo pipefail\npackage=redis-server\napt-cache(){ cat <<'POLICY'\n"+output+"\nPOLICY\n}\n"+policyCheck+"\nprintf '%s\\n' \"$candidate\"\n";
 return spawnSync("bash",["-c",body],{encoding:"utf8",timeout:12000,maxBuffer:4*1024*1024});
}
test("large Ubuntu Noble policy completes without SIGPIPE 141",()=>{
 const result=executePolicy("Ubuntu");
 assert.equal(result.status,0,"exit="+result.status+" signal="+result.signal+" stderr="+result.stderr);
 assert.match(result.stdout,/5:7\.0\.15-1ubuntu0\.24\.04\.5/);
 assert.equal(result.signal,null);
});
test("policy still rejects non-Ubuntu origins",()=>{
 const result=executePolicy("ThirdParty");
 assert.notEqual(result.status,0,"external vendor candidate must be denied");
 assert.match(result.stderr,/not proven to originate from Ubuntu Noble metadata/);
});
test("host installer never pipes early-exiting candidate parser",()=>{
 assert.doesNotMatch(script,/apt-cache policy "\$package" *\| *awk/);
 assert.match(script,/policy="\$\(apt-cache policy "\$package"\)"/);
 assert.match(script,/awk -v version="\$candidate"/);
 assert.match(script,/<<< "\$policy"/);
 const syntax=spawnSync("bash",["-n",new URL("../scripts/software-runtime-pilot.sh",import.meta.url).pathname],{encoding:"utf8"});
 assert.equal(syntax.status,0,syntax.stderr);
});
