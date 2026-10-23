import {test} from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {spawnSync} from "node:child_process";

const script=readFileSync(new URL("../scripts/software-runtime-pilot.sh",import.meta.url),"utf8");
const begin=script.indexOf('packages=("$package")');
const end=script.indexOf('simulation="$(mktemp ',begin);
assert.ok(begin>=0&&end>begin,"APT candidate and origin validation block must exist");
const policyCheck=script.slice(begin,end);

// Use a huge policy output to emulate the original premature-close SIGPIPE
// without requiring sudo, systemd, actual APT or any host package mutation.
function executePolicy(origin){
 // Generate large output inside Bash, not inside the argv passed to bash -c
 // (Linux limits each argv string to ~128 KiB).
 const body=[
   "set -Eeuo pipefail",
   'fail(){ printf >&2 "DEVONE_INSTALL_ERROR:%s\\n" "$1"; exit 1; }',
   "package=redis-server",
   "origin="+JSON.stringify(origin),
   "apt-cache(){",
   'if [[ "$#" == 2 ]]; then',
   "  printf 'redis-server:\\n  Installed: (none)\\n  Candidate: 5:7.0.15-1ubuntu0.24.04.5\\n  Version table:\\n     5:7.0.15-1ubuntu0.24.04.5 500\\n'",
   "  printf '       500 http://archive.ubuntu.com/ubuntu noble-updates/universe amd64 Packages\\n'",
   "  for ((i=0;i<9000;i++)); do printf '   extra-policy-entry-%s: %090d\\n' \"$i\" \"$i\"; done",
   'else',
   "  printf 'Package files:\\n 500 http://archive.ubuntu.com/ubuntu noble-updates/universe amd64 Packages\\n'",
   "  printf '     release v=24.04,o=%s,a=noble-updates,n=noble,l=%s,c=universe,b=amd64\\n' \"$origin\" \"$origin\"",
   'fi',
   "}",
   policyCheck,
   "printf '%s\\n' \"$candidate\"",
 ].join("\n");
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
 assert.match(result.stderr,/repository_origin_unverified/);
});
test("host installer never pipes early-exiting candidate parser",()=>{
 assert.doesNotMatch(script,/apt-cache policy "\$package" *\| *awk/);
 assert.match(script,/policy="\$\(apt-cache policy "\$selected_package"\)"/);
 assert.match(script,/awk -v version="\$candidate"/);
 assert.match(script,/<<< "\$policy"/);
 const syntax=spawnSync("bash",["-n",new URL("../scripts/software-runtime-pilot.sh",import.meta.url).pathname],{encoding:"utf8"});
 assert.equal(syntax.status,0,syntax.stderr);
});
