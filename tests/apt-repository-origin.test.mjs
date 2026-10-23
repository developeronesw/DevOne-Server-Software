import {test} from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {spawnSync} from "node:child_process";
const sh=readFileSync(new URL("../scripts/software-runtime-pilot.sh",import.meta.url),"utf8");
const start=sh.indexOf('policy="$(apt-cache policy "$package")"');
const end=sh.indexOf('simulation="$(mktemp ',start);
assert.ok(start>=0&&end>start);
const code=sh.slice(start,end);
const ubuntu=(packageName)=>[
  packageName+":",
  "  Installed: (none)",
  "  Candidate: "+(packageName==="redis-server"?"5:7.0.15-1ubuntu0.24.04.5":"8.3.6-0ubuntu0.24.04.1"),
  "  Version table:",
  "     "+(packageName==="redis-server"?"5:7.0.15-1ubuntu0.24.04.5":"8.3.6-0ubuntu0.24.04.1")+" 500",
  "        500 http://us-east-1.ec2.archive.ubuntu.com/ubuntu noble-updates/universe amd64 Packages",
  "        500 http://security.ubuntu.com/ubuntu noble-security/universe amd64 Packages",
  "     5:7.0.15-1build2 500",
  "        500 http://us-east-1.ec2.archive.ubuntu.com/ubuntu noble/universe amd64 Packages"
].join("\n");
const aptRepo=[
 "Package files:",
 " 500 http://us-east-1.ec2.archive.ubuntu.com/ubuntu noble-updates/universe amd64 Packages",
 "     release v=24.04,o=Ubuntu,a=noble-updates,n=noble,l=Ubuntu,c=universe,b=amd64",
 "     origin us-east-1.ec2.archive.ubuntu.com",
 " 500 http://security.ubuntu.com/ubuntu noble-security/universe amd64 Packages",
 "     release v=24.04,o=Ubuntu,a=noble-security,n=noble,l=Ubuntu,c=universe,b=amd64",
 "     origin security.ubuntu.com",
 " 500 http://example.com/evil noble-updates/universe amd64 Packages",
 "     release v=24.04,o=Evil,a=noble-updates,n=noble,l=Evil,c=universe,b=amd64"
].join("\n");
function check({name="redis-server",packagePolicy=ubuntu(name),repoPolicy=aptRepo}={}){
 const body=[
 "set -Eeuo pipefail",
 "package="+JSON.stringify(name),
 "apt-cache(){",
 'if [[ "$#" == 2 ]]; then cat <<'+"'PACKAGE_POLICY'",
 packagePolicy,
 "PACKAGE_POLICY",
 "else cat <<'REPOSITORY_POLICY'",
 repoPolicy,
 "REPOSITORY_POLICY",
 "fi",
 "}",
 code,
 "echo APT_ORIGIN_ACCEPTED"
 ].join("\n");
 return spawnSync("bash",["-c",body],{encoding:"utf8",timeout:8000,maxBuffer:2000000});
}
test("realistic Lightsail Redis policy lacking release lines passes matched Ubuntu metadata",()=>{
 const r=check();
 assert.equal(r.status,0,r.stderr);
 assert.match(r.stdout,/APT_ORIGIN_ACCEPTED/);
});
test("PHP 8.3 FPM policy succeeds against Ubuntu release metadata",()=>{
 const r=check({name:"php8.3-fpm"});
 assert.equal(r.status,0,r.stderr);
});
test("candidate from third-party repository cannot borrow another repository's Ubuntu origin",()=>{
 const p=ubuntu("redis-server").replaceAll("http://us-east-1.ec2.archive.ubuntu.com/ubuntu noble-updates/universe","http://example.com/evil noble-updates/universe").replaceAll("http://security.ubuntu.com/ubuntu noble-security/universe","http://example.com/evil noble-updates/universe");
 const r=check({packagePolicy:p});
 assert.notEqual(r.status,0);
 assert.match(r.stderr,/repository_origin_unverified/);
});
test("non-APT or malformed package sources are denied",()=>{
 const r=check({packagePolicy:ubuntu("redis-server").replaceAll("http://","file:///")});
 assert.notEqual(r.status,0);
 assert.match(r.stderr,/candidate_sources_unavailable/);
});
test("a repository with Ubuntu-looking suite but wrong signed origin is denied",()=>{
 const p=ubuntu("redis-server").replaceAll("http://us-east-1.ec2.archive.ubuntu.com/ubuntu","http://example.com/evil").replaceAll("http://security.ubuntu.com/ubuntu","http://example.com/evil");
 const r=check({packagePolicy:p});
 assert.notEqual(r.status,0);
});
test("an Ubuntu release with incompatible suite is rejected",()=>{
 const repo=aptRepo.replaceAll("n=noble,l=Ubuntu","n=oracular,l=Ubuntu");
 const r=check({repoPolicy:repo});
 assert.notEqual(r.status,0);
});
test("an absent APT candidate cannot pass origin validation",()=>{
 const r=check({packagePolicy:ubuntu("redis-server").replace("Candidate: 5:7.0.15-1ubuntu0.24.04.5","Candidate: (none)")});
 assert.notEqual(r.status,0);
});
test("candidate URL and suite must match actual repository metadata",()=>{
 const r=check({repoPolicy:aptRepo.replace("noble-updates/universe amd64 Packages","noble-updates/main amd64 Packages").replace("noble-security/universe amd64 Packages","noble-security/main amd64 Packages")});
 assert.notEqual(r.status,0);
});
test("script does not use unreliable package-policy release parsing or early-exiting pipeline",()=>{
 assert.doesNotMatch(sh,/apt-cache policy "\$package" *\| *awk/);
 assert.doesNotMatch(code,/active && \$1=="release"/);
 assert.match(code,/repository_policy="\$\(apt-cache policy\)"/);
 const r=spawnSync("bash",["-n",new URL("../scripts/software-runtime-pilot.sh",import.meta.url).pathname],{encoding:"utf8"});
 assert.equal(r.status,0,r.stderr);
});
