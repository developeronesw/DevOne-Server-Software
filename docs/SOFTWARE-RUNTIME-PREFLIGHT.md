# Managed host software installation — Phase 2

DevOne Software Center now provides actual, Owner-approved Ubuntu package installation for **PHP 8.3-FPM** and **Redis Server** on the dedicated Ubuntu 24.04 development VPS. Click Install after entering your Owner password and an MFA code when enabled. This runs the allowlisted, root-owned Agent operation as an audited persistent job and shows queued/running/succeeded/failed or interrupted state. The UI reads live dpkg and systemd package states; Services can start/stop/restart either component.

## Operation sequence

- API POST /api/software/install requires owner session, same Origin, explicit confirmation, a fresh password and optional MFA, and a unique request key. A rate limit applies.
- Existing JobQueue persists the software.install action and rechecks Owner role when executing. API submits exact package name and confirmation to localhost Agent.
- Agent executes the existing `scripts/software-runtime-pilot.sh --managed-install` with a fixed package allowlist, signed-Ubuntu-origin candidate checks, apt simulation, protected-service checks, package installation and service verification. No arbitrary command or user-provided paths are accepted.
- GET /api/software/status reports dpkg version and systemd state. Job outcome interrupted/unknown is not automatically retried; inspect the actual host first.

## Update & immediate development VPS QA

1. In the panel Owner **Software Updates**, check both required CI jobs for the exact merged commit before updating. Sign in again when services restart.
2. In **Software Center**, choose **PHP 8.3 FPM**, enter your password/MFA if enabled, approve and click **Install**. Confirm the job succeeds and the package shows Installed/Running. Repeat for **Redis Server** on this disposable development VPS.
3. Under **Services**, verify both named systemd services can be started/stopped/restarted after installation; never stop the DevOne API, Agent or SSH.
4. Run **QA Center → Run live checks** and review all nine results, including Agent Software and CrowdSec telemetry. QA is read-only and does not reinstall packages.
5. If installation fails or is interrupted, inspect **Activity & Jobs** and package status before any retry; APT may have partially installed dependencies.

## Scope boundaries

Application catalog entries including DevOne CMS, WordPress, Next.js, and Ghost still require individual deployment adapters and are not installable from the catalog. Installed PHP/Redis do not automatically create a website or database. This first working package management path does not yet implement package **removal**, automatic dependency **rollback**, multi-version PHP, real WAF blocking, or production release parity. Run it only on a disposable development VPS and retain recoverable snapshot backups before attempting host mutations.

A green `pnpm qa` means CI/regressions passed; production release acceptance must still separately pass `pnpm qa:release` after live-host, restore and legacy parity verification.
