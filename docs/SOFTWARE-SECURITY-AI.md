# Software Center, AI setup and Security Center

## Curated Apps catalog

The Apps & Runtimes module lists **DevOne CMS v2** from the official https://github.com/developeronesw/DevOneCMS-v2 repository first. Its observed upstream package is 2.0.0-alpha.3. Its README documents local Node.js and Cloudflare Workers deployment paths. The catalog then lists **WordPress 7.1.3**, which WordPress.org showed as the latest stable release on 2026-10-14, along with Ghost, Strapi, Directus, Payload CMS, Next.js, Nuxt, Astro, SvelteKit, React/Vite, NestJS, Express, Laravel, Django, FastAPI, Docker, Node.js, Python and PHP.

Catalog entries have official source links, docs, prerequisites, category filters and reference versions. They are NOT installed just because they are listed. Built-in static, PHP and Node starter installers are now available in a separate installer panel (see APP-INSTALLS-AND-AI-ACTIONS.md). One-click installation for these catalog products is not yet enabled; each install adapter must protect against untrusted artifacts and implement isolated process identities, database isolation, domain/TLS, secrets, rollback, and automated tests. WordPress requires PHP and MySQL/MariaDB, never the control-plane SQLite. Honor DevOne CMS proprietary license terms.

## Security Center

An authenticated, scheduled read-only Security Center runs at startup, every six hours and on demand via an Agent fixed allowlist. Checks include effective SSH root/password login settings, UFW status, unexpected all-interface TCP listener ports, vault master-key file permissions, and candidate APT upgrades from local metadata. Unknown results remain UNKNOWN, not PASS. The scan does not include CVE database lookups, external vulnerability testing, AWS security group inspection, penetration testing, app scans or remediation. No user-controlled commands/paths can be passed to its Agent endpoint. Owner/Admin can see the report.

## DevOne AI

The Owner can select Gemini, OpenAI, DeepSeek or OpenClaw and enter/replace the key directly within the AI panel. Saving writes through the existing encrypted vault API; existing keys are never displayed. OpenClaw still requires a dedicated tool-disabled agent and trusted HTTPS endpoint configured on the server. A normal gateway agent could otherwise execute its own tools.

The main Dashboard has AI, Security Center and Software Center cards. AI normally receives a minimal, nonsecret host metric summary. An explicit consent checkbox lets Owner/Admin send the latest saved security scan's sanitized findings to the selected AI provider for advisory interpretation. Findings sent include only IDs, titles, severity, status and recommendations. Diagnostic answers are advisory. The separate AI Actions panel can prepare one allowlisted dashboard operation for review and execution through its normal API; see APP-INSTALLS-AND-AI-ACTIONS.md for scope and exclusions.

## Update and QA

Use the version-pinned in-place updater, not the fresh installer. CI validates backend/frontend, security endpoint authorization, catalog contents and scanner parsing. Host-level security acceptance and full installation/provisioning remain separate, pending release gates.
