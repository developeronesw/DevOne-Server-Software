import { test } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { createServer } from 'node:net';
async function freePort() { const s = createServer(); s.listen(0, '127.0.0.1'); await once(s, 'listening'); const p = s.address().port; await new Promise(r => s.close(r)); return p; }
async function ready(url, child) { for (let i = 0; i < 100; i++) { if (child.exitCode !== null) throw new Error('Service exited'); try { await fetch(url); return; } catch {} await new Promise(r => setTimeout(r, 50)); } throw new Error('Service startup timeout'); }
test('authentication, setup, origin, metrics, logout and rate-limit boundaries', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'devone-test-'));
  const port = await freePort(), agentPort = await freePort();
  const url = `http://127.0.0.1:${port}`, agentUrl = `http://127.0.0.1:${agentPort}`;
  const env = { ...process.env, PORT: String(port), DEVONE_AGENT_PORT: String(agentPort), DEVONE_AGENT_URL: agentUrl, DEVONE_AGENT_TOKEN: 'test-agent-token', DEVONE_SETUP_TOKEN: 'test-setup-token', DEVONE_PANEL_URL: 'https://panel.example.test', DEVONE_DB_PATH: join(dir, 'state.sqlite') };
  const children = ['agent/dist/index.js', 'apps/api/dist/index.js'].map(p => spawn(process.execPath, [p], { env, stdio: 'ignore' }));
  const post = (path, body, headers = {}) => fetch(url + path, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });
  try {
    await ready(url + '/api/health', children[1]); await ready(agentUrl + '/v1/health', children[0]);
    assert.equal((await fetch(agentUrl + '/v1/metrics')).status, 401);
    assert.equal((await fetch(agentUrl + '/v1/services/action', {method:'POST',headers:{Authorization:'Bearer test-agent-token','Content-Type':'application/json'},body:JSON.stringify({service:'ssh',action:'stop'})})).status, 400);
    assert.equal((await fetch(url + '/api/system/status')).status, 401);
    assert.equal((await fetch(url + '/api/services')).status, 401);
    assert.equal((await post('/api/services/action', {})).status, 401);
    const credentials = { email: 'owner@example.test', password: 'a-long-test-password' };
    assert.equal((await post('/api/auth/setup', credentials)).status, 403);
    assert.equal((await post('/api/auth/setup', credentials, { 'X-DevOne-Setup-Token': 'test-setup-token' })).status, 200);
    assert.equal((await post('/api/auth/setup', credentials, { 'X-DevOne-Setup-Token': 'test-setup-token' })).status, 409);
    assert.equal((await post('/api/auth/login', credentials, { Origin: 'https://evil.example.test' })).status, 403);
    const login = await post('/api/auth/login', credentials, { Origin: 'https://panel.example.test' });
    assert.equal(login.status, 200);
    const setCookie = login.headers.get('set-cookie');
    assert.match(setCookie, /HttpOnly/); assert.match(setCookie, /Secure/);
    const cookie = setCookie.split(';')[0];
    const status = await fetch(url + '/api/system/status', { headers: { Cookie: cookie } });
    assert.equal(status.status, 200); const body = await status.json();
    assert.equal(body.agent.ok, true); assert.equal(body.metrics.ok, true); assert.ok(body.metrics.memoryTotal > 0);
    assert.equal((await fetch(url + '/api/me', { headers: { Cookie: 'devone_session=%malformed' } })).status, 401);
    const db = new DatabaseSync(join(dir, 'state.sqlite'));
    db.prepare("UPDATE users SET role='viewer'").run();
    assert.equal((await post('/api/services/action', {service:'nginx',action:'restart',confirmed:true}, {Cookie:cookie,Origin:'https://panel.example.test'})).status, 403);
    db.prepare("UPDATE users SET role='owner'").run(); db.close();
    assert.equal((await post('/api/services/action', {service:'ssh',action:'stop',confirmed:true}, {Cookie:cookie,Origin:'https://panel.example.test'})).status, 400);
    assert.equal((await post('/api/services/action', {service:'nginx',action:'restart',confirmed:true}, {Cookie:cookie,Origin:'https://evil.example.test'})).status, 403);
    assert.equal((await post('/api/auth/logout', {}, { Cookie: cookie })).status, 200);
    assert.equal((await fetch(url + '/api/me', { headers: { Cookie: cookie } })).status, 401);
    let rate; for (let i = 0; i < 11; i++) rate = await post('/api/auth/login', { email: 123, password: [] });
    assert.equal(rate.status, 429);
  } finally { for (const c of children) { const ended = once(c, 'exit'); if (c.exitCode === null) { c.kill(); await ended; } } await rm(dir, { recursive: true, force: true }); }
});
