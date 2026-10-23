# Live acceptance, external reset and phase closeout

## Current delivery

This adds an executable external QA/reset controller, a narrowly scoped installed-host runner, a 35-requirement phase 1–4 closeout manifest, interruption recovery, sanitized durable evidence and a manually dispatched self-hosted GitHub Actions workflow. It does not provide cloud credentials, create a VPS, implement a provider reset hook, execute a live test from ChatGPT or certify any phase. Unfinished product features cannot be closed by a passing test profile.

The wired profile invokes the existing six-type disposable hosting QA and container-only package tests, plus API health and an unauthenticated Agent rejection check. Real managed MariaDB/PostgreSQL operations, browser journeys, fresh installation, reboot, upgrade/rollback, TLS renewal, application installers, full backups/restores, general containers, DNS/Cloudflare, performance and legacy comparison still require additional profiles and any missing product implementation. `qa/acceptance-requirements.json` records these gaps as missing evidence (BLOCKED). A profile pass is not a phase pass or a stable release.

## Required independent infrastructure

Use one external controller and one fixed configuration per dedicated QA target. The controller must not be the target VM. The controller needs Node.js 22.16+, OpenSSH, a pinned SSH host key, a private SSH identity, a private evidence directory, and provider-authorized reset capability. No suitable VPS-control connection is currently supplied in this ChatGPT session. The external reset hook is an operator-installed, trusted executable, not an arbitrary root command exposed in DevOne's API.

The target must be an expendable Ubuntu 24.04 DevOne installation at the exact candidate commit, with one test Owner, no customer sites/databases and the PHP-FPM/Redis/Docker/Python prerequisites for the current profile. Set up optional SQL engines when their real test profiles are added. Production data must never be copied into this test baseline.

Provision `/etc/devone/qa-target.json` on that target as a root-owned, non-writable-by-others file:

```json
{"targetId":"qa-devone-acceptance","testOnly":true}
```

The installed root-owned `scripts/qa-host-runner.mjs` refuses an unmarked host, another target ID, a changed Git commit, dirty tracked source, unsupported configuration paths or unsafe credential-file permissions. The SSH account needs narrowly scoped passwordless sudo for this installed runner, or an equivalent approved root SSH path. Do not grant unrestricted passwordless sudo to a customer account.

Capture a provider-approved consistent clean configured baseline, including the marker, exact candidate code, application services, SSH identity, database/vault state and Agent registry. A new candidate commit needs a matching baseline. The marker alone does not make a host disposable: the operator must select the correct independent test machine and image.

## Provider reset contract

Install a provider-specific executable outside the repository on the controller, e.g. `/usr/local/lib/devone-qa/reset-approved-test-vps`. Its arguments are:

```
TARGET_ID BASELINE_ID RUN_ID
```

It must map only an approved target to its approved baseline, restore that test VM (or an approved equivalent), wait for provider completion, clean up external QA-owned resources, and return exactly one JSON receipt on stdout:

```json
{"completed":true,"targetId":"qa-devone-acceptance","baselineId":"approved-baseline","runId":"the-supplied-run-uuid","operationId":"actual-provider-operation-id"}
```

The hook must be idempotent for a run ID so interruption recovery does not repeat an unknown destructive operation blindly. Keep credentials in the controller's protected provider authentication, not in Git, arguments, receipts or logs. Hook failure, timeout, wrong receipt or failure to reach the baseline means RESET FAILED, never fresh/clean. There is intentionally no example that deletes an arbitrary server based on a hostname alone. Provider integration must be implemented and tested before executing the cycle.

SSH host identity remains pinned across restore. The supported restore profile also expects the recorded machine ID; replacement-machine re-enrollment needs a separately approved identity update. Do not disable SSH host-key checks to make a rebuilt VM pass.

## Configuration and execution

Copy `qa/host-cycle.example.json` into the controller's protected configuration and replace every placeholder. Use a real QA-only SSH target, machine ID, candidate commit, reset hook and baseline ID. Record the baseline fingerprint by invoking the guest runner's read-only probe on the prepared target:

```bash
sudo /usr/bin/node /opt/devone/current/scripts/qa-host-runner.mjs probe qa-devone-acceptance RUN_UUID CANDIDATE_COMMIT
```

The probe returns no credential values. Its fingerprint covers selected managed-state invariants, code identity and credential/configuration digests. It verifies an empty managed-site/database registry, no generated site homes/users/vhosts/runtime units/PHP pools, one Owner and healthy API/Agent; configuration, credential and user records contribute digests. This is not a byte-for-byte filesystem comparison, SQL-object inventory, TLS test or proof that a dishonest reset hook restored a provider image. Reset assurance depends on the trusted provider operation receipt plus the post-reset probe. Existing cleanup alone does not prove image restoration.

On the independent controller:

```bash
node scripts/qa-host-cycle.mjs --plan /etc/devone-qa/target.json
node scripts/qa-host-cycle.mjs --execute /etc/devone-qa/target.json qa-devone-acceptance
```

Plan mode only validates/describes configuration; it does not connect or mutate. Execute requires the exact QA target ID. The controller verifies target identity before arming any reset, records a durable run journal before tests, runs the profile, invokes the external reset after test success/failure/timeout, and verifies the restored managed-state baseline. A target-identity mismatch prevents both testing and reset. A local target lock prevents overlapping runs using the same configuration/evidence directory; do not operate a second independent controller against the same target.

Evidence lives outside the VM in the private `outputDir`, named `RUN_UUID.json`. Interrupted runs retain `needsReset: true` and the target lock. Recover explicitly using the same configuration and journal:

```bash
node scripts/qa-host-cycle.mjs --recover /etc/devone-qa/target.json qa-devone-acceptance /var/lib/devone-qa/reports/RUN_UUID.json
```

Recovery does not rerun tests, erase the earlier failure or certify a phase. It retries the idempotent external reset and validates the baseline. The GitHub workflow runs recovery in an `always()` step and uploads sanitized evidence. Run it only by manual dispatch on a trusted runner labeled `devone-qa-controller`, never on public pull requests. The workflow runs only from main and requires its commit to match the configured baseline candidate. Set repository variables `DEVONE_QA_CONFIG` and `DEVONE_QA_REPORT_DIR` to the controller's existing private paths. The provider reset itself can stop/restart the target; it must not reset the controller.

A controller/runner/provider outage can prevent its finally/recovery code from running. An independent provider watchdog or operator recovery is still required for that failure mode. No script running on one machine can guarantee cleanup after loss of every controlling system. Never interpret a missing journal/artifact or unknown reset outcome as success.

## Closeout rule

Each requirement must have an implemented workflow and passing real-host evidence for the same candidate/environment. Missing, duplicate, invalid, failed or BLOCKED checks do not count. A reset failure or evidence write failure blocks phase acceptance. Reports always retain `productionReady: false`: Phase 5, full release checks and verified legacy parity remain separate requirements. The existing `pnpm qa:release` gate remains blocked; this increment does not rewrite existing pending items or manufacture legacy evidence.

Automated controller tests exercise pass/fail/reset order, timeouts/transport errors, wrong identities, self-target refusal, wrong receipts, restored-baseline mismatches, recovery, missing coverage and evidence persistence failure. Those injected tests validate controller behavior; they are not an executed VPS reset.
