# DevOne Operations Modules — Developer Preview

The DevOne dashboard has Apps, Databases, Backups, Monitoring, QA Center, and AI. Modules are implemented incrementally; full legacy parity and release acceptance are not yet complete.

## Apps and Databases
The Agent performs allowlisted read-only runtime version queries and systemd state discovery. No arbitrary shell endpoint is exposed. Owner-approved PHP 8.3-FPM and Redis Server installation now runs through the existing audited API/Agent job system. Runtime removal and upgrades, SQL database creation, database accounts and Docker lifecycle management remain to be built. PHP 8.3 website and Node 22 runtime site creation, private PHP-FPM pool and systemd/Nginx adapters, and Node start/stop are available in Websites; see PHASE3-OPERATIONAL-HOSTING.md. Existing static websites and HTTPS live under Websites & Files.

## Monitoring
Authenticated Agent metrics sampled once per minute with a 24-hour SQLite retention window; dashboard displays load and memory history. Load average is not CPU utilization percentage.

## Automatic QA
The existing pnpm qa process automatically runs builds, tests, installer syntax validation and legacy parity inventory in GitHub CI on pushes and PRs. The new dashboard QA Center separately runs NON-DESTRUCTIVE live checks at startup, every six hours and on user request: SQLite integrity, singleton Owner, vault master key, Agent health/metrics, service and site inventory. Results are stored in SQLite. A pass here does not satisfy the stricter release gate; production restore, host CRUD and VPS acceptance remain unverified.

## Backups
The Owner-only control database snapshot feature creates consistent SQLite online backups in /var/lib/devone/backups, capped at 30. Snapshots exclude the vault encryption master key, hosted site files, system configuration and external databases. The download contains encrypted credentials and must be stored privately. Restoration is intentionally NOT available until verified on a disposable VPS. Never confuse these snapshots with full-system backups.

## Multi-provider DevOne AI
Provider | Encrypted Vault secret | Default model
--- | --- | ---
Google Gemini | gemini.api_key | gemini-2.5-flash
OpenAI API (ChatGPT-family models) | openai.api_key | gpt-4.1-mini
DeepSeek API | deepseek.api_key | deepseek-flash
OpenClaw Gateway | openclaw.gateway_token | Explicit server-side pinned agent model

An OpenAI API key and API billing are separate from an ordinary ChatGPT web subscription. OpenClaw is a gateway/agent runtime, not a foundation model, and can route to other model providers.

For OpenClaw:
1. Create a *dedicated* diagnostic agent on the gateway. Disable every shell, execution, file, browser, network search, automation and mutating tool. OpenClaw Gateway HTTP chat requests may invoke configured agent tools, even when a caller supplies an empty tools list.
2. Enable the optional OpenAI-compatible /v1/chat/completions HTTP endpoint in OpenClaw. Expose its interface only over an authenticated, trusted TLS endpoint accessible by DevOne.
3. In /etc/devone/devone.env on the DevOne VPS, set DEVONE_OPENCLAW_BASE_URL=https://your-secured-gateway.example/v1 and DEVONE_OPENCLAW_AGENT_MODEL=openclaw/devone-diagnostics. Use your own dedicated, no-tools agent alias. Restart devone-api.
4. In the DevOne Owner Secure Vault, store the gateway bearer token as openclaw.gateway_token. Do not paste tokens in GitHub or conversation screenshots.

Gateway URL is fixed at the server configuration; the browser cannot supply a destination. Direct providers use fixed vendor API endpoints. Credentials are never returned to the browser.

DevOne sends only your question and a small CPU/load/memory/service-state summary; it does not intentionally send server hostnames, IP addresses, user files, logs or stored credentials. Providers have their own data and privacy policies. DevOne executes no AI-generated operations. A dedicated read-only OpenClaw agent must enforce that limitation on the gateway side too.

## Installation and update
The fresh installer is not an updater. For existing preview VPS deployments, use a verified commit, back up SQLite and the previous builds, rebuild API + Agent + dashboard, restart both services, and validate live API/Agent health. Complete the release acceptance checklist before any production use.
