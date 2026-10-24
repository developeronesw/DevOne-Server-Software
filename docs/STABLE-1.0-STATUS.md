# DevOne Server: progress toward 1.0 stable

Updated: October 24, 2026 (America/New_York).
Current package version: `1.0.0-alpha.3` — developer preview, not stable.

## Delivery agreement

Completed, validated changes belong on `main` and must be included by the standard fresh installer and in-place updater. PR #23 (starter applications and reviewed AI actions) merged into main at `77dad2b808183d9546673dbd8fc4709f1ac817c7` after both GitHub checks passed. Its local validation included TypeScript checks, the production build, 97 tests, and distribution integrity/shell syntax checks.

The fresh installer deploys the exact committed checkout; new servers should use an approved main-derived commit or release containing these changes. The dashboard updater discovers main, requires the validate/installer checks for its exact target, and rebuilds API, Agent and dashboard. Existing servers update in place rather than rerunning setup. Merge inclusion is verified; this update has not been deployed or tested on the user's VPS by this session. A clean server still requires its own domain/DNS, firewall access, setup and optional software selections.

## Original five-phase roadmap

| Phase | Working implementation / observed progress | Remaining before the phase closes |
| --- | --- | --- |
| 1 — Foundation & secure core | Installer/prerequisites, Node API, React dashboard, Agent boundary, authentication, roles, vault, audit/jobs, services, health; initial live setup/HTTPS/QA reported in earlier work | Repeat fresh install on a clean second VPS, reboot/failure recovery, authorization/isolation acceptance and saved evidence |
| 2 — Server management & Software Center | Discovery, service controls, managed PHP 8.3-FPM/Redis/Docker package path, file manager, monitoring and diagnostics; user now reports successful Redis/PHP-FPM installs | Broader approved runtimes and web servers, version management, scoped terminal/log workflows, package interruption/recovery, real runtime tests and acceptance |
| 3 — Hosting & applications | Managed sites/domains/aliases, files/Code Studio, TLS, static/PHP/Node/Python/fixed-container hosting; reported eight-check live hosting pass; WordPress/CMS local installers, explicit admin accounts, isolated credentials and independent saved-login unlock; user reports installation/UI workflow working | Git deployment/history, app environment/secrets management, application updates/rollback, broader product scope, full authenticated browser/content/persistence and recovery acceptance; CMS package remains alpha preview |
| 4 — Infrastructure & databases | Redis/SQL packages, site-associated database/account provisioning and isolated SQL login/isolation tests; scoped container adapter; control snapshots plus encrypted database/key recovery bundles and isolated restore drills | Complete database/user/permission administration beyond initial MariaDB/PostgreSQL provisioning (editing/deletion/rotation and broader MySQL support); phpMyAdmin; site/database backups and tested restores; general Docker/Compose, volumes/networks; Cloudflare/DNS; server configuration recovery |
| 5 — AI & platform | Encrypted provider setup, advisory diagnostics/code review, reviewed single-action dashboard operations, main-based in-place updater; MFA/security controls implemented | AI coverage for remaining frontend operations, multi-step troubleshooting and recovery; multi-server enrollment/resource isolation; verified security/WAF enforcement; recoverable release acceptance and final hardening |

No full phase is newly certified complete by this status. Earlier host success is useful progress, but it is not a substitute for the original full-parity exit gates or reproducible acceptance evidence.

## Accepted increments and phase boundaries

The reported eight-check live hosting/runtime run is a passed milestone for that host run. The Owner subsequently reports working installers, runtime checks and improved account/reveal/UI workflows. These reports close the reported issues within their scope; the latest user confirmation does not include an exact host commit or a full application acceptance artifact. Automated SQL/application integration and source regression results supply separate reproducible evidence. No passing result is being discarded, and no whole phase is certified solely from these narrower passes.

The control database/key recovery increment adds genuine isolated restore evidence. Website/application/host restoration, full roadmap parity and final release acceptance remain open. Completed milestones should not be confused with the broader phase exit requirements.

## Priority order for the next work

1. Extend the implemented encrypted control database/key recovery to website files, application SQL/CMS private state, Agent/host configuration and tested restores. Finish safe application cleanup. Retain the passing installer/SQL/hosting evidence, and complete authenticated application/recovery acceptance. Keep unimplemented catalog products visibly unavailable.
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

## Disposable host reload readiness

A follow-up host report passed files, Node, Python, container hosting, software inventory and isolated package installation; static and PHP returned HTTP 200 without the marker, and all created sites were deleted. NGINX/PHP reload signals can complete before workers serve the new virtual host. QA now reconnects within a fixed ten-second readiness budget, requiring HTTP 200 and the current run's marker; persistent incorrect content still fails and is cleaned up. Real-socket regression covers stale/default content, transient 502/connection refusal, fresh connections and persistent wrong-content failure. Isolated CI adds repeated real static/PHP provisioning and cleanup with immediate reload signals (34 integration checks total). This is not a confirmed live root cause or a live acceptance pass; the affected server must rerun after update.

## Reported live hosting pass and installed-app checks

The Owner supplied a completed dashboard screenshot showing all eight disposable host checks passed: static/files/PHP/Node/Python/container hosting, active PHP-FPM/Redis/Docker inventory, and the isolated package install. All created test sites and the temporary package container report deletion. This is user-supplied UI evidence for that run, not independent remote verification, a pristine-host reset, or full phase certification.

QA Center now offers Owner-only read-only checks of existing managed WordPress/CMS installations: installation stage, real login/front-page or CMS identity/domain/version, CMS service activity, and private HTTP-path denial. Requests connect only to loopback with the registered domain, use trusted TLS/SNI when enabled, reject redirects and bound time/size. No credentials are read or submitted; nothing is installed/deleted by these checks. Missing HTTPS blocks full success; an exposed private path, wrong application identity or unavailable route fails. See APPLICATION-ACCEPTANCE.md. CI adds actual WordPress/CMS verifier runs (36 integration checks total). Authenticated content/persistence, controlled app cleanup and backups/restores remain open.

## Software catalog installer entry points

Apps & Runtimes previously displayed a generic unavailable warning for WordPress/CMS even though their dedicated installer was mounted above the catalog. Catalog capabilities now identify the two managed installers explicitly. Owner card/detail actions scroll and focus the existing installer with the chosen app selected; repeat selections reset to a new target, and active installs prevent switching. Other roles see Owner-required wording; unsupported apps remain planning-only. Installer API authorization and password/MFA requirements are unchanged. The normal dashboard update carries this usability correction; no new live app installation or stable certification is claimed.

## Websites and files visual refresh

The hosting workspace now presents responsive website cards, counts derived from actual site/runtime/TLS state, domain/runtime search, direct file/Code Studio/Visit actions, and a separate styled creation panel. Certificate/domain/service/disable/delete operations remain available in each site's Actions disclosure, using the existing job handlers, confirmations and typed-domain deletion checks. The file manager receives matching controls, forms, tables and upload styling; Code Studio retains its own editor styling. Private workspaces omit public Visit links, and incomplete sites retain disabled mutation controls. This is a dashboard presentation change, delivered by the normal updater; no site configuration, content or credentials are migrated. Type/build/regression checks cover repository validation. A browser render attempt was blocked by the environment's local-file policy; tablet/mobile visual acceptance and the user's live rendered workflow remain unverified.

## Explicit application accounts and deployment choice

The Owner reported confusing panel approval credentials with the application's generated login. New WordPress and DevOne CMS local forms now require explicit administrator username/email/password/confirmation, separate from fresh panel Owner password/MFA approval. API, Agent, offline CMS bootstrap and WordPress helper carry and validate these fields; chosen passwords are encrypted, passed on stdin and excluded from job/reservation/audit metadata. Account changes under an existing idempotency key are rejected. Credential reveal returns the recorded username; historical requests retain the `devone_admin` fallback and saved password. No existing deployed account is renamed or reset.

CMS Local versus Cloudflare Workers choice now distinguishes automatic local installation from Cloudflare guided setup; panel-side automated Cloudflare provisioning remains open. The pinned CMS package is alpha.5, rebuilt from CMS main with custom-account login/package tests. Real WordPress/CMS integration login tests use chosen non-default usernames and non-hexadecimal passwords. Source CI, package reproducibility, authentication/secret/idempotency regressions and full server QA remain required. Current-host login confirmation, rendered forms, full app cleanup/backups/restores and stable release gates remain open.

## Installer styling and saved-login unlock form

A user screenshot showed the saved-login button disabled because it depended on the installation form's distant password field. WordPress/CMS now share a dedicated Unlock saved login section with its own panel Owner password and MFA/recovery-code inputs. Required-field validation guides an empty submission to the password input instead of silently disabling the button. Missing/unknown HTTPS still disables reveal with an explicit message; API Owner/password/MFA/TLS checks remain unchanged. Revealed secrets clear after sixty seconds, on installation/target changes, repeat history selection, new-install attempts and unmount; pending requests abort and cannot show stale credentials.

The app/destination selectors, account/approval sections, progress, history and saved-login result receive scoped light-dashboard styles with responsive layouts and keyboard focus. A rendered-HTML regression checks both products' independent visible reveal inputs, enabled empty-password submit/native-required behavior and HTTPS blocking. It is not a rendered browser or end-to-end interaction test. Earlier browser visual testing was blocked by the environment's local-file URL policy; no workaround or new visual acceptance is claimed. Normal dashboard updates carry these changes, without rewriting existing app accounts or site data.

## Encrypted control-data recovery and isolated restore drills

Backups now adds passphrase-encrypted bundles containing a consistent control database and its matching vault master key, with separate Owner password/MFA approval, panel HTTPS/Origin checks, bounded work/storage, downloads and explicit deletion. A dashboard restore drill uses the same offline recovery routine against a private temporary copy, checks SQLite integrity and decryptability of vault/MFA records, invalidates copied sessions and interrupts pending copied jobs. Routine pass/failure removes the restored temporary files; live state is not replaced. Successful drill times and encrypted-file hashes are retained; failed drills clear earlier displayed acceptance for that bundle. Existing database-only snapshot files remain separate and are not whole-file encrypted.

The bundled offline helper restores only into a new private directory and never activates the copy. Real isolated tests cover backup/restore, preserved Owner hashes and secrets/MFA, stale-session/job quarantine, API authorization and failure handling. See CONTROL-RECOVERY.md for exact scope, limits, commands and recovery prerequisites. Website files, application databases/CMS private state, Agent/host configuration, TLS, full activation/reconciliation and offsite scheduling remain unfinished. No full phase or stable gate closes from a control-data restore drill; target-host/browser/full-server restore acceptance is still required.

## Managed VPS migration workflow

Backups now adds a full managed-data export/upload/inspect/apply workflow, with encrypted streaming archives, whole website homes/private CMS data, logical MariaDB/PostgreSQL dumps and saved accounts, control/vault/MFA recovery, managed TLS material, Redis snapshots, the fixed container image and existing control backups. Stable IDs are preserved while destination Linux ownership is remapped. Target-local panel/Agent/network identity is retained. Inspection reports source/target commit compatibility and fresh-target blockers; restored hosting is checked on loopback before publication. Final-cutover mode can keep the source paused to avoid losing subsequent writes.

Durable root-worker maintenance guards, explicit Owner password/MFA/scope/typed-target approval, bounded resumable uploads, manifest/path validation and journaled source resume/destination rollback ship in the normal installer/updater. Detected unsupported resources block export rather than being omitted under a complete-backup label. This is managed application migration, not an OS image or support for arbitrary host services. See SERVER-MIGRATION.md for precise coverage, limits, required matching commits, DNS cutover and recovery.

Automated archive/API/site-identity regressions and isolated real SQL transfer plus root file/control migration fixtures are required before integration. Host services are stubbed in the latter fixture; actual two-VPS/systemd/reboot/APT/browser/TLS-renewal migration remains unverified. No source VPS was accessed, paused, transferred or reset from this session. Full phase/stable acceptance stays open.
