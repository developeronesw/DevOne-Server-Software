# Software Center host runtime preflight — Phase 2 integration

## Scope

This is the **first dashboard-connected preflight** built on our existing Software Center, read-only software discovery, security model, and the guarded `scripts/software-runtime-pilot.sh`. It does **not** authorize dashboard installation, app deployment, package upgrades, removal, or changing site configuration. Avoid confusing it with the protected **DevOne software update** feature, which updates DevOne Server itself.

The existing software catalog remains `installAvailable: false` for every application. This iteration adds only `php8.3-fpm` and `redis-server` as approved **host prerequisite check targets**, not installable apps.

## Architecture

- Owner/Admin Software Center UI: choose the exact host runtime and click **Run safe preflight**.
- API: authenticated `GET /api/software/capabilities` and Origin-checked `POST /api/software/preflight`; Owner/Admin only, 3 per minute per user, audit on successful probe.
- Agent: authorized localhost-only `GET /v1/software/capabilities` and strict `POST /v1/software/preflight` with a fixed package allowlist and 512-byte input maximum.
- Host: only `/usr/bin/bash /opt/devone/current/scripts/software-runtime-pilot.sh --check <package>`. This runs the existing script's APT simulation; it does not perform installation.
- Responses are bounded and do not expose privileged stderr, command details or arbitrary host files. Ready means the **preflight simulation** passed, not that the package is installed, active, or safely recoverable.

## QA to perform after updating a disposable development VPS

1. Open **Software & app runtimes** → **Host preflight**, choose PHP 8.3 FPM and Redis Server in turn, and run preflight.
2. Confirm each returns Ready or Blocked truthfully; do not treat a blocked result as application failure without checking package prerequisites.
3. Open **QA Center**, run **Run live checks**, and confirm `agent.software` and `agent.crowdsec` are present. This is 9 read-only checks in total, not the full release QA suite.
4. Confirm the Owner session, MFA, Security Center, website operations, monitoring and updates continue to work.
5. Run `pnpm qa` on a dependency-installed development checkout, not in a root-owned production runtime directory.
6. Save sanitized test evidence and the deployed exact commit SHA.

## Still blocked

Before implementing dashboard package mutations: validate package signing and vendor sources, serialized APT ownership and locking, package/script trust, runtime isolation, privileged job authorization and MFA step-up, interrupted install states, repository metadata drift, rollout recovery and repeatable uninstall/rollback on a disposable VPS. AppSec and real CrowdSec WAF blocking are also separate and **not** implemented by this change.

`pnpm qa:release` remains BLOCKED on legacy parity and full release acceptance.
