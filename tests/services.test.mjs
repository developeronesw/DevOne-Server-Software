import { test } from 'node:test';
import assert from 'node:assert/strict';
import { serviceOperation } from '../agent/dist/services.js';
test('service policy permits explicit managed operations and rejects arbitrary commands', () => {
  assert.deepEqual(serviceOperation({ service: 'nginx', action: 'restart' }), { service: 'nginx', action: 'restart' });
  for (const body of [null, {}, { service: 'ssh', action: 'stop' }, { service: 'nginx;touch /tmp/x', action: 'start' }, { service: 'nginx', action: 'enable' }]) assert.throws(() => serviceOperation(body));
});
