import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const software = readFileSync(new URL('../scripts/software-runtime-pilot.sh',import.meta.url),'utf8');
const security = readFileSync(new URL('../scripts/crowdsec-host-acceptance.sh',import.meta.url),'utf8');
test('both host milestone pilots parse as bash',()=>{
 for(const file of ['software-runtime-pilot.sh','crowdsec-host-acceptance.sh']) {
  const result=spawnSync('bash',['-n',fileURLToPath(new URL('../scripts/'+file,import.meta.url))],{encoding:'utf8'});
  assert.equal(result.status,0,result.stderr);
 }
});
test('software pilot has safe defaults, exact allowlist, APT preflight and confirmation',()=>{
 assert.match(software,/mode="\$\{1:---check\}"/);
 assert.match(software,/php8\.3-fpm\|redis-server/);
 assert.match(software,/apt-cache policy/);
 assert.match(software,/o=Ubuntu/);
 assert.match(software,/apt-get -s --no-install-recommends install/);
 assert.match(software,/\^Remv/);
 assert.match(software,/flock -n 9/);
 assert.match(software,/\[\[ -t 0 \]\]/);
 assert.match(software,/Type INSTALL \$package/);
 assert.match(software,/DEBIAN_FRONTEND=noninteractive apt-get/);
 assert.match(software,/nginx -t/);
 assert.doesNotMatch(software,/curl\s+[^\n]*\|\s*(?:sh|bash)|wget\s+[^\n]*\|\s*(?:sh|bash)/);
 assert.doesNotMatch(software,/rm -rf|apt-get.*purge|systemctl stop nginx|killall apt/);
 assert.ok(software.indexOf('if [[ "$mode" == "--check" ]]') < software.indexOf('DEBIAN_FRONTEND=noninteractive apt-get'));
});
test('CrowdSec acceptance probe is read-only and does not claim WAF enforcement',()=>{
 assert.match(security,/read-only CrowdSec detection-engine/);
 assert.match(security,/CrowdSec engine running/);
 assert.match(security,/NOT VERIFIED: NGINX bouncer, AppSec/);
 assert.match(security,/exit 1/);
 assert.doesNotMatch(security,/\bapt-get\b|\bsystemctl (?:stop|start|restart)\b|\biptables\b|\bnft add\b|\bcscli (?:decisions add|ban)\b/);
});
