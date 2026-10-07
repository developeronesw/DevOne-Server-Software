import test from 'node:test';
import assert from 'node:assert/strict';
import { runCheck, assess } from '../scripts/qa-runner.mjs';
test('QA distinguishes passing checks from release readiness', () => {
  assert.deepEqual(assess([{status:'pass'}], ['pending']), {automatedChecks:'pass',productionReady:false});
  assert.equal(assess([{status:'fail'}], []).productionReady, false);
  assert.equal(assess([{status:'blocked'}], []).automatedChecks, 'fail');
  assert.equal(assess([{status:'pass'}], []).productionReady, true);
});
test('QA reports failures, missing commands and timeouts', async () => {
  assert.equal((await runCheck('ok', process.execPath, ['-e','process.exit(0)'])).status, 'pass');
  assert.equal((await runCheck('bad', process.execPath, ['-e','process.exit(2)'])).exitCode, 2);
  assert.equal((await runCheck('missing', '/nonexistent/devone-qa-command', [])).reason, 'could_not_start');
  assert.equal((await runCheck('hang', process.execPath, ['-e','setInterval(()=>{},1000)'], {timeoutMs:100})).reason, 'timeout');
});
