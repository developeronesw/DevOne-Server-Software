# Phase 3 operational websites — PHP 8.3 and Node.js 22

This update replaces disabled PHP/Node website presets with **real runtime adapters**. It does not generate sample projects, pretend uninstalled software exists, or silently expose the control panel.

## PHP website

1. Install PHP 8.3 FPM under **Software Center → Managed Software**, if not already installed. The Owner must approve with password/MFA. Verify Installed / Running.
2. Create **Websites & Files → PHP 8.3 website → NGINX**, select domain, and create.
3. DevOne creates a unique isolated Linux site user, site files at `/home/devone-sites/<site-id>/public`, a PHP-FPM pool at `/etc/php/8.3/fpm/pool.d/devone-<site-id>.conf`, and an NGINX FastCGI virtual host. PHP-FPM config is syntax-tested and reloaded; NGINX is validated and reloaded.
4. Through **Manage files** or Code Studio upload `index.php` with any actual PHP script. The website uses that file without generating demo content.
5. Check HTTP with `curl -i -H 'Host: your-site.example' http://127.0.0.1/` on the VPS; test public DNS and use the existing **Enable HTTPS** flow for public TLS.

PHP versions other than 8.3 and alternate web-server adapters remain explicitly unsupported. PHP site creation refuses to start before a working PHP 8.3-FPM service is detected.

## Node.js website

1. DevOne already uses Node 22; confirm the Agent discovers it.
2. Create **Websites & Files → Node.js 22 application → NGINX**, select domain, and create. This creates a dedicated Linux account, per-site systemd unit and private NGINX loopback reverse proxy. Nothing is started until you supply an application.
3. In the site File Manager upload your actual `server.mjs`. It must listen on `process.env.HOST` (127.0.0.1) and `Number(process.env.PORT)`. The site unit provides `NODE_ENV=production`.
4. Click **Start Node app**. DevOne checks the entry file is a regular site-owned file, enables and starts the systemd service, and reads its state. **Stop Node app** disables and stops that unit. Once started, the site is configured for restart after reboot.
5. Check local NGINX and public DNS. HTTP 502 means the application is not yet listening; inspect Activity & Jobs and the site-specific `systemctl status devone-<site-id>.service` and `journalctl -u devone-<site-id>.service` on the development VPS. Do not expose private environment variables in logs.

Node applications can require code dependencies; a full package/build/Git deployment manager is a separate feature. Uploading one `server.mjs` with the built-in Node HTTP module is a practical first end-to-end acceptance test. No demo application is silently generated.

## Four testing layers

- **Layer 1 — Build/static checks:** TypeScript, React, API, Agent, NGINX template rendering assertions and exact runtime-version validation.
- **Layer 2 — Behavior tests:** Real SiteManager file generation on disposable fixture directories, PHP pool and Node unit contents, site job request persistence, permission denial and failure outcomes.
- **Layer 3 — Live DevOne QA:** Run **QA Center → Run live checks**. Expect **10 checks**, including `agent.site_runtimes`. The runtime check reads the actual PHP pool and Node unit files. It does not claim that an empty site has served an HTTP response.
- **Layer 4 — Ubuntu development VPS:** Install PHP via Software Center, create PHP and Node sites, publish an actual `index.php` and `server.mjs`, test public HTTP/TLS, backend process restart, DNS, privileges, and delete/disable/restore on **disposable test sites only**. Capture sanitized errors for any nonpassing behavior.

## Known limitations

This update does not implement phpMyAdmin installation, MySQL/MariaDB provisioning, WordPress installation, Git builds, Node dependency installation, Python hosting, global WAF enforcement or guaranteed automatic package rollback. The generic Software Center catalog is still an information-only directory; only the explicitly managed host packages have install actions. Don't mistake **View requirements** for **Install**. Security-sensitive services such as phpMyAdmin must not be auto-exposed over HTTP without authentication and correct TLS.

Development CI can pass with an empty PHP or Node application because no sample code is generated. Requiring uploaded source and verifying the actual public response on Lightsail is the final acceptance step. `pnpm qa:release` remains blocked until broader infrastructure, security and legacy parity requirements pass.
