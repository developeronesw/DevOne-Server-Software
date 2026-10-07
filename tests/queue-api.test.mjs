import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { DatabaseSync } from 'node:sqlite';
import { mkdtemp,writeFile,rm } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
const delay = ms => new Promise(r => setTimeout(r,ms));
async function freePort() { const s=createServer(); s.listen(0,'127.0.0.1'); await once(s,'listening'); const p=s.address().port; await new Promise(r=>s.close(r));return p; }
test('API queues host actions once, keeps secrets private, enforces roles and preserves state across restart', async () => {
  const dir=await mkdtemp(join(tmpdir(),'devone-api-')); const keyFile=join(dir,'key');await writeFile(keyFile,randomBytes(32),{mode:0o600});
  let calls=0; const mock=createServer(async(req,res)=>{
    if(req.headers.authorization!=='Bearer agent-test'){res.writeHead(401).end();return;}
    if(req.url==='/v1/services/action'){calls++;await delay(50);res.writeHead(200,{'Content-Type':'application/json'}).end('{"ok":true}');return;}
    res.writeHead(200,{'Content-Type':'application/json'}).end(req.url==='/v1/services'?'[]':'{"ok":true}');
  }); mock.listen(0,'127.0.0.1');await once(mock,'listening');const port=await freePort();const url=`http://127.0.0.1:${port}`;
  const env={...process.env,PORT:String(port),DEVONE_DB_PATH:join(dir,'state.sqlite'),DEVONE_MASTER_KEY_FILE:keyFile,DEVONE_PANEL_URL:'https://panel.example.test',DEVONE_SETUP_TOKEN:'setup-test',DEVONE_AGENT_TOKEN:'agent-test',DEVONE_AGENT_URL:`http://127.0.0.1:${mock.address().port}`};
  let child; const start=async()=>{child=spawn(process.execPath,['apps/api/dist/index.js'],{env,stdio:'ignore'});for(let i=0;i<100;i++){try{await fetch(url+'/api/health');return;}catch{}await delay(30);}throw new Error('Startup timeout');};
  const stop=async()=>{if(child?.exitCode===null){const exited=once(child,'exit');child.kill();await exited;}};
  let cookie=''; const req=(path,method='GET',body,extra={})=>fetch(url+path,{method,headers:{Cookie:cookie,Origin:'https://panel.example.test',...(body === undefined ? {} : {'Content-Type':'application/json'}),...extra},body:body===undefined?undefined:JSON.stringify(body)});
  try {
    await start();assert.equal((await req('/api/jobs')).status,401);assert.equal((await req('/api/secrets')).status,401);
    const credentials={email:'owner@example.test',password:'test-password-long-123'};
    assert.equal((await req('/api/auth/setup','POST',credentials,{'X-DevOne-Setup-Token':'setup-test'})).status,200);
    const login=await req('/api/auth/login','POST',credentials);cookie=login.headers.get('set-cookie').split(';')[0];
    assert.equal((await req('/api/secrets/gemini.api_key','PUT',{value:'vault-private-value'})).status,200);
    const listed=await(await req('/api/secrets')).json();assert.deepEqual(Object.keys(listed.secrets[0]).sort(),['name','updated_at']);assert.ok(!JSON.stringify(listed).includes('vault-private-value'));
    assert.equal((await req('/api/secrets/gemini.api_key')).status,404);
    assert.equal((await req('/api/secrets/x','PUT',{value:'not-saved'},{Origin:'https://evil.test'})).status,403);
    const action={service:'nginx',action:'restart',confirmed:true,requestKey:'queue_api_request_12345'};
    const r=await req('/api/services/action','POST',action);assert.equal(r.status,202);const job=(await r.json()).job;
    assert.equal((await(await req('/api/services/action','POST',action)).json()).job.id,job.id);
    assert.equal((await req('/api/services/action','POST',{...action,action:'stop'})).status,409);
    for(let i=0;i<50;i++){if((await(await req('/api/jobs/'+job.id)).json()).job.state==='succeeded')break;await delay(20);}
    assert.equal((await(await req('/api/jobs/'+job.id)).json()).job.state,'succeeded');assert.equal(calls,1);
    const db=new DatabaseSync(env.DEVONE_DB_PATH);assert.ok(!JSON.stringify(db.prepare('SELECT * FROM secrets').all()).includes('vault-private-value'));
    assert.ok(!JSON.stringify(db.prepare('SELECT * FROM audit_log').all()).includes('vault-private-value'));
    db.exec("UPDATE users SET role='viewer'");assert.equal((await req('/api/secrets')).status,403);assert.equal((await req('/api/services/action','POST',action)).status,403);
    db.exec("UPDATE users SET role='owner'");db.close();
    await stop();await start();assert.equal((await(await req('/api/jobs/'+job.id)).json()).job.state,'succeeded');assert.equal(calls,1);
    assert.equal((await(await req('/api/secrets')).json()).secrets[0].name,'gemini.api_key');
    assert.equal((await req('/api/secrets/gemini.api_key','DELETE')).status,200);assert.deepEqual((await(await req('/api/secrets')).json()).secrets,[]);
  } finally {await stop();await new Promise(r=>mock.close(r));await rm(dir,{recursive:true,force:true});}
});
