# Browser-based DevOne Software Updates

## Owner experience

After initial DevOne installation, the dashboard contains **Software Updates** in the Owner sidebar and a Check for Updates shortcut. Users can see the installed Git commit SHA, the current official main branch SHA, check results from GitHub Actions, and update eligibility. The only eligible target is the current HEAD of developeronesw/DevOne-Server-Software main with both GitHub Actions jobs called validate and installer completed successfully. The user explicitly approves the installation and re-enters the current Owner password.

An update is never auto-installed without user authorization. Each request rechecks the HEAD and CI status. Users cannot submit arbitrary repository URLs, shell arguments, unsupported branches, unverified commits or commands. Admin/operator/viewer accounts cannot trigger updates.

## Why the background worker exists

DevOne API runs as unprivileged devone, while updates modify the root-owned checkout and restart the DevOne API and Agent. The authenticated Agent launches one fixed root-owned systemd update worker that runs separately from those services. It calls the existing in-place updater, which creates root-only backups, checks runtime file access, rebuilds API/Agent/dashboard, and performs service health checks. A failure triggers the updater's rollback of application files; the database is not automatically replaced. A failed update can require manual inspection.

The root Agent reads the installed commit from the fixed /opt/devone/current checkout, checks GitHub via a fixed HTTPS API URL (no client-provided URL), and refuses to launch if both mandatory checks are not passed. The update target is SHA-pinned. Github API connectivity and rate limits can temporarily prevent checks or installation; failure is not treated as approval.

The worker writes sanitized state (queued/running/succeeded/failed, target SHA, update timestamp) into the root-owned /var/lib/devone-agent/update-status.json. Browser status polling and reconnection work across API/Agent restarts. Detailed command logs are root-only in /var/log/devone/update-worker.log and are never returned to the browser.

## One-time bootstrap for existing installations

An existing DevOne instance cannot safely self-upgrade into this feature until it has the new root-owned worker installed. Use the previously tested SSH in-place updater **once** to install the first release containing the Updates feature. All later supported GitHub main updates can be installed from the Owner dashboard.

New DevOne installations install the root-owned worker as part of the installer. In-place updates install new worker versions via atomic rename; on rollback the previous worker is restored. The worker has no public listener, no login UI, no arbitrary shell command endpoint, and no arbitrary ref/branch selector.

## Operational cautions

- Do not interrupt updates, shut down the VPS or modify source files during an upgrade. Expect brief panel downtime.
- GitHub CI success alone does not guarantee full production readiness or all legacy features. Release gating, database migration compatibility, and live VPS acceptance require continued QA.
- Backups should also be replicated off the VPS; the updater's automatic backup is stored locally.
- If a worker remains stuck in queued/running after an OS crash, do not blindly re-run. Inspect the systemd worker unit and root-only log, reconcile the live commit and services, then perform a supervised recovery.
- The API's 401 on /api/qa and the Agent/DevOne service health checks remain update acceptance gates.

## Security test expectations

CI verifies Owner-only API authorization, same-Origin mutation policy, password recheck, throttling, strict SHA validation, fixed GitHub host and main ref, exact CI gate names, pinned release targets, and worker lifecycle safety. These tests simulate the launch; full interrupted-update acceptance must be performed on a disposable Ubuntu VPS.
