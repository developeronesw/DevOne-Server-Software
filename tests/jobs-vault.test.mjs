import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { randomBytes } from 'node:crypto';
import { mkdtemp, writeFile, chmod, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { JobQueue, OutcomeUnknown } from '../apps/api/dist/jobs.js';
import { Vault, seal, open, readMasterKey } from '../apps/api/dist/vault.js';
function database(path = ':memory:') {
  const db = new DatabaseSync(path);
  db.exec("CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY,role TEXT); INSERT OR IGNORE INTO users VALUES('owner','owner');");
  return db;
}
test('jobs serialize, deduplicate requests, preserve history and do not replay uncertain mutations', async () => {
  const db = database(); const events = []; let active = 0, max = 0, calls = 0;
  const q = new JobQueue(db, async input => {
    calls++; max = Math.max(max, ++active);
    await new Promise(r => setTimeout(r, 10)); active--;
    if (input.action === 'stop') throw new OutcomeUnknown('timeout');
  }, (...args) => events.push(args));
  const first = q.enqueue('owner', 'request_first_123456', {service:'nginx',action:'start'});
  assert.equal(q.enqueue('owner', 'request_first_123456', {service:'nginx',action:'start'}).id, first.id);
  assert.throws(() => q.enqueue('owner', 'request_first_123456', {service:'nginx',action:'stop'}), /request_key_conflict/);
  const second = q.enqueue('owner', 'request_second_12345', {service:'nginx',action:'stop'});
  await q.idle(); assert.equal(calls, 2); assert.equal(max, 1);
  assert.equal(q.get(first.id).state, 'succeeded'); assert.equal(q.get(second.id).state, 'interrupted');
  assert.ok(events.some(e => e[1] === 'job.succeeded')); assert.ok(events.some(e => e[1] === 'job.interrupted'));
  await q.stop(); assert.throws(() => q.enqueue('owner','request_stopped_123',{service:'nginx',action:'start'}), /queue_stopping/); db.close();
});
test('restart persists queued work but running jobs are interrupted, and revoked roles block execution', async () => {
  const dir = await mkdtemp(join(tmpdir(),'devone-jobs-')); const path = join(dir,'jobs.sqlite');
  let db = database(path); const q = new JobQueue(db, async () => {}, () => {}); await q.stop();
  const insert = db.prepare("INSERT INTO jobs(id,requested_by,request_key,operation,input,state,created_at) VALUES(?,?,?,?,?,?,?)");
  insert.run('lost','owner','persist_running_123','service.action','{"service":"nginx","action":"start"}','running',new Date().toISOString());
  insert.run('waiting','owner','persist_queued_1234','service.action','{"service":"nginx","action":"stop"}','queued',new Date().toISOString());
  db.close(); db = database(path); let calls = 0;
  const next = new JobQueue(db, async () => {calls++;}, () => {});
  assert.equal(next.get('lost').state, 'interrupted');
  db.exec("UPDATE users SET role='viewer' WHERE id='owner'"); next.start(); await next.idle();
  assert.equal(calls,0); assert.equal(next.get('waiting').state,'failed'); assert.equal(next.get('waiting').error,'authorization_revoked');
  await next.stop(); db.close(); await rm(dir,{recursive:true,force:true});
});
test('vault authenticates ciphertext and name, stores no plaintext and requires a protected key', async () => {
  const dir = await mkdtemp(join(tmpdir(),'devone-vault-')); const keyFile = join(dir,'secrets.key');
  const key = randomBytes(32); await writeFile(keyFile,key,{mode:0o600}); const db = database();
  try {
    const value = 'provider-token-test-12345'; const encrypted = seal(key,'gemini.api_key',value);
    assert.equal(open(key,'gemini.api_key',encrypted),value);
    assert.throws(() => open(key,'cloudflare.api_token',encrypted));
    assert.throws(() => open(randomBytes(32),'gemini.api_key',encrypted));
    const damaged = JSON.parse(encrypted); damaged.tag = randomBytes(16).toString('base64');
    assert.throws(() => open(key,'gemini.api_key',JSON.stringify(damaged)));
    const vault = new Vault(db,keyFile); vault.put('gemini.api_key',value,'owner');
    assert.equal(vault.get('gemini.api_key'),value);
    assert.ok(!JSON.stringify(db.prepare('SELECT * FROM secrets').all()).includes(value));
    assert.deepEqual(Object.keys(vault.list()[0]).sort(),['name','updated_at']);
    await chmod(keyFile,0o644); assert.throws(() => readMasterKey(keyFile), /permissions/);
    assert.throws(() => vault.put('gemini.api_key','new-value','owner')); await chmod(keyFile,0o600);
    assert.equal(vault.get('gemini.api_key'),value);
    assert.throws(() => vault.put('../key',value,'owner')); assert.throws(() => vault.put('key','x'.repeat(8193),'owner'));
    assert.equal(vault.remove('gemini.api_key'),true); assert.equal(vault.get('gemini.api_key'),undefined);
  } finally { db.close(); await rm(dir,{recursive:true,force:true}); }
});
test('a failed audit rolls back submission before a host action can run', async () => {
  const db=database();let calls=0;
  const q=new JobQueue(db,async()=>{calls++;},()=>{throw new Error('audit unavailable');});
  assert.throws(()=>q.enqueue('owner','audit_failure_key_123',{service:'nginx',action:'start'}));
  assert.equal(q.list().length,0);assert.equal(calls,0);await q.stop();db.close();
});
test('website jobs retain operation identity and deduplicate without cross-operation reuse',async()=>{
  const db=database(), executed=[];
  const queue=new JobQueue(db,async(input,operation)=>{executed.push({input,operation});},()=>{});
  try {
    const input={domain:'static.example.com',webServer:'none'};
    const job=queue.enqueue('owner','site_create_key_12345',input,'site.create');
    assert.equal(queue.enqueue('owner','site_create_key_12345',input,'site.create').id,job.id);
    assert.throws(()=>queue.enqueue('owner','site_create_key_12345',{service:'nginx',action:'start'}),/request_key_conflict/);
    await queue.idle();assert.deepEqual(executed,[{input,operation:'site.create'}]);assert.equal(queue.get(job.id).state,'succeeded');
  } finally {await queue.stop();db.close();}
});
