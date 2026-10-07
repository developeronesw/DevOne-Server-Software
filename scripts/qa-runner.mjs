import { spawn } from 'node:child_process';
import { mkdir, writeFile, rename, readdir } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export function runCheck(id, command, args, { timeoutMs = 180000, cwd = root } = {}) {
  const started = performance.now();
  return new Promise(resolveResult => {
    let child, timedOut = false, settled = false;
    const finish = (code, signal, error) => {
      if (settled) return;
      settled = true; clearTimeout(timer);
      resolveResult({ id, status: !timedOut && !error && code === 0 ? 'pass' : 'fail', durationMs: Math.round(performance.now() - started), exitCode: code, signal, reason: timedOut ? 'timeout' : error ? 'could_not_start' : code === 0 ? null : 'nonzero_exit' });
    };
    // A separate process group lets timeouts terminate fixture servers too.
    const timer = setTimeout(() => {
      timedOut = true;
      try { process.kill(-child.pid, 'SIGKILL'); } catch { child?.kill('SIGKILL'); }
    }, timeoutMs);
    try {
      child = spawn(command, args, { cwd, detached: true, stdio: ['ignore', 'inherit', 'inherit'] });
      child.once('error', error => finish(null, null, error));
      child.once('close', (code, signal) => finish(code, signal));
    } catch (error) { finish(null, null, error); }
  });
}
export function assess(results, pending) {
  return { automatedChecks: results.every(result => result.status === 'pass') ? 'pass' : 'fail', productionReady: results.every(result => result.status === 'pass') && pending.length === 0 };
}
const pending = [
  { id: 'website-provisioning', status: 'not_implemented', detail: 'Isolated accounts, trusted registry, NGINX provisioning and API/dashboard integration.' },
  { id: 'browser-workflows', status: 'not_verified', detail: 'Rendered dashboard navigation, forms and accessibility in a browser.' },
  { id: 'ubuntu-install-recovery', status: 'not_verified', detail: 'Fresh VPS install, TLS, systemd hardening, reboot recovery and upgrade/rollback.' },
  { id: 'backup-restore', status: 'not_verified', detail: 'Restore database and encryption key together on a disposable VPS.' },
  { id: 'host-isolation', status: 'not_verified', detail: 'Real site UID/GID isolation and service mutation on a disposable VPS.' },
  { id: 'performance-load', status: 'not_verified', detail: 'Latency, concurrency and memory measurements on target VPS hardware.' },
  { id: 'remaining-legacy-modules', status: 'not_implemented', detail: 'Database hosting, containers, DNS, TLS, runtime management and remaining legacy modules.' }
];
export async function main(args = process.argv.slice(2)) {
  if (args.some(arg => arg !== '--release')) throw new Error('Usage: pnpm qa [--release]');
  const results = [];
  async function check(id, command, commandArgs) {
    console.log(`\nQA: ${id}`);
    const result = await runCheck(id, command, commandArgs); results.push(result);
    console.log(`QA ${result.status.toUpperCase()}: ${id} (${result.durationMs}ms)`);
    return result.status === 'pass';
  }
  await check('type-check', 'pnpm', ['check']);
  const built = await check('production-build', 'pnpm', ['build']);
  const suites = (await readdir(resolve(root, 'tests'))).filter(file => file.endsWith('.test.mjs')).sort();
  if (!suites.length) results.push({ id: 'test-discovery', status: 'fail', reason: 'no_tests_found' });
  for (const file of suites) {
    const id = `regression:${file}`;
    if (built) await check(id, process.execPath, ['--test', `tests/${file}`]);
    else results.push({ id, status: 'blocked', reason: 'build_failed' });
  }
  await check('lint', 'pnpm', ['lint']);
  await check('legacy-distribution-integrity', 'python3', ['scripts/verify-distribution.py']);
  for (const file of ['installer/install.sh','installer/install-legacy.sh','scripts/provision-vault-key.sh']) await check(`shell-syntax:${file}`, 'bash', ['-n', file]);
  const report = { schemaVersion: 1, runId: randomUUID(), completedAt: new Date().toISOString(), scope: 'isolated-development-regression', ...assess(results, pending), results, pending };
  const output = resolve(root, 'qa-reports'); await mkdir(output, { recursive: true, mode: 0o700 });
  const name = `${report.completedAt.replace(/[:.]/g, '-')}-${report.runId}`;
  await writeFile(resolve(output, `${name}.json`), JSON.stringify(report, null, 2), { mode: 0o600 });
  const temporary = resolve(output, `.latest-${report.runId}.tmp`);
  await writeFile(temporary, JSON.stringify(report, null, 2), { mode: 0o600 });
  await rename(temporary, resolve(output, 'latest.json'));
  console.log(`\nAutomated checks: ${report.automatedChecks.toUpperCase()}. Production readiness: ${report.productionReady ? 'PASS' : 'BLOCKED'}.\nReport: qa-reports/${name}.json`);
  process.exitCode = report.automatedChecks !== 'pass' || (args.includes('--release') && !report.productionReady) ? 1 : 0;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(() => { console.error('QA runner failed; no passing result was issued.'); process.exitCode = 1; });
