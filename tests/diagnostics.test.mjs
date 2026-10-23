import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {once} from 'node:events';
import Fastify from '../apps/api/node_modules/fastify/fastify.js';
import {Diagnostics,diagnosticCatalog,redactDiagnosticOutput} from '../agent/dist/diagnostics.js';
import {parseMemory} from '../agent/dist/resources.js';
import {registerDiagnostics} from '../apps/api/dist/diagnostics.js';
test('diagnostic commands are immutable and cannot accept shell, paths or arguments',async()=>{
 const calls=[],d=new Diagnostics(async(binary,args)=>{calls.push({binary,args});return {stdout:'PONG',stderr:''};});
 for(const input of [null,[],{toolId:'redis-ping',args:['--eval','x']},{toolId:'redis-ping',command:'id'},{toolId:'../../etc/passwd'},{toolId:'__proto__'}])await assert.rejects(d.execute(input),/invalid_diagnostic/);
 const result=await d.execute({toolId:'redis-ping'});assert.equal(result.status,'completed');assert.deepEqual(calls,[{binary:'redis-cli',args:['-h','127.0.0.1','-p','6379','PING']}]);
 assert.ok(diagnosticCatalog().every(t=>!('binary' in t)&&!('args' in t)));
});
test('diagnostics mask common credentials, bound output and distinguish failure from success',async()=>{
 const raw='Authorization: Bearer token123\npassword=hunter2\napi_key=abc123\nhttps://user:pass@example.com\n-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----';
 assert.ok(!redactDiagnosticOutput('password="two words"').includes('words'));
 const masked=redactDiagnosticOutput(raw);for(const value of ['token123','hunter2','abc123','user:pass','\nabc\n'])assert.ok(!masked.includes(value));
 const big=new Diagnostics(async()=>({stdout:'x'.repeat(30000),stderr:''}));const result=await big.execute({toolId:'disk-space'});assert.equal(result.output.length,24000);assert.equal(result.truncated,true);
 for(const [error,status,exit] of [[{code:'ENOENT'},'unavailable',null],[{code:2,stderr:'bad configuration'},'failed',2],[{killed:true,code:null},'timed_out',null]]){
  const d=new Diagnostics(async()=>{throw error;});const r=await d.execute({toolId:'nginx-check'});assert.equal(r.status,status);assert.equal(r.exitCode,exit);
 }
});
test('diagnostics bound active processes and recover capacity after failures',async()=>{
 const waiters=[],d=new Diagnostics(()=>new Promise(resolve=>waiters.push(resolve)));
 const first=d.execute({toolId:'disk-space'}),second=d.execute({toolId:'disk-space'});
 await assert.rejects(d.execute({toolId:'disk-space'}),/busy/);
 waiters.splice(0).forEach(resolve=>resolve({stdout:'',stderr:''}));await Promise.all([first,second]);
 const third=d.execute({toolId:'disk-space'});waiters[0]({stdout:'',stderr:''});assert.equal((await third).status,'completed');
});
test('memory uses MemAvailable and validates malformed or inconsistent kernel snapshots',()=>{
 const m=parseMemory('MemTotal: 1000 kB\nMemFree: 10 kB\nMemAvailable: 400 kB\nSwapTotal: 200 kB\nSwapFree: 150 kB\n');
 assert.equal(m.availableBytes,409600);assert.equal(m.usedPercent,60);assert.equal(m.swapUsedBytes,51200);
 assert.equal(parseMemory('MemTotal: 1000 kB'),null);
 assert.equal(parseMemory('MemTotal: 100 kB\nMemAvailable: 200 kB\nSwapTotal: 0 kB\nSwapFree: 0 kB'),null);
});
test('diagnostics API requires Owner, origin and bounded requests; audits exclude output',async()=>{
 const received=[],audits=[];
 const server=createServer(async(req,res)=>{let text='';for await(const chunk of req)text+=chunk;received.push({url:req.url,auth:req.headers.authorization,body:text?JSON.parse(text):null});res.setHeader('Content-Type','application/json');res.end(JSON.stringify(req.method==='GET'?{tools:[]}:{status:'completed',output:'sensitive log'}));});
 server.listen(0,'127.0.0.1');await once(server,'listening');
 const app=Fastify();registerDiagnostics(app,{requestUser:r=>r.headers.role?{id:'u',role:r.headers.role}:null,sameOrigin:r=>r.headers.origin==='https://panel.example.com',agentUrl:'http://127.0.0.1:'+server.address().port,agentToken:'fixture-secret',audit(...a){audits.push(a);}});
 const headers={role:'owner',origin:'https://panel.example.com'},payload={toolId:'disk-space'};
 try{
  assert.equal((await app.inject({url:'/api/diagnostics/tools'})).statusCode,401);
  assert.equal((await app.inject({url:'/api/diagnostics/tools',headers:{role:'admin'}})).statusCode,403);
  assert.equal((await app.inject({method:'POST',url:'/api/diagnostics/run',headers:{role:'owner'},payload})).statusCode,403);
  assert.equal((await app.inject({method:'POST',url:'/api/diagnostics/run',headers,payload:{...payload,args:[]}})).statusCode,400);
  assert.equal((await app.inject({url:'/api/resources',headers})).statusCode,200);
  const r=await app.inject({method:'POST',url:'/api/diagnostics/run',headers,payload});assert.equal(r.statusCode,200);assert.equal(r.headers['cache-control'],'no-store');assert.equal(received.at(-1).auth,'Bearer fixture-secret');assert.deepEqual(received.at(-1).body,payload);assert.ok(!JSON.stringify(audits).includes('sensitive log'));
  for(let i=1;i<20;i++)assert.equal((await app.inject({method:'POST',url:'/api/diagnostics/run',headers,payload})).statusCode,200);
  assert.equal((await app.inject({method:'POST',url:'/api/diagnostics/run',headers,payload})).statusCode,429);
 }finally{await app.close();await new Promise(resolve=>server.close(resolve));}
});
