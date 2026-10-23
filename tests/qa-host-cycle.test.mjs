import test from 'node:test';
import assert from 'node:assert/strict';
import {runCycle,recoverCycle,assessLivePhases,validateCycleConfig} from '../scripts/qa-host-cycle.mjs';
import {parseQaEnvironment} from '../scripts/qa-host-runner.mjs';
const config={schemaVersion:1,dedicatedTestServer:true,targetId:'qa-devone-acceptance',sshTarget:'qa@test.example.invalid',machineId:'a'.repeat(32),commit:'b'.repeat(40),baselineId:'clean-image',baselineFingerprint:'c'.repeat(64),resetHook:'/usr/local/lib/devone-qa/reset',outputDir:'/var/lib/devone-qa/reports',testTimeoutMs:30000};
const runId='01234567-89ab-4cde-8fab-0123456789ab';
const requirements=[{id:'foundation.api.health',phase:1},{id:'management.services',phase:2},{id:'hosting.static',phase:3},{id:'infrastructure.mariadb',phase:4}];
function fixture(){
 const events=[],saved=[],probe={targetId:config.targetId,testOnly:true,machineId:config.machineId,commit:config.commit,clean:true,baselineFingerprint:config.baselineFingerprint};
 const deps={runId,requirements,localMachineId:'d'.repeat(32),probe:async()=>{events.push('probe');return {...probe};},save:async r=>{events.push('save:'+r.state);saved.push(structuredClone(r));},test:async()=>{events.push('test');return {runId,targetId:config.targetId,commit:config.commit,profileSucceeded:true,checks:requirements.map(r=>({id:r.id,status:'pass'}))};},reset:async()=>{events.push('reset');return {completed:true,targetId:config.targetId,baselineId:config.baselineId,runId,operationId:'provider-operation-1'};},waitForBaseline:async()=>{events.push('verify');return {...probe};}};
 return {deps,events,saved,probe};
}
test('host cycle journals before tests and verifies reset before any phase can pass',async()=>{
 const f=fixture(),r=await runCycle(config,f.deps);assert.equal(r.state,'profile_passed');assert.equal(r.reset,'verified');assert.equal(r.productionReady,false);assert.ok(r.phaseResults.every(p=>p.status==='pass'));assert.ok(f.events.indexOf('save:preflight')<f.events.indexOf('test'));assert.ok(f.events.indexOf('reset')<f.events.indexOf('verify'));assert.equal(f.saved[0].needsReset,true);assert.equal(f.saved.at(-1).needsReset,false);
});
test('test failures, transport errors and malformed evidence still attempt external reset',async()=>{
 for(const mode of ['failed','throw','wrong-run','duplicate','false-cleanup']){
  const f=fixture();f.deps.test=async()=>{if(mode==='throw')throw Error('private transport output');return {runId:mode==='wrong-run'?'other':runId,targetId:config.targetId,commit:config.commit,profileSucceeded:true,checks:mode==='duplicate'?[{id:requirements[0].id,status:'pass'},{id:requirements[0].id,status:'pass'}]:[{id:requirements[0].id,status:mode==='failed'?'fail':'pass',...(mode==='false-cleanup'?{cleaned:false}:{})}]};};
  const r=await runCycle(config,f.deps);assert.equal(r.tests,'fail');assert.equal(r.reset,'verified');assert.ok(f.events.includes('reset'));assert.ok(!JSON.stringify(r).includes('private transport output'));
 }
});
test('wrong target, same machine or moved commit cannot run tests or reset a server',async()=>{
 for(const field of ['target','self','commit']){const f=fixture();f.deps.probe=async()=>({...f.probe,...(field==='target'?{targetId:'qa-someone-else'}:field==='self'?{machineId:f.deps.localMachineId}:{commit:'e'.repeat(40)})});const r=await runCycle(config,f.deps);assert.equal(r.state,'blocked');assert.ok(!f.events.includes('test'));assert.ok(!f.events.includes('reset'));}
});
test('reset failure or wrong restored baseline is reported separately and keeps recovery pending',async()=>{
 for(const mode of ['throw','receipt','baseline']){const f=fixture();if(mode==='throw')f.deps.reset=async()=>{throw Error('reset failed');};if(mode==='receipt')f.deps.reset=async()=>({completed:true,runId,targetId:'qa-wrong',baselineId:config.baselineId,operationId:'x'});if(mode==='baseline')f.deps.waitForBaseline=async()=>({...f.probe,baselineFingerprint:'f'.repeat(64)});const r=await runCycle(config,f.deps);assert.equal(r.state,'reset_failed');assert.equal(r.needsReset,true);assert.ok(r.phaseResults.every(p=>p.status!=='pass'));}
});
test('missing feature coverage remains blocked even when the hosting profile and reset pass',async()=>{
 const f=fixture();f.deps.test=async()=>({runId,targetId:config.targetId,commit:config.commit,profileSucceeded:true,checks:[{id:'hosting.static',status:'pass'}]});const r=await runCycle(config,f.deps);assert.equal(r.phaseResults.find(p=>p.phase===3).status,'pass');assert.equal(r.phaseResults.find(p=>p.phase===4).status,'blocked');assert.equal(r.productionReady,false);
 assert.ok(assessLivePhases(requirements,[],true).every(p=>p.status==='blocked'));
});
test('interrupted run recovery reuses its identity and requires a matching reset receipt',async()=>{
 const f=fixture(),record={schemaVersion:1,runId,targetId:config.targetId,commit:config.commit,baselineId:config.baselineId,needsReset:true,tests:'fail'};
 const r=await recoverCycle(config,record,f.deps);assert.equal(r.state,'recovered_after_interruption');assert.equal(r.needsReset,false);assert.equal(r.productionReady,false);
 await assert.rejects(recoverCycle(config,{...record,targetId:'qa-wrong'},f.deps),/invalid_recovery/);
 const g=fixture();g.deps.waitForBaseline=async()=>({...g.probe,clean:false});await assert.rejects(recoverCycle(config,record,g.deps),/reset_verification/);
});
test('config and credential parsing fail closed without exposing host credentials',()=>{
 assert.throws(()=>validateCycleConfig({...config,dedicatedTestServer:false}));assert.throws(()=>validateCycleConfig({...config,sshTarget:'-oProxyCommand=evil'}));assert.throws(()=>validateCycleConfig({...config,resetHook:'./untrusted'}));
 assert.deepEqual(parseQaEnvironment('DEVONE_AGENT_TOKEN='+'a'.repeat(64)+'\nDEVONE_DB_PATH=/var/lib/devone/devone.sqlite\nDEVONE_AGENT_PORT=8790'),{token:'a'.repeat(64)});
 assert.throws(()=>parseQaEnvironment('DEVONE_AGENT_TOKEN=wrong\nDEVONE_DB_PATH=/tmp/not-the-control-db'));
});
test('real closeout requirements cannot be satisfied by the currently wired profile',async()=>{
 const {readFile}=await import('node:fs/promises');const manifest=JSON.parse(await readFile(new URL('../qa/acceptance-requirements.json',import.meta.url),'utf8'));
 const existing=['foundation.api.health','foundation.agent.authentication','management.software-inventory','management.isolated-packages','hosting.static','hosting.files','hosting.php','hosting.node','hosting.python','hosting.container'];
 const result=assessLivePhases(manifest.requirements,existing.map(id=>({id,status:'pass'})),true);assert.equal(result.length,4);assert.ok(result.every(p=>p.status==='blocked'));
});
test('baseline mismatch resets only after the target identity is established',async()=>{
 const f=fixture();f.deps.probe=async()=>({...f.probe,clean:false});const r=await runCycle(config,f.deps);assert.equal(r.error,'target_baseline_mismatch');assert.equal(r.reset,'verified');assert.ok(!f.events.includes('test'));
});
test('an evidence write failure cannot certify phase completion',async()=>{
 const f=fixture();let count=0;const save=f.deps.save;f.deps.save=async r=>{if(++count===3)throw Error('disk error');await save(r);};const r=await runCycle(config,f.deps);assert.equal(r.state,'evidence_failed');assert.equal(r.reset,'verified');assert.ok(r.phaseResults.every(p=>p.status!=='pass'));
});

test('a failed host profile cannot certify phases even if its returned subset passes',async()=>{
 const f=fixture();const run=f.deps.test;f.deps.test=async()=>({...await run(),profileSucceeded:false});const r=await runCycle(config,f.deps);assert.equal(r.tests,'fail');assert.equal(r.reset,'verified');assert.ok(r.phaseResults.every(p=>p.status!=='pass'));
});
