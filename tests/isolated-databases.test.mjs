import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,copyFile,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
const exec=promisify(execFile);
for(const scenario of ['pass','failed-test','missing-evidence'])test('isolated SQL controller: '+scenario,async()=>{
 const dir=await mkdtemp(join(tmpdir(),'devone-qa-controller-'));
 try{
  for(const p of ['scripts','agent/dist','qa/isolated-databases','bin','distributions/devone-cms-local'])await mkdir(join(dir,p),{recursive:true});
  await copyFile('scripts/qa-isolated-databases.sh',join(dir,'scripts/qa-isolated-databases.sh'));
  for(const p of ['agent/dist/databases.js','qa/isolated-databases/Dockerfile','qa/isolated-databases/integration.mjs','qa/isolated-databases/wordpress-integration.mjs','scripts/wordpress-extract.py','scripts/wordpress-install.php','scripts/cms-extract.py','qa/isolated-databases/cms-integration.mjs','distributions/devone-cms-local/fixture.tar.gz'])await writeFile(join(dir,p),'fixture');
  await writeFile(join(dir,'bin/docker'),`#!/usr/bin/env node
const fs=require('node:fs'),a=process.argv.slice(2);fs.appendFileSync(process.env.QA_LOG,JSON.stringify(a)+'\\n');
if(a[0]==='create'){console.log('fixture-container-id');}
if(a[0]==='start'&&process.env.QA_CASE==='failed-test')process.exit(1);
if(a[0]==='cp'){
 if(process.env.QA_CASE==='missing-evidence')process.exit(1);
 fs.writeFileSync(a[2],JSON.stringify({scope:'isolated-real-sql',productionReady:false,checks:Array.from({length:36},(_,i)=>({id:String(i),status:process.env.QA_CASE==='failed-test'?'fail':'pass'}))}));
}
`,{mode:0o700});
  let failed=false;try{await exec('/bin/bash',['scripts/qa-isolated-databases.sh'],{cwd:dir,env:{...process.env,PATH:join(dir,'bin')+':'+process.env.PATH,QA_LOG:join(dir,'calls'),QA_CASE:scenario},timeout:20000});}catch{failed=true;}
  assert.equal(failed,scenario!=='pass');
  const calls=(await readFile(join(dir,'calls'),'utf8')).trim().split('\n').map(JSON.parse);
  const create=calls.find(a=>a[0]==='create');assert.ok(create.includes('none'));assert.ok(!create.some(a=>a==='--privileged'||a==='-v'||a==='--mount'||a==='-p'));
  assert.deepEqual(calls.find(a=>a[0]==='rm'),['rm','-f','fixture-container-id']);
  assert.equal(calls.filter(a=>a[0]==='image'&&a[1]==='rm').length,1);
  assert.ok(!calls.some(a=>a.includes('prune')));
 }finally{await rm(dir,{recursive:true,force:true});}
});
