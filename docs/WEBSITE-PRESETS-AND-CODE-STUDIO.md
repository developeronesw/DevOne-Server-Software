# DevOne Website Presets and Code Studio

## Website Presets mean hosting infrastructure, not website content

Create an empty website by selecting domain ownership, isolated Linux identity, document root, web server, and optional runtime/version. Do not generate demo pages, React boilerplate, example PHP files, sample content or AI-generated code during website creation.

The site directory is derived from a server-generated ID, not a user-provided absolute path.

### Operational
- Static NGINX: isolated, empty public directory and validated NGINX vhost.
- Private files: isolated, empty public directory with no web server.

### Discoverable but not deployable until hardened adapters pass QA
- PHP (8.3, 8.4, 8.5) on NGINX, Apache, OpenLiteSpeed or LiteSpeed Enterprise
- Node.js (22, 24) on NGINX, Apache, OpenLiteSpeed or LiteSpeed Enterprise
- Python (3.12, 3.13) on NGINX or Apache
- Containers on NGINX or Apache

Version menus represent *planned choices*, not installed/available runtimes. Adapters must implement version-pinned installation, per-site UID/GID, isolated PHP-FPM pools or systemd processes, private runtime sockets/ports, HTTPS, capability checking, config conflict checks, rollback and real Ubuntu acceptance. LiteSpeed Enterprise licensing must be validated independently.

App installation is a **separate operation** after provisioning the empty site. For DevOne CMS v2, WordPress, Ghost, and other curated products, add version-pinned installers with explicit database, domain, secrets, license, rollback and security checks. Cloudflare Worker deployment is distinct from Linux site provisioning.

## Code Studio now

Per-site Code Studio provides tabbed browser editing backed by existing safe audited file APIs. Users can open and save UTF-8 source under the selected site's public document root with file revision checking. No arbitrary terminal, container management or root file access is exposed. Ctrl+S requires save confirmation.

The AI review feature sends only the open file content (11 KB limit) with explicit consent and a configured provider. It returns advisory comments and never automatically applies, runs or commits proposed changes.

## Full browser VS Code / Codex integration: separate gated phase

code-server or OpenVSCode Server can power a full browser IDE. Each IDE must run as the site UID/GID in a restricted container or sandbox, with only approved project directories mounted, bounded CPU/RAM, session authentication via expiring scoped credentials, HTTPS/WebSocket proxying, audit logs and idle cleanup. Never expose direct IDE ports, global Docker socket, DevOne API secrets, Agent token, master encryption key or other customers' files.

Codex VS Code extension compatibility depends on the exact browser IDE version and must be verified before enabling it; Codex CLI is another option once isolated terminals can be provided safely. Browser IDE extension auth is distinct from DevOne's built-in encrypted AI provider vault.

## QA

Tests cover static/files-only create, unsupported runtime rejection, preset consistency, and code-assist consent and authorization. Full PHP/Node provisioning, one-click CMS installation and code-server remain incomplete until server-side adapters are implemented and tested on a disposable VPS.
