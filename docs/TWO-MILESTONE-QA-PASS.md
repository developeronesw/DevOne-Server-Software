# Combined Security + Software Center development/QA pass

**State:** Developer preview; this pass does not close either roadmap phase or authorize production publication.

## Two guarded pilots

1. **Security Center:** `scripts/crowdsec-host-acceptance.sh --check` inspects DevOne, NGINX, and the CrowdSec engine on a disposable Ubuntu 24.04 amd64 VPS. It checks package/service/CLI/acquisition-file prerequisites, but **cannot** verify actual detection events, an NGINX bouncer, AppSec, correct remote IP interpretation, or blocked requests. It never mutates configuration.
2. **Software Center:** `scripts/software-runtime-pilot.sh --check php8.3-fpm` (or `redis-server`) uses current Ubuntu APT metadata and dependency simulation. Only exact package names are eligible. The script rejects candidates without Ubuntu Noble release markers, removals, and simulated changes to selected critical components. It does not update APT indexes or install packages in check mode.

Neither script is exposed through an API or connected to a dashboard Install button. Both require a disposable VPS and review of their pinned source. Upstream APT metadata authenticity, package maintainer scripts and dependency behavior still need operational review. An interactive `--install` mode is a **pilot only**, not a transactionally reversible managed software installer.

## Automated QA

`pnpm qa` runs the `tests/milestone-pilots.test.mjs` regression suite and checks both new shell files with `bash -n`. Existing Auth, MFA, CrowdSec, sites, API, catalog and security regression suites remain in place. Isolated CI is never treated as proof of actual VPS success.

## One short host pass, no destructive actions

On a disposable test VPS with a pinned reviewed checkout:

```bash
sudo bash scripts/crowdsec-host-acceptance.sh --check
sudo bash scripts/software-runtime-pilot.sh --check php8.3-fpm
sudo bash scripts/software-runtime-pilot.sh --check redis-server
```

An absent CrowdSec engine is **BLOCKED**, not a detected vulnerability. Site/WAF policies are not changed. Installing either package requires a **separate** explicitly confirmed, interactive `--install` run and must not be performed on a customer server. Installation cannot be automatically rolled back by the pilot.

## Requirements before these milestones can be marked complete

- Security: real CrowdSec event ingestion, bouncer + AppSec detection, trusted proxied client IP, permitted false-positive scenarios, request enforcement, outage fallback and safe rollback.
- Software: audited dashboard-to-Agent installation jobs, bounded package allowlists, authorization, real PHP website and Redis connection tests, concurrency/lock safety, dependency errors, interrupted package installs and state/rollback recovery.
- Common: clean VPS, TLS, Owner/MFA, restart and reboot, functional UI, matching legacy behavior, memory and latency baselines, and saved sanitized test evidence.

Keep `pnpm qa:release` **BLOCKED** until all Phase 1–5 and legacy parity acceptance requirements are verified. Never present APT installation, file presence or a dashboard status as verified WAF protection or complete deployer support.

## October 15 operational phase continuation

A follow-up integrates actual PHP 8.3-FPM/Redis managed installation into Software Center with Owner password/MFA step-up, audited persistent JobQueue operations, live package status and service controls. The earlier preflight-only dashboard UI was removed. This enables immediate testing on the dedicated disposable development VPS; it is not proof of successful real-VPS installs, rollback, broad software catalog deployment or WAF enforcement. See [Managed Software Installation](SOFTWARE-RUNTIME-PREFLIGHT.md).
