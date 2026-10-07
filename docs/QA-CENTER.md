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
