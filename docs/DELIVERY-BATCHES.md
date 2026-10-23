# Three delivery batches for DevOne Server 1.0

Agreed October 22, 2026 (America/New_York). Deliver the original five-phase roadmap in three implementation and acceptance batches. Each batch must reach main, include fresh-install and update support, pass regressions, and record live acceptance before its phases are certified passed. Batch grouping does not remove unfinished features or relax the stable release gate.

## Batch A: Phases 1 and 2 — dependable server operations

Deliver secure installation, setup/login, sessions/MFA/roles, Agent isolation, vault, jobs/audit, service management, software/runtime management, files, diagnostics/logs, monitoring and scoped administration. Maintain package version and web-server support requirements from MASTER-PLAN.md. Runtime switching must protect existing workloads; package repair must have explicit safe plans, state inspection and recovery. Avoid unrestricted root command interfaces.

Current increment: Owner-only Server Workbench under Monitoring. Read resource pressure (available memory, swap, load per core, storage capacity, inodes, reboot marker), and run fixed diagnostic recipes for failed services, package consistency, Redis ping, NGINX/PHP configuration and bounded recent service warnings. Outputs remain local and ephemeral, are audit-tracked by tool ID, bounded by timeout/size/concurrency/rate controls, and receive best-effort secret masking. No arbitrary commands or arguments, repair, restart or automatic remediation run through this console. Optional missing tools are reported unavailable. Required commands ship with the existing Ubuntu/system/runtime packages; there are no new Node dependencies, database migrations or manual source patches.

Still open: broader approved software/web-server adapters and version management; scoped administration beyond diagnostic recipes; deeper package interruption/recovery; reproducible second-server installation, reboot, upgrade/rollback, isolation and browser acceptance. The workbench is one increment, not a passed Batch A.

## Batch B: Phases 3 and 4 — complete hosting and infrastructure

Deliver website/runtime/domain/TLS management, isolated environments/secrets, Git deployments/history, one-click product installers, SQL database/user/permission management, Redis operations, phpMyAdmin, site/database/configuration backup and tested restore, containers/Compose/volumes/networks and optional Cloudflare/DNS integration. CMS installation requires database support first. Every installer supports an existing compatible website or a new website, verifies its source/version and prerequisites, and reports progress, actual health and recovery status.

Accept with real application requests and database operations, cross-site isolation, stale/conflicting changes, failed deploy/restore recovery and an install/upgrade comparison across two servers. The current static/PHP/Node starter installer is a foundation for product adapters, not full CMS delivery.

## Batch C: Phase 5 — actionable AI and release acceptance

Deliver AI operation coverage across the supported frontend, local step-up for privileged tasks, understandable previews/diffs, multi-step workflows with durable progress, accurate results and failure recovery. Credentials never enter model prompts. Add multi-server enrollment/provider/resource boundaries, security hardening and the recoverable release process. Complete every remaining legacy capability and acceptance item before stable publication.

Accept with ambiguous requests, prompt injection, revoked access, stale revisions, duplicate execution, interrupted workflows, restore/update failure, browser journeys, load/memory/latency measurements and the full release gate. Provider or tool failure must never be presented as completed work.

## Product differentiation to build toward

These are DevOne design goals, not claims that competitors lack them:

- **Explainable operations:** show target, expected effect, prerequisites and recovery route before applying important changes.
- **Unified operator history:** associate the same operation record with UI and AI requests, affected sites, progress, verified result and recovery evidence.
- **Local-first diagnostics:** inspect the server without sending customer logs to a model; explicitly choose any context shared with a provider.
- **Recovery-oriented workflows:** surface interrupted work and its actual state rather than asking users to repeat an installation blindly.
- **Resource-aware hosting:** show real memory, disk and inode constraints before admitting new workloads, and measure performance on the target VPS.
- **Useful automation with visible proof:** scheduled health checks and AI actions distinguish requested, queued, running, failed and verified outcomes.

No feature is labeled unique, secure, fast, production-ready or complete solely because its UI exists or unit tests pass. Preserve the bright professional design, bounded background work, explicit uncertainty and the motto: performance, perfection, pristine design, then publish.

## Batch B implementation started

The first increment adds managed MariaDB/PostgreSQL engine packages and Owner-approved, site-associated database/account provisioning. Credentials are generated and encrypted before queue execution; app login is checked before ready status. See MANAGED-DATABASES.md for scope, supported profiles, retained failures and outstanding acceptance. The remaining Batch B checklist is unchanged.
