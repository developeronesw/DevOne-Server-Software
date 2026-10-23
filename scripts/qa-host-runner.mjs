// Runs only on an explicitly marked disposable QA VPS. No reset logic lives here.
import {open,constants} from 'node:fs/promises';
import {readFile,readdir} from 'node:fs/promises';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createHash} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
const exec=promisify(execFile),app='/opt/devone/current';
export function parseQaEnvironment(text){
 const values=new Map(text.split('\n').filter(l=>l&&!l.startsWith('#')).map(l=>{const i=l.indexOf('=');return [l.slice(0,i),l.slice(i+1)];}));
 const token=values.get('DEVONE_AGENT_TOKEN');
 if(!/^[a-f0-9]{64}$/.test(token??'')||values.get('DEVONE_DB_PATH')!=='/var/lib/devone/devone.sqlite'||(values.get('DEVONE_AGENT_PORT')??'8790')!=='8790')throw Error('unsupported_qa_host_profile');return {token};
}
async function trustedFile(path,publicReadable=false){
 const f=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW);try{const s=await f.stat();if(!s.isFile()||s.uid!==0||(s.mode&(publicReadable?0o022:0o027))||s.nlink!==1||s.size>65536)throw Error('unsafe_qa_host_file');return await f.readFile('utf8');}finally{await f.close();}
}
async function context(targetId,commit){
 if(process.getuid?.()!==0||fileURLToPath(import.meta.url)!==app+'/scripts/qa-host-runner.mjs')throw Error('installed_root_runner_required');
 await trustedFile(app+'/scripts/qa-host-runner.mjs',true);
 const marker=JSON.parse(await trustedFile('/etc/devone/qa-target.json'));
 if(marker.targetId!==targetId||marker.testOnly!==true)throw Error('dedicated_qa_marker_required');
 const machineId=(await readFile('/etc/machine-id','utf8')).trim();if(!/^[a-f0-9]{32}$/.test(machineId))throw Error('machine_id_invalid');
 const head=(await exec('/usr/bin/git',['-C',app,'rev-parse','HEAD'],{timeout:5000,maxBuffer:4096})).stdout.trim();
 if(head!==commit)throw Error('pinned_commit_mismatch');
 const dirty=(await exec('/usr/bin/git',['-C',app,'status','--porcelain','--untracked-files=no'],{timeout:5000,maxBuffer:4096})).stdout;if(dirty.trim())throw Error('dirty_test_installation');
 const env=await trustedFile('/etc/devone/devone.env'),{token}=parseQaEnvironment(env);
 const call=async(path,body,authenticated=true)=>{
  const r=await fetch('http://127.0.0.1:8790'+path,{method:body?'POST':'GET',headers:{...(authenticated?{Authorization:'Bearer '+token}:{}),...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(12000),redirect:'error'});
  if(!r.ok)throw Error('agent_call_failed');return r.json();
 };
 return {targetId,testOnly:true,machineId,commit,env,call};
}
async function probe(ctx){
 const [sites,databases,api,agent]=await Promise.all([ctx.call('/v1/sites'),ctx.call('/v1/databases'),fetch('http://127.0.0.1:8787/api/health',{signal:AbortSignal.timeout(5000)}).then(r=>r.ok?r.json():null),ctx.call('/v1/health')]);
 if(!Array.isArray(sites.sites)||!Array.isArray(databases.databases)||api?.ok!==true||agent?.ok!==true)throw Error('host_probe_failed');
 const db=new DatabaseSync('/var/lib/devone/devone.sqlite',{readOnly:true});let counts,secretsDigest,usersDigest;
 try{
  counts=db.prepare("SELECT count(*) users,sum(CASE WHEN role='owner' THEN 1 ELSE 0 END) owners FROM users").get();
  usersDigest=createHash('sha256').update(JSON.stringify(db.prepare('SELECT id,email,password_hash,role,created_at FROM users ORDER BY id').all())).digest('hex');
  secretsDigest=createHash('sha256').update(JSON.stringify(db.prepare('SELECT name,envelope FROM secrets ORDER BY name').all())).digest('hex');
 }finally{db.close();}
 const key=await open('/etc/devone/secrets.key',constants.O_RDONLY|constants.O_NOFOLLOW);let keyDigest;
 try{const s=await key.stat();if(s.uid!==0||(s.mode&0o027)||!s.isFile()||s.size!==32)throw Error('unsafe_key');keyDigest=createHash('sha256').update(await key.readFile()).digest('hex');}finally{await key.close();}
 const directory=async path=>{try{return await readdir(path);}catch(e){if(e.code==='ENOENT')return [];throw e;}};
 const [homes,vhosts,units,pools,passwd]=await Promise.all([directory('/home/devone-sites'),directory('/etc/nginx/conf.d'),directory('/etc/systemd/system'),directory('/etc/php/8.3/fpm/pool.d'),readFile('/etc/passwd','utf8')]);
 const leftovers={homes:homes.filter(n=>/^site_[a-f0-9]{16}$/.test(n)).length,vhosts:vhosts.filter(n=>/^devone-site_[a-f0-9]{16}\.conf$/.test(n)).length,units:units.filter(n=>/^devone-site_[a-f0-9]{16}\.service$/.test(n)).length,pools:pools.filter(n=>/^devone-site_[a-f0-9]{16}\.conf$/.test(n)).length,users:passwd.split('\n').filter(n=>/^dvs_[a-f0-9]{16}:/.test(n)).length};
 const clean=sites.sites.length===0&&databases.databases.length===0&&counts.users===1&&counts.owners===1&&Object.values(leftovers).every(n=>n===0);
 const fingerprint=createHash('sha256').update(JSON.stringify({commit:ctx.commit,machineId:ctx.machineId,envDigest:createHash('sha256').update(ctx.env).digest('hex'),keyDigest,secretsDigest,usersDigest,counts,leftovers,sites:sites.sites.map(s=>s.id).sort(),databases:databases.databases.map(d=>d.id).sort()})).digest('hex');
 return {targetId:ctx.targetId,testOnly:true,machineId:ctx.machineId,commit:ctx.commit,clean,baselineFingerprint:fingerprint,verificationScope:'managed-state-invariants',leftovers,siteCount:sites.sites.length,databaseCount:databases.databases.length};
}
export async function main(args=process.argv.slice(2)){
 const [op,targetId,runId,commit]=args;
 if(args.length!==4||!['probe','run'].includes(op)||!/^qa-[a-z0-9-]{3,60}$/.test(targetId??'')||!/^[a-f0-9-]{36}$/.test(runId??'')||!/^[a-f0-9]{40}$/.test(commit??''))throw Error('invalid_host_qa_request');
 const ctx=await context(targetId,commit);
 if(op==='probe'){console.log(JSON.stringify(await probe(ctx)));return;}
 const checks=[];
 const health=await fetch('http://127.0.0.1:8787/api/health',{signal:AbortSignal.timeout(5000)}).then(r=>r.ok).catch(()=>false);
 checks.push({id:'foundation.api.health',status:health?'pass':'fail'});
 const unauthorized=await fetch('http://127.0.0.1:8790/v1/health',{signal:AbortSignal.timeout(5000)}).then(r=>r.status===401).catch(()=>false);
 checks.push({id:'foundation.agent.authentication',status:unauthorized?'pass':'fail'});
 const start=await ctx.call('/v1/qa/disposable/start',{confirmed:true});if(start.state!=='running'||typeof start.id!=='string')throw Error('host_qa_start_failed');
 let result;const deadline=Date.now()+900000;
 while(Date.now()<deadline){result=await ctx.call('/v1/qa/disposable/status');if(result.id!==start.id)throw Error('qa_run_identity_changed');if(['passed','failed'].includes(result.state))break;await new Promise(r=>setTimeout(r,1500));}
 if(!result||!['passed','failed'].includes(result.state))throw Error('host_qa_timeout');
 const names={'site.static':'hosting.static','site.files':'hosting.files','site.php':'hosting.php','site.node':'hosting.node','site.python':'hosting.python','site.container':'hosting.container','software.host_inventory':'management.software-inventory','software.isolated_install':'management.isolated-packages'};
 if(!Array.isArray(result.results))throw Error('invalid_host_results');
 for(const r of result.results){if(names[r.name])checks.push({id:names[r.name],status:['pass','fail','blocked'].includes(r.status)?r.status:'fail',...(typeof r.cleaned==='boolean'?{cleaned:r.cleaned}:{}),...(/^site_[a-f0-9]{16}$/.test(r.siteId??'')?{resourceId:r.siteId}:{})});}
 console.log(JSON.stringify({targetId,runId,commit,checks,profileSucceeded:result.state==='passed'&&Object.keys(names).every(name=>result.results.filter(r=>r.name===name).length===1),profile:'existing-disposable-hosting',productionReady:false}));
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(()=>{console.error('Host QA blocked or failed. No credentials or raw host logs were exported.');process.exitCode=1;});
