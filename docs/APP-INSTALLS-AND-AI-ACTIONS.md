# App installs and AI actions

## Working first release

Apps & runtimes now has an installer for three versioned, built-in applications:

| Application | Required site | Installed entry | Startup |
| --- | --- | --- | --- |
| Static website | Static / NGINX | index.html | Served by NGINX |
| PHP website | PHP 8.3 / NGINX | index.php | Existing isolated PHP-FPM pool |
| Node.js HTTP app | Node 22 / NGINX | server.mjs | Isolated systemd service; loopback HTTP acceptance |

Choose an empty existing website of the matching type, or enter a domain to create a new website and install in the same durable job. Runtime prerequisites must already be installed. DNS and HTTPS are configured separately from Websites & files. This is a working starter installer, not an installer for every catalog product.

The Agent resolves all paths and identities from its trusted site registry. Code ships with DevOne; no network scripts, lifecycle hooks or package install commands run as root. File creation uses the existing unprivileged worker and exclusive creation. Existing content is never replaced. Existing site revisions must match. Installs serialize with site lifecycle and admitted file operations. A partially failed write or startup is marked `needs_inspection`; files and site metadata remain available for operator recovery. Failed sites are not automatically deleted or retried. A timeout or process loss leaves an interrupted job for inspection.

API: `GET /api/apps`, `POST /api/apps/install` with `appId`, either `domain` or `siteId` plus `expectedRevision`, `confirmed: true`, and an idempotent `requestKey`. Monitor the returned job through `/api/jobs/:id`. A 202 response means queued, not deployed.

## AI actions

The AI screen retains advisory diagnostics and adds a separate natural-language action panel. A provider proposes exactly one allowlisted operation. Users inspect the actual tool and parameters and select Run reviewed action. Plans expire after five minutes and are single-use, bound to the originating user, kept only in API memory, and invalidated on restart. The original API rechecks the current session, role, origin, confirmation, target and revision. AI cannot supply paths to host files, HTTP destinations, command strings or elevated identities.

Supported operations: website inventory, creation and lifecycle; site files; TLS; built-in starter installation; service inventory and actions; installed package/runtime inventory; security reports/scans; QA reports/runs; monitoring; control database backup creation; and jobs. Some requests require more than one conversation step, such as reading a file revision before replacing it. Outputs are displayed locally and are not automatically fed back to the model. Read operations also use the review step in this release.

The user's task goes to the selected provider. Site names, IDs, types, states and revisions are included only with the explicit checkbox. No API credentials, session tokens or raw file contents are fetched for planning. Users should not put credentials in task text. Existing encrypted provider keys remain server-side. OpenClaw still requires its dedicated no-tools agent, since DevOne performs the reviewed actions itself.

## Remaining work before full product parity

WordPress needs a dedicated installer with isolated MySQL/MariaDB database and user creation, verified artifacts, configuration, installation credentials, acceptance checks and recovery. DevOne CMS v2 and other CMS/framework catalog products also need their own adapters. They stay unavailable in the catalog until implemented and tested. Having PHP-FPM or Redis installed does not establish these requirements.

Owner password/MFA protected package installation, updates, credentials, account administration, per-site WAF controls and download workflows are not exposed as AI actions in this release. Their existing dashboard interfaces continue to be the supported path. Full autonomous multi-step planning and all-dashboard feature parity are future work.

Validation includes TypeScript checks, production build, API authorization tests, target/no-overwrite/concurrency tests, job deduplication and failure-state tests, AI plan ownership/expiry/replay tests, metadata minimization, plus the existing regression suite and distribution checks. Live VPS acceptance of this new flow remains required; these local tests do not install packages or change the production server.

## Dashboard chat and in-conversation approval

The main Dashboard now includes DevOne AI Chat for Owner/Admin users, with a connection selector and a link to provider setup. The AI workspace uses the same chat interface. Users can supply follow-up details in conversation, inspect the exact proposed tool/parameters, check explicit approval and select Confirm & run, or deny the action. Denying revokes the server-side plan; another user cannot revoke or execute it. Typed approval text does not execute a plan. Plans remain single-use, expire in five minutes and pass through normal API authorization. Missing details lead to a conversational clarification rather than a fabricated target.

The frontend displays returned job state separately from submission and polls durable jobs. A queued result is not presented as success. Pending actions cannot be double-submitted while requests are running. A new task supersedes previous pending proposals by revoking them first. Execution results and raw job output are not included in conversation context sent to providers. Up to six recent conversational messages are included, within the backend's bounded history limits; system/tool roles are refused. Site inventory sharing remains an explicit checkbox. Conversation state is memory-only and clears on page navigation, reload or provider switch; changing providers starts a new conversation. Provider keys/passwords belong in dedicated forms, never chat.

This interface exposes the existing supported action set. It does not implement new database/CMS adapters, unrestricted shell access, unattended multi-step workflows, or the remaining Owner step-up operations. Live browser/VPS acceptance remains required.
