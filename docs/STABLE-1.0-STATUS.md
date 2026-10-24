# DevOne Server: progress toward 1.0 stable

Updated: October 23, 2026 (America/New_York).
Current package version: `1.0.0-alpha.3` — developer preview, not stable.

## Delivery agreement

Completed, validated changes belong on `main` and must be included by the standard fresh installer and in-place updater. PR #23 (starter applications and reviewed AI actions) merged into main at `77dad2b808183d9546673dbd8fc4709f1ac817c7` after both GitHub checks passed. Its local validation included TypeScript checks, the production build, 97 tests, and distribution integrity/shell syntax checks.

The fresh installer deploys the exact committed checkout; new servers should use an approved main-derived commit or release containing these changes. The dashboard updater discovers main, requires the validate/installer checks for its exact target, and rebuilds API, Agent and dashboard. Existing servers update in place rather than rerunning setup. Merge inclusion is verified; this update has not been deployed or tested on the user's VPS by this session. A clean server still requires its own domain/DNS, firewall access, setup and optional software selections.

## Original five-phase roadmap

| Phase | Working implementation / observed progress | Remaining before the phase closes |
| --- | --- | --- |
| 1 — Foundation & secure core | Installer/prerequisites, Node API, React dashboard, Agent boundary, authentication, roles, vault, audit/jobs, services, health; initial live setup/HTTPS/QA reported in earlier work | Repeat fresh install on a clean second VPS, reboot/failure recovery, authorization/isolation acceptance and saved evidence |
| 2 — Server management & Software Center | Discovery, service controls, managed PHP 8.3-FPM/Redis/Docker package path, file manager, monitoring and diagnostics; user now reports successful Redis/PHP-FPM installs | Broader approved runtimes and web servers, version management, scoped terminal/log workflows, package interruption/recovery, real runtime tests and acceptance |
| 3 — Hosting & applications | Managed sites/domains/aliases, static/PHP/Node adapters, files/Code Studio, TLS, Python and fixed container adapter code; user reports creating websites including Node apps; PR #23 adds static/PHP/Node starter installation | WordPress/DevOne CMS and other product installers; app-specific databases/secrets; Git deployment/history; app environment management; deployment rollback and live end-to-end acceptance |
| 4 — Infrastructure & databases | Redis and SQL-engine package paths, database discovery and initial site-associated SQL database/account provisioning, fixed unprivileged NGINX container adapter, control database snapshots and disposable hosting QA implementation | Complete database/user/permission administration beyond initial MariaDB/PostgreSQL provisioning (editing/deletion/rotation and broader MySQL support); phpMyAdmin; site/database backups and tested restores; general Docker/Compose, volumes/networks; Cloudflare/DNS; server configuration recovery |
| 5 — AI & platform | Encrypted provider setup, advisory diagnostics/code review, reviewed single-action dashboard operations, main-based in-place updater; MFA/security controls implemented | AI coverage for remaining frontend operations, multi-step troubleshooting and recovery; multi-server enrollment/resource isolation; verified security/WAF enforcement; recoverable release acceptance and final hardening |

No full phase is newly certified complete by this status. Earlier host success is useful progress, but it is not a substitute for the original full-parity exit gates or reproducible acceptance evidence.

## Priority order for the next work

1. Complete database provisioning and isolated database users/credentials, then deployment/recovery controls and acceptance of the DevOne CMS local preview; WordPress and DevOne CMS now have managed installation increments. Each supports an existing compatible site or a new site, with trustworthy artifacts, prerequisites, configuration, health checks and failure recovery. Keep unimplemented catalog products visibly unavailable.
2. Finish deployment controls: app environment/secrets, Git deployment/history, health checks, application rollback and update behavior. Verify code-editor workflows; full browser VS Code remains separate unfinished integration.
3. Complete backups/restores and host package/update recovery. Restore websites, application databases, control state and encryption keys on a separate VPS; prove interruption and reboot behavior.
4. Expand AI to the remaining frontend capabilities through their existing APIs, including appropriate local step-up authentication and previews. Add multi-step execution with accurate progress, explicit failure handling and no invented success. Current AI actions cover a subset and require reviewing one action at a time.
5. Finish the rest of the locked roadmap: approved runtime/web-server support, scoped administration/logging, general container administration, Cloudflare/DNS, multi-server enrollment, security enforcement, and remaining legacy workflows. These cannot be silently dropped from the agreed stable scope.
6. Run the release acceptance matrix and produce a versioned release: clean install on a second VPS, upgrade an existing server without losing data, reboot, TLS renewal, isolation/security checks, browser workflows, restore drills, and measured load/memory/latency against equivalent legacy hardware. Resolve every release blocker before tagging stable 1.0.

## Release gate

`pnpm qa` verifies isolated development regressions. `pnpm qa:release` must remain blocked while acceptance gaps remain. The current legacy inventory contains 102 observed route literals: 80 pending, 22 partial, none accepted as verified. This is an acceptance inventory, not a count of missing features or a percentage of product completion; some mappings are behind the implementation and require review plus evidence.

The roadmap still requires full cumulative legacy capability parity, equivalent security and UI behavior, and measured performance before publishing the finished replacement. Successful installation of PHP-FPM and Redis closes the reported installation problem, not the entire Software Center or infrastructure phase.


## Three-batch continuation

The delivery order is now Phases 1–2 together, Phases 3–4 together, then Phase 5. See [delivery batches](DELIVERY-BATCHES.md) for scope, product goals and acceptance gates. Batch A has started with a Server Workbench: current resource observations and Owner-only fixed diagnostic/log recipes. This does not close its broader runtime, recovery, second-server and live acceptance gaps. No phase is newly certified passed.

The Dashboard now has a conversational AI interface with follow-up context, explicit per-action approval/denial, revocation of denied proposals and durable job-status display. This is an improvement to the existing AI action boundary; full administrative operation coverage and multi-step execution remain unfinished.

## Batch B database provisioning increment

Phases 3–4 have started with managed SQL engine installation and application database provisioning. Software Center now includes MariaDB/PostgreSQL. The Owner can create a database/account for a ready site through a durable job, with generated encrypted credentials and an application login verification; credential reveal requires separate Owner password/MFA approval. Partial provisioning is retained for inspection. See [managed databases](MANAGED-DATABASES.md). Live engine/isolation acceptance, database management/deletion/rotation, backup/restore, phpMyAdmin, CMS installers, deployment controls and the rest of Batch B remain open. No phase is newly certified complete.

## Live QA closeout infrastructure

An external QA/reset controller and a dedicated-host runner now wrap the existing live hosting profile with independent evidence, reset receipts, baseline probes and interrupted-run recovery. A phase 1–4 requirement manifest keeps unsupported/missing tests blocked. See LIVE-ACCEPTANCE-CYCLE.md. No live test or provider reset has been executed from this session. A disposable target, trusted external provider reset hook and connection remain required; remaining feature implementations and test profiles still block phase completion and the stable gate.

## No-spare-VPS SQL QA increment

GitHub-hosted CI now includes disposable Ubuntu SQL integration tests using the production Agent database runner: MariaDB/PostgreSQL provisioning, actual application credentials, isolation, wrong-password denial, privilege restrictions, duplicate/partial-failure behavior and service restart persistence. See [isolated SQL QA](ISOLATED-SQL-QA.md). CI evidence is separate from host acceptance, and `validate` depends on the SQL job. No user VPS is accessed or reset. Full host installation/upgrade/reboot/restore acceptance and the original phase gates remain open.

## WordPress installation increment

The Owner dashboard now includes a managed WordPress installer for new domains or empty PHP 8.3 websites, guarded prerequisites, per-site database/account generation, encrypted administrator credentials, durable progress/history, staged publication and failed-health preservation. See [WordPress scope and verification](WORDPRESS-INSTALLER.md). CI now includes eight real WordPress checks alongside sixteen SQL checks. Systemd/APT/public-TLS/browser/host acceptance is still separate. DevOne CMS and other product installers, full app update/rollback and the remaining phase 3–4 scope remain open; this increment does not certify a full phase or stable release.

## DevOne CMS preview installation increment

The Owner app installer now includes a pinned, prebuilt DevOne CMS 2.0.0-alpha.4 local preview for new or empty Node sites. Offline unprivileged initialization, private SQLite/key storage, encrypted initial credentials, guarded service configuration, health checks and failure preservation ship through the normal installer/updater. See [CMS installation scope](DEVONE-CMS-INSTALLER.md). CMS packaging remains preview software, with full module/browser/host acceptance, application updates/rollback and backups still open. CI includes reproducible source-package comparison and eight real CMS checks alongside the existing eight WordPress and sixteen SQL checks; no phase or stable gate closes from this increment.

## Disposable host HTTP routing correction

A user host report showed static/PHP/Node/Python response failures while file operations and basic probes passed. The disposable verifier used built-in fetch with a custom Host header; the runtime can replace that header with the loopback URL authority. It now uses a bounded, timed node:http request to loopback with the actual QA virtual host and no redirect following. Real-socket regression checks verify Host routing, wrong-host marker rejection, redirects and response-size limits. Missing runtimes are reported blocked without a cleanup warning when creation never returned a site. Docker remains an explicit Owner-installed prerequisite through Software Center; QA does not silently install host packages. The affected host must rerun acceptance after updating and installing/starting Docker. No live result, phase completion or stable certification is claimed by this correction.
