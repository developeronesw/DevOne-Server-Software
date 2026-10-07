# Legacy distribution and Node edition

The bundled ZIP is DevOne Server 0.7.0 Phase 7 R3 with HF4, HF5, HF7 and HF8. Its cumulative base retains earlier phases. HF6 is superseded by HF7. Original source ZIP hashes are recorded in distributions/legacy-sources.json.

| Area | 0.7.0 distribution | New Node edition |
| --- | --- | --- |
| Runtime | Compiled Linux executables | Node/TypeScript, React/Vite |
| Authentication | Legacy API and session format | SQLite users, scrypt passwords, hashed sessions |
| Dashboard | Legacy Glass UI and workspaces | Light UI with working sign-in and host metrics |
| Host management | Sites, files, databases, runtimes, containers, deployments | Service discovery and confirmed start/stop/restart; other modules pending |
| QA | Integrated QA Center and patched Agent route | Automated foundation/API/Agent security tests |
| Installation | Cumulative Ubuntu installer and ordered hotfixes | Fresh installer from exact committed checkout |
| Web server | NGINX configured by legacy installer | API listens independently; installer uses NGINX as HTTPS gateway |
| State | Legacy /etc/devone and /var/lib/devone formats | SQLite and devone.env; no conversion implemented |

These are separate editions, not interchangeable components. Both currently use the same systemd service names and filesystem roots. Install on separate VPSs. No shared cookie bridge, proxy to the legacy privileged API, or automatic state migration is introduced.

## What was added
- Exact complete legacy distribution, one-command installer and checksum verification.
- Guards against installing one edition over the other.
- Live Node dashboard sign-in, logout, host metrics and actual Agent connectivity.
- Bootstrap setup token, exact configured browser origin checking, auth request rate limiting, bounded passwords and expired-session cleanup.
- Installer preserves existing default VHosts, builds the selected commit with a lockfile, removes the setup token after owner creation, and rejects unsupported reinstall/update scenarios.
- Real integration tests replace the top-level placeholder test command.

## Completion boundary
The ZIP preserves existing legacy functionality; it does not supply TypeScript source for that functionality. The original QA API/Agent Go source is present; other primary backends and HF5 replacement QA components are compiled-only in the scanned bundle. See CONVERSION-READINESS.md for the verified inventory. The remaining Node work in phases 2–5 is pending. Further operation/RBAC enforcement, website/runtime/database/container adapters, optional gateway installation, Cloudflare, AI, enrollment and recoverable updates must be implemented and tested before calling the Node edition 1.0 complete.

Archive checks, syntax, build and API integration tests do not certify a fresh Ubuntu installation, TLS issuance, browser end-to-end behavior, reboot persistence or every managed application. Run legacy QA Center on an expendable test VPS before production qualification. No production server was modified by this commit.

## Node/React conversion target

The active dashboard targets Vite 8 (pinned to 8.3.3), React 19 and the
Vite 8 React plugin. Node 22.13+ is required because the control plane also
uses node:sqlite. Convert the old workspaces into React components and their
backend behavior into validated TypeScript Agent operations. Do not embed the
legacy dashboard as the new UI or route new sessions directly into old APIs.

Port order: audited jobs and service controls; isolated websites and file
operations; database/runtime adapters; deployments and containers; Cloudflare,
hosting and AI; release-gate parity and migration tooling. Each port needs
unauthorized, validation, failure and rollback coverage before exposure in UI.

Service controls use a fixed unit allowlist and execFile arguments, not a shell. API mutations require owner/admin, same configured origin and explicit confirmation. Requested/completed/failed actions are audited. Service changes now use persistent audited jobs with request deduplication and interrupted-state recovery; owner-only encrypted secrets are also implemented. See JOBS-AND-SECRETS.md.
