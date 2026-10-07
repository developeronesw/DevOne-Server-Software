# DevOne Server Node/React conversion readiness

Scan date: 2026-10-06. Target: Node/TypeScript, React 19, Vite 8.3.3.
Scope: the exact all-in-one distribution checked into this repository and the current Node edition. Historical ZIPs outside this bundle and the original backend source repository were not scanned. `LEGACY-SCAN.json` records file hashes, binary/source classification and observed API route strings. Reproduce with `python3 scripts/scan-legacy.py`.

## Confirmed findings

- `panel/assets/devone.js` is readable React JavaScript using `React.createElement`. It contains existing dashboard components, forms, navigation and API clients. This can be refactored into typed React components and ES modules. It is not evidence that the original JSX/TypeScript project or build configuration is present.
- `panel/assets/devone.css`, HTML, icons and `hosting.js` provide recoverable presentation assets. New UI components must be checked against the light UI contract and new API response types.
- Original QA backend Go source is present at `qa/source/qa-api/main.go` and `qa/source/qa-agent/main.go`. It includes health/release checks, result models, persistence, disposable resource tests, privilege/listener checks and CSRF validation.
- Main Core, hosting, runtime, metrics, applications and platform backends are ELF executables. No corresponding implementation source was found in this scanned bundle.
- HF5 supplies replacement QA executables and guard logic without matching Go source in its patch directory. The older QA Go files are therefore a starting point, not proven source parity with the patched binaries.
- Bash installers expose filesystem layouts, generated config keys, service boundaries and NGINX routes. They are useful specifications, not a complete backend implementation.

## Feature-by-feature result

| Feature | Available evidence | Conversion method | Node status |
| --- | --- | --- | --- |
| Dashboard, navigation, search, forms | Readable React JavaScript, CSS, HTML | Refactor to TSX/modules; replace global React/vendor loading with Vite | Sign-in and overview ported; remaining workspaces pending |
| Hosting customer portal | HTML and readable JavaScript client | Build typed React portal; recreate tenant authorization backend | Pending |
| Authentication and users | Legacy client/setup contract; backend compiled | Keep new SQLite/scrypt/session implementation; add role/user lifecycle and migration | Owner sign-in/logout and bootstrap protection implemented |
| Live host monitoring | React metrics/history calls; compiled metrics backend | Node OS/host probes plus bounded persistent sampling | Basic memory/load/uptime/core count implemented; history/disk/network pending |
| Services | Client service/action calls and host service layout | Explicit Agent service operations with argv validation, confirmation, auditing | Fixed allowlist discovery/start/stop/restart implemented |
| Websites and domains | Site forms/API calls; config and ACL script | Rebuild adapters, Linux site identities, domain validation and rollback | Pending |
| File manager and uploads | Client read/write/mkdir/upload calls; HF7 delete fix | Rebuild isolated path handling, symlink/traversal checks, streaming limits, ownership | Pending |
| Runtimes and package manager | Software catalog/client, installer dependencies | Serialized jobs and versioned runtime adapters; no arbitrary root shell | Pending |
| Databases | Client database CRUD; compiled backend | Engine-specific creation/users/permissions and secret storage | Pending |
| TLS and VHost editor | SSL client routes; generated NGINX config | Adapter validation, ACME/cert renewal, backups and tested rollback | Node installer gateway only; managed-site TLS pending |
| Git/ZIP application deployment | Project/application catalog, client contracts, manifest | Source validation, isolated builds, health checks, lifecycle and rollback | Pending |
| Containers and Compose | Container client, manifest policies, HF5 guard executable | Parse and enforce safety policy before Agent runtime commands | Pending |
| Cloudflare | Readable integration forms and API calls | Server-side encrypted credentials, scoped adapters and audited changes | Pending; external API contracts must be reverified during port |
| Security center | Client firewall/WAF/scanner/status operations | Detect actual installed tools; narrowly scoped policy actions | Pending |
| Hosting quotas, SFTP and tenant assignment | Portal/hosting clients, manifest and installer layout | Linux identity/cgroup/quota adapters and tenant authorization | Pending |
| QA Center | Original Go API/Agent source, JS/CSS fragments, HF5 binary remediation | Translate source and tests; account for patch behavior and new routes | Foundation tests exist; QA Center port pending |
| AI assistant | Readable UI, chat endpoint and confirmation/risk logic | New provider adapter and typed authorized operation plans | Pending; browser risk hints cannot authorize privileged actions |
| Interactive terminal | Legacy root-terminal contracts | Redesign as authorized scoped operations under current roadmap | Legacy unrestricted root behavior will not be copied |
| Updates, backups and migration | Bash backup/upgrade logic and release metadata | Versioned deployment, compatibility checks and explicit migration tooling | Legacy package bundled; Node updates/data migration pending |

“Pending” means the feature is not available in the Node edition. Static route/manifest evidence establishes the intended contract, not that a runtime test has passed.

## Limits and decisions

The old UI is already React. Vite 8 modernizes the development/build pipeline; it does not convert Go/ELF backends into Node. All listed management categories are technically feasible in Node, but compiled-only components require an implementation from the observed contracts or recovery of their original source. Exact behavior parity cannot be guaranteed from the ZIP alone.

Do not import the older UI wholesale and expose nonworking controls. Port one workspace and its backend/authorization/rollback tests together. Do not share service names, state directories or credentials between editions on the same host. Legacy JSON/account/secret data requires a separate migration design; this archive does not contain customer data.

Keep third-party and proprietary notices associated with legacy assets. The legacy archive includes its own proprietary license notice; the root repository MIT notice does not establish a new license for those bundled assets. No license text is changed by this scan.

Priority: jobs/audit/secrets and robust service operations; websites/files; databases/runtimes; deployments/containers; integrations/hosting/AI; full QA and release migration. Recovering original Core/Agent source would reduce reconstruction risk substantially.

## Validation recorded

Vite 8 build, TypeScript checks/lint, Node runtime authentication/Agent/metrics tests, service allowlist and role/origin rejection tests, ZIP/hash validation and installer syntax checks passed locally. No privileged service mutation, fresh Ubuntu installation, browser end-to-end test, public TLS issuance, reboot or legacy-to-Node migration was tested. This is a conversion readiness scan, not a production certification.
