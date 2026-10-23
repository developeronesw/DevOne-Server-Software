import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {softwareStatus,softwareCapabilities} from '../agent/dist/software.js';
const source=readFileSync(new URL('../scripts/software-runtime-pilot.sh',import.meta.url),'utf8');
const start=source.indexOf('if [[ "$package" == "mariadb-server" || "$package" == "postgresql" ]]; then');
const end=source.indexOf('echo "Managed package installed',start);assert.ok(start>=0&&end>start);
const listenerCheck=source.slice(start,end);
function verify(packageName,listeners){
 const script=['set -Eeuo pipefail','package='+packageName,'fail(){ echo "$1" >&2; exit 1; }',"ss(){ cat <<'LISTENERS'",listeners,'LISTENERS','}',listenerCheck].join('\n');
 return spawnSync('bash',['-c',script],{encoding:'utf8',timeout:5000});
}
test('database installation checks reject public interfaces and accept loopback or socket-only profiles',()=>{
 for(const [packageName,listeners,success] of [
 ['mariadb-server','LISTEN 0 80 127.0.0.1:3306 0.0.0.0:*',true],
 ['postgresql','LISTEN 0 80 [::1]:5432 [::]:*',true],
 ['postgresql','',true],
 ['mariadb-server','LISTEN 0 80 0.0.0.0:3306 0.0.0.0:*',false],
 ['postgresql','LISTEN 0 80 [::]:5432 [::]:*',false],
 ['postgresql','LISTEN 0 80 192.0.2.1:5432 0.0.0.0:*',false],
 ['postgresql','LISTEN 0 80 0.0.0.0:80 0.0.0.0:*',true]
 ]){const r=verify(packageName,listeners);assert.equal(r.status===0,success,r.stderr);if(!success)assert.match(r.stderr,/database_exposed/);}
});
test('engine package inventory maps MariaDB package to its actual systemd unit',async()=>{
 const seen=[];const result=await softwareStatus(async(binary,args)=>{seen.push([binary,args]);return {stdout:binary.endsWith('dpkg-query')?'install ok installed 1.0':'active',stderr:''};});
 assert.equal(result.packages.length,5);assert.ok(result.packages.every(p=>p.installed&&p.serviceActive));
 assert.ok(seen.some(([b,a])=>b.endsWith('systemctl')&&a[1]==='mariadb.service'));assert.ok(seen.some(([b,a])=>b.endsWith('systemctl')&&a[1]==='postgresql.service'));
 assert.ok(softwareCapabilities().options.some(p=>p.package==='mariadb-server'&&p.label==='MariaDB Server'));
});
