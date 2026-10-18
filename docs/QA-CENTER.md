# DevOne automated QA

Run `pnpm qa` from a dependency-installed checkout using the supported Node version. One command type-checks and builds the project, runs authentication, API, persistence, encryption, service-policy, file-boundary and QA-runner tests, checks lint, validates the bundled distribution and checks installer shell syntax. No login, production credentials or manual test sequence is required. Runtime tests start local fixture services and use disposable databases; privileged host actions are mocked or rejected by policy.

Each check reports PASS, FAIL or BLOCKED, elapsed time, exit status and a normalized failure reason. Commands have a three-minute limit and timed-out process groups are terminated, including their fixture processes. Console output contains diagnostic details. JSON evidence deliberately excludes raw logs, credentials and secret values. A unique report for each run and atomic `qa-reports/latest.json` are saved locally. GitHub CI runs the same command and retains JSON evidence as the `devone-qa-evidence` artifact for 30 days, even when checks fail.

`pnpm qa` exits unsuccessfully if any automated check fails or is blocked. `pnpm qa:release` additionally requires production readiness. It currently exits unsuccessfully because unfinished modules and real VPS verification remain release blockers. A green development check does not certify those missing capabilities. Pending entries must only be removed when real checks and their evidence replace them.

## Legacy QA parity

| Legacy capability | Current replacement |
| --- | --- |
| Authenticated API / CSRF / secret probes | Isolated API and vault regression suites |
| Site file CRUD and traversal rejection | Temporary-directory file-boundary suite; live UID/GID verification pending |
| Saved run evidence and JSON export | Versioned local JSON reports and CI artifacts |
| Release blocker gate | `pnpm qa:release`, blocked by failed or pending coverage |
| NGINX, database hosting, container and disposable-site checks | Pending until their Node implementations exist |
| Glass QA Center dashboard | Pending dashboard integration; command-line runner available now |

This is the initial QA infrastructure, not full legacy feature parity. Browser workflows, target-VPS performance, fresh installation, TLS, reboot recovery, backup restoration and real host isolation remain explicitly unverified. The runner never applies remediation automatically. Full host CRUD must eventually run on a disposable QA VPS, with a separate opt-in profile, rather than against customer resources.

## Legacy parity inventory

`qa/legacy-parity.json` accounts for every route literal observed in the fixed legacy bundle, tied to its archive hash. Partial mappings identify Node equivalents without claiming complete parity. `scripts/verify-parity.mjs` rejects missing/duplicate entries, a changed baseline, invalid mappings and unsupported acceptance claims. Verified entries require sanitized committed evidence comparing legacy and Node behavior on a disposable VPS, including security and UI checks. The QA release gate independently remains blocked while any entry lacks acceptance. Route strings alone are only a lower-bound inventory; non-route workflows and the existing whole-platform acceptance blockers also remain mandatory.


## Live dashboard QA

The dashboard now provides authenticated read-only probes for SQLite integrity, vault key, Agent health, services and sites, automatically at startup and every six hours, with saved reports. These do not substitute for full regression testing or the gated VPS release verification; see [Operations Modules](OPERATIONS-MODULES.md).

## Software Center and Security integration (Phase 2)

Dashboard QA performs 10 non-destructive checks, including the `agent.software` managed-install capability and `agent.crowdsec` readiness. Package installation is now an independent, Owner-approved, audited operation through the existing JobQueue. QA reports do not install software or claim WAF enforcement, and green CI is not evidence of successful package installation on the test VPS. See [Managed Software Installation](SOFTWARE-RUNTIME-PREFLIGHT.md).

## Dynamic hosting verification

The live dashboard QA now includes `agent.site_runtimes`, which checks that every PHP-managed site has an actual PHP-FPM pool definition and active FPM service and every Node-managed site has an actual systemd unit. It reports missing adapters as FAIL. For a Node site intentionally awaiting `server.mjs`, stopped is not falsely reported as a running application. You must still upload actual code and test HTTP/HTTPS on your development VPS for end-to-end acceptance. See [Operational Hosting](PHASE3-OPERATIONAL-HOSTING.md).

## Owner-operated disposable host acceptance

The QA Center includes a second, separate **Disposable website and software QA** application. It is **not scheduled** and runs only after Owner password/MFA and explicit confirmation. The Agent creates and HTTP-tests six one-time test sites (static, file-only, PHP 8.3, Node 22, Python 3.12 and restricted Docker web), then requests deletion of *only those exact newly created site IDs*. The UI displays the result and whether cleanup succeeded. Never assume cleanup if it reports Needs inspection. Software installation tests occur inside a self-removing Ubuntu Docker container; installed host packages are inspected and are **never automatically uninstalled**. Refer to [Python, Docker and disposable host QA](PHASE4-DISPOSABLE-QA-AND-PYTHON-CONTAINERS.md). The 10 existing periodic checks remain read-only and independent.
