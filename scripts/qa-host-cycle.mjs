// External controller: never run the reset controller on the target VPS.
import {execFile} from 'node:child_process';
import {readFile,lstat,mkdir,open,rename,unlink} from 'node:fs/promises';
import {resolve,isAbsolute,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
export function validateCycleConfig(c){
 if(!c||c.schemaVersion!==1||c.dedicatedTestServer!==true||!/^qa-[a-z0-9-]{3,60}$/.test(c.targetId??'')||!/^\w[\w.-]*@[a-zA-Z0-9][a-zA-Z0-9.-]*$/.test(c.sshTarget??'')||!/^[a-f0-9]{32}$/.test(c.machineId??'')||!/^[a-f0-9]{40}$/.test(c.commit??'')||!/^[a-f0-9]{64}$/.test(c.baselineFingerprint??'')||!/^[a-zA-Z0-9_.:-]{1,128}$/.test(c.baselineId??'')||typeof c.resetHook!=='string'||!isAbsolute(c.resetHook)||typeof c.outputDir!=='string'||!isAbsolute(c.outputDir)||!Number.isSafeInteger(c.testTimeoutMs)||c.testTimeoutMs<30000||c.testTimeoutMs>3600000)throw Error('invalid_qa_cycle_config');
 return c;
}
export function assessLivePhases(requirements,checks,resetVerified){
 if(!Array.isArray(requirements)||!requirements.length||new Set(requirements.map(r=>r.id)).size!==requirements.length||requirements.some(r=>typeof r.id!=='string'||![1,2,3,4].includes(r.phase)))throw Error('invalid_acceptance_requirements');
 if(!Array.isArray(checks)||new Set(checks.map(c=>c.id)).size!==checks.length||checks.some(c=>!c||Object.keys(c).some(k=>!['id','status','cleaned','resourceId'].includes(k))||(c.resourceId!==undefined&&!/^site_[a-f0-9]{16}$/.test(c.resourceId))||(c.cleaned!==undefined&&typeof c.cleaned!=='boolean')||(c.status==='pass'&&c.cleaned===false)||!requirements.some(r=>r.id===c.id)||!['pass','fail','blocked'].includes(c.status)))throw Error('invalid_live_checks');
 return [1,2,3,4].map(phase=>{const required=requirements.filter(r=>r.phase===phase),items=required.map(r=>({id:r.id,status:checks.find(c=>c.id===r.id)?.status??'blocked'}));return {phase,status:!items.length?'blocked':items.some(i=>i.status==='fail')?'fail':items.every(i=>i.status==='pass')&&resetVerified?'pass':'blocked',checks:items};});
}
function validProbe(p,c,localId){
 return p?.targetId===c.targetId&&p.testOnly===true&&p.machineId===c.machineId&&p.machineId!==localId&&p.commit===c.commit&&/^[a-f0-9]{64}$/.test(p.baselineFingerprint??'');
}
export async function runCycle(config,deps){
 const c=validateCycleConfig(config),runId=deps.runId??randomUUID();
 const report={schemaVersion:1,runId,targetId:c.targetId,commit:c.commit,baselineId:c.baselineId,startedAt:new Date().toISOString(),state:'preflight',tests:'blocked',reset:'not_attempted',checks:[],phaseResults:[],needsReset:false,productionReady:false};
 let armed=false;
 try{
  const before=await deps.probe(c,runId);
  if(!validProbe(before,c,deps.localMachineId))throw Error('target_identity_or_commit_mismatch');
  armed=true;report.needsReset=true;await deps.save(report);
  if(before.clean!==true||before.baselineFingerprint!==c.baselineFingerprint)throw Error('target_baseline_mismatch');
  report.state='testing';await deps.save(report);
  const result=await deps.test(c,runId);
  if(result?.runId!==runId||result.commit!==c.commit||result.targetId!==c.targetId||!Array.isArray(result.checks)||typeof result.profileSucceeded!=='boolean')throw Error('invalid_host_test_evidence');
  assessLivePhases(deps.requirements,result.checks,false);report.checks=result.checks;
  report.tests=result.profileSucceeded!==true?'fail':result.checks.length&&result.checks.every(x=>x.status==='pass')?'pass':result.checks.some(x=>x.status==='fail')?'fail':'blocked';
 }catch(e){report.error=['target_identity_or_commit_mismatch','target_baseline_mismatch','invalid_host_test_evidence','invalid_live_checks'].includes(e?.message)?e.message:'host_test_or_transport_failed';if(armed)report.tests='fail';}
 finally{
  if(armed){
   report.state='resetting';report.reset='pending';
   try{await deps.save(report);}catch{report.evidenceWriteFailed=true;}
   try{
    const receipt=await deps.reset(c,runId);
    if(receipt?.completed!==true||receipt.runId!==runId||receipt.targetId!==c.targetId||receipt.baselineId!==c.baselineId||typeof receipt.operationId!=='string'||!receipt.operationId||receipt.operationId.length>200)throw Error('invalid_reset_receipt');
    report.resetOperationId=receipt.operationId;
    const after=await deps.waitForBaseline(c,runId);
    if(!validProbe(after,c,deps.localMachineId)||after.clean!==true||after.baselineFingerprint!==c.baselineFingerprint)throw Error('reset_verification_failed');
    report.reset='verified';report.needsReset=false;
   }catch{report.reset='failed';report.needsReset=true;}
  }
  report.phaseResults=assessLivePhases(deps.requirements,report.checks,report.reset==='verified'&&report.tests==='pass'&&!report.evidenceWriteFailed);
  report.state=report.evidenceWriteFailed?'evidence_failed':report.reset==='failed'?'reset_failed':report.tests==='pass'&&report.reset==='verified'?'profile_passed':report.tests==='fail'?'tests_failed':'blocked';
  report.finishedAt=new Date().toISOString();
  // Even complete phase 1-4 results do not certify Phase 5 or publish a stable release.
  await deps.save(report);
 }
 return report;
}
export async function recoverCycle(c,report,deps){
 validateCycleConfig(c);
 if(report?.schemaVersion!==1||report.targetId!==c.targetId||report.commit!==c.commit||report.baselineId!==c.baselineId||!/^[0-9a-f-]{36}$/.test(report.runId??''))throw Error('invalid_recovery_record');
 if(report.needsReset===false&&report.reset==='verified')return report;
 if(report.needsReset!==true)throw Error('invalid_recovery_record');
 const receipt=await deps.reset(c,report.runId);
 if(receipt?.completed!==true||receipt.runId!==report.runId||receipt.targetId!==c.targetId||receipt.baselineId!==c.baselineId||typeof receipt.operationId!=='string'||!receipt.operationId)throw Error('invalid_reset_receipt');
 const after=await deps.waitForBaseline(c,report.runId);
 if(!validProbe(after,c,deps.localMachineId)||after.clean!==true||after.baselineFingerprint!==c.baselineFingerprint)throw Error('reset_verification_failed');
 const recovered={...report,reset:'verified',needsReset:false,state:'recovered_after_interruption',resetOperationId:receipt.operationId,finishedAt:new Date().toISOString(),productionReady:false};await deps.save(recovered);return recovered;
}
const command=(binary,args,timeout)=>new Promise((resolveResult,reject)=>{
 execFile(binary,args,{timeout,maxBuffer:1048576,killSignal:'SIGKILL'},(error,stdout)=>{if(error)reject(Error('qa_transport_failed'));else{try{resolveResult(JSON.parse(stdout));}catch{reject(Error('qa_transport_invalid_json'));}}});
});
async function makeDependencies(c){
 const localMachineId=(await readFile('/etc/machine-id','utf8')).trim();
 const hook=await lstat(c.resetHook);if(!hook.isFile()||hook.isSymbolicLink()||(hook.mode&0o022)||!(hook.mode&0o111)||![0,process.getuid()].includes(hook.uid))throw Error('unsafe_or_missing_reset_hook');
 await mkdir(c.outputDir,{recursive:true,mode:0o700});const out=await lstat(c.outputDir);if(!out.isDirectory()||out.isSymbolicLink()||(out.mode&0o077)||out.uid!==process.getuid())throw Error('unsafe_evidence_directory');
 const requirements=JSON.parse(await readFile(resolve(root,'qa/acceptance-requirements.json'),'utf8')).requirements;
 const remote=(op,runId,timeout)=>command('/usr/bin/ssh',['-T','-o','BatchMode=yes','-o','StrictHostKeyChecking=yes','-o','ConnectTimeout=10','--',c.sshTarget,'sudo','-n','/usr/bin/node','/opt/devone/current/scripts/qa-host-runner.mjs',op,c.targetId,runId,c.commit],timeout);
 const save=async report=>{const tmp=resolve(c.outputDir,'.'+report.runId+'-'+randomUUID()+'.tmp');const f=await open(tmp,'wx',0o600);try{await f.writeFile(JSON.stringify(report,null,2));await f.sync();}finally{await f.close();}await rename(tmp,resolve(c.outputDir,report.runId+'.json'));const directory=await open(c.outputDir,'r');try{await directory.sync();}finally{await directory.close();}};
 const deps={localMachineId,requirements,save,probe:(_c,id)=>remote('probe',id,15000),test:(_c,id)=>remote('run',id,c.testTimeoutMs),reset:(_c,id)=>command(c.resetHook,[c.targetId,c.baselineId,id],600000),waitForBaseline:async(_c,id)=>{const deadline=Date.now()+300000;while(Date.now()<deadline){try{const p=await remote('probe',id,15000);if(validProbe(p,c,localMachineId)&&p.clean===true&&p.baselineFingerprint===c.baselineFingerprint)return p;}catch{}await new Promise(r=>setTimeout(r,3000));}throw Error('baseline_unreachable');}};
 return deps;
}
export async function main(args=process.argv.slice(2)){
 const [mode,configPath,confirmation,recoveryPath]=args;
 if(!['--plan','--execute','--recover'].includes(mode)||!configPath)throw Error('usage: qa-host-cycle.mjs --plan CONFIG | --execute CONFIG TARGET_ID | --recover CONFIG TARGET_ID REPORT');
 const c=validateCycleConfig(JSON.parse(await readFile(configPath,'utf8')));
 if(mode==='--plan'){console.log(JSON.stringify({targetId:c.targetId,commit:c.commit,baselineId:c.baselineId,changes:'Run disposable QA, then invoke external baseline reset and verify managed-state invariants.',requirements:JSON.parse(await readFile(resolve(root,'qa/acceptance-requirements.json'),'utf8')).requirements,executed:false},null,2));return;}
 if(confirmation!==c.targetId)throw Error('explicit_qa_target_confirmation_required');
 const deps=await makeDependencies(c);
 const previous=mode==='--recover'?JSON.parse(await readFile(recoveryPath,'utf8')):null;
 const runId=previous?.runId??recoveryPath??randomUUID();if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(runId))throw Error('invalid_qa_run_id');deps.runId=runId;
 const lockPath=resolve(c.outputDir,c.targetId+'.lock');
 let lock;
 if(mode==='--recover'){
  const old=JSON.parse(await readFile(lockPath,'utf8').catch(()=>'{"runId":null}'));
  if(old.runId!==null&&old.runId!==runId)throw Error('another_qa_cycle_owns_target');
  if(old.runId===null){lock=await open(lockPath,'wx',0o600);await lock.writeFile(JSON.stringify({runId}));await lock.sync();await lock.close();}
 }else{lock=await open(lockPath,'wx',0o600);await lock.writeFile(JSON.stringify({runId}));await lock.sync();await lock.close();}
 let result;
 try{result=mode==='--recover'?await recoverCycle(c,previous,deps):await runCycle(c,deps);}
 finally{
  const saved=JSON.parse(await readFile(resolve(c.outputDir,runId+'.json'),'utf8').catch(()=>'{"needsReset":true}'));
  if(saved.needsReset===false)await unlink(lockPath);
 }

 console.log(JSON.stringify({runId:result.runId,state:result.state,tests:result.tests,reset:result.reset,phaseResults:result.phaseResults,productionReady:false},null,2));
 if(mode==='--recover'?result.reset!=='verified':result.state!=='profile_passed')process.exitCode=1;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(()=>{console.error('QA controller could not complete. Preserve the run journal and inspect/reset the dedicated QA target; no passing result was issued.');process.exitCode=1;});
