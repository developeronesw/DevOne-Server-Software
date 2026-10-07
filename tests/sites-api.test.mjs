import test from 'node:test';
import assert from 'node:assert/strict';
import Fastify from '../apps/api/node_modules/fastify/fastify.js';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { registerSiteRoutes } from '../apps/api/dist/sites.js';
test('site API enforces roles, origins, confirmations and forwards only permitted authority',async()=>{
  let conflict=false; const received=[]; const agent=createServer(async(req,res)=>{let body='';for await(const chunk of req) body+=chunk;received.push({url:req.url,body:body ? JSON.parse(body) : null,auth:req.headers.authorization});res.setHeader('Content-Type','application/json');if(conflict){res.statusCode=409;res.end(JSON.stringify({error:'file_conflict'}));}else res.end(JSON.stringify(req.method==='GET' ? {sites:[]} : []));});
  agent.listen(0,'127.0.0.1');await once(agent,'listening');
  const app=Fastify();const queued=[],audits=[];
  registerSiteRoutes(app,{requestUser:req=>req.headers['x-role'] ? {id:'owner',role:req.headers['x-role']} : null,sameOrigin:req=>req.headers.origin==='https://panel.example.com',agentUrl:`http://127.0.0.1:${agent.address().port}`,agentToken:'fixture-token',jobs:{enqueue(...args){queued.push(args);return {id:'job'};}},audit(...args){audits.push(args);}});
  const headers={'x-role':'owner',origin:'https://panel.example.com'};
  try {
    assert.equal((await app.inject({url:'/api/sites'})).statusCode,401);
    assert.equal((await app.inject({url:'/api/sites',headers:{'x-role':'viewer'}})).statusCode,403);
    assert.equal((await app.inject({url:'/api/sites',headers})).statusCode,200);
    const payload={domain:'new.example.com',webServer:'none',confirmed:true,requestKey:'abcdefghijklmnop'};
    assert.equal((await app.inject({method:'POST',url:'/api/sites',headers:{'x-role':'owner'},payload})).statusCode,403);
    assert.equal((await app.inject({method:'POST',url:'/api/sites',headers,payload:{...payload,domain:'bad;id.com'}})).statusCode,400);
    assert.equal((await app.inject({method:'POST',url:'/api/sites',headers,payload})).statusCode,202);
    assert.equal(queued[0][3],'site.create');
    const file={siteId:'site_0123456789abcdef',operation:'create',path:'index.html',content:'aGVsbG8=',root:'/etc',uid:0};
    assert.equal((await app.inject({method:'POST',url:'/api/sites/files',headers,payload:file})).statusCode,400);
    assert.equal((await app.inject({method:'POST',url:'/api/sites/files',headers,payload:{...file,confirmed:true}})).statusCode,200);
    const forwarded=received.at(-1);assert.equal(forwarded.auth,'Bearer fixture-token');assert.equal(forwarded.body.root,undefined);assert.equal(forwarded.body.uid,undefined);
    assert.equal(audits.length,2);assert.ok(!JSON.stringify(audits).includes(file.content));
    const edit={...file,operation:'replace',confirmed:true,expectedRevision:'a'.repeat(64)};
    assert.equal((await app.inject({method:'POST',url:'/api/sites/files',headers,payload:{...edit,expectedRevision:'bad'}})).statusCode,400);
    assert.equal((await app.inject({method:'POST',url:'/api/sites/files',headers,payload:edit})).statusCode,200);
    assert.equal(received.at(-1).body.expectedRevision,edit.expectedRevision);
    conflict=true;
    const failed=await app.inject({method:'POST',url:'/api/sites/files',headers,payload:edit});assert.equal(failed.statusCode,409);assert.equal(failed.json().error,'file_conflict');
    conflict=false;
    assert.equal((await app.inject({method:'POST',url:'/api/sites/files',headers,payload:{...edit,operation:'rename',destination:'new.txt'}})).statusCode,200);
    assert.equal(received.at(-1).body.destination,'new.txt');assert.ok(!JSON.stringify(audits).includes(file.content));

    assert.equal((await app.inject({method:'POST',url:'/api/sites/files',headers:{...headers,'x-role':'viewer'},payload:{...file,confirmed:true}})).statusCode,403);
  } finally {await app.close();await new Promise(resolve=>agent.close(resolve));}
});
