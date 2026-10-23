# DevOne CMS local preview installation

Owners can select **DevOne CMS · preview** in Websites & files → Install an app, then choose a new domain or an empty, stopped Node.js 22 website. A title, administrator email, explicit approval and Owner password/MFA are required. This installs **2.0.0-alpha.4**, the existing single-site CMS foundation. It does not certify all CMS modules, commercial/network features or a stable CMS release.

The target receives a prebuilt Node runtime and dashboard, migrations and license notices. SQLite is this CMS's local database adapter; it does not provision a MariaDB/PostgreSQL account or Cloudflare resources. Existing DevOne Server Node prerequisites supply the runtime. The VPS does not run npm, download dependencies or build the CMS.

## Reviewed package

- Source: `developeronesw/DevOneCMS-v2` main-derived commit `76170ee10e59f1f8fc772951b6796a57a122ed14`.
- Build: `npm ci --ignore-scripts`, `npm run build:local`, `python3 scripts/package-local.py <output>`.
- Bundled artifact: `distributions/devone-cms-local/2.0.0-alpha.4.tar.gz` (109,166 bytes).
- SHA-256: `cd546994daccae82e3e4d4bcda10328291f51c26bf3573ead47d059968d07528`.

The package is carried by the reviewed DevOne Server checkout and verified again after dropping to the site's OS identity. This recorded digest is not a separate vendor signature. CI rebuilds the exact pinned CMS commit using the lockfile and compares the resulting package byte-for-byte. The archive contains only code/assets, migrations, source/version metadata and license notices; host data, keys and developer credentials are excluded.

## Installation and recovery

A durable job stores only the installation identifier. The generated `devone_admin` password is encrypted in the control Vault and supplied to the worker over stdin. The worker clears supplementary groups and switches UID/GID before extracting or executing CMS code. The offline initializer creates the administrator, site, SQLite database and per-installation encryption key before the public service starts. Production web setup and its SMTP probes are disabled.

Content is staged outside the public tree, then published into the previously empty document root. Private data lives in `/home/devone-sites/<siteId>/data`, outside `public`, with mode 0700 directories and 0600 SQLite/key files. The Node service's managed write paths include this data directory. The CMS HTTP server serves only its built `web` assets and APIs, never runtime source, SQLite or keys.

The installer refuses nonempty sites, existing private data, running runtimes, replayed IDs and customized service units. It changes only the exact expected managed unit, starts the site's isolated Node process, verifies the CMS version/initialized site domain, and checks NGINX routing. Failed setup or health checks preserve private data and staged code, restore the original empty document root when possible, stop the failed service and retain inspection state. It never recursively deletes unknown data or automatically replays an unknown outcome.

Point DNS at the server and issue HTTPS through Websites & files before revealing credentials. Reveal requires fresh Owner password/MFA and an HTTPS-enabled ready site; the dashboard hides the password after one minute or a target change. Production CMS requests use Secure/HttpOnly cookies, HTTPS/same-origin mutation checks, CSRF tokens and login throttling. Local production password hashing uses 600,000 PBKDF2-SHA-256 iterations; the separate Cloudflare Free policy is retained. Existing owned local data permissions tighten without replacing keys or database contents; invalid/linked files fail closed.

This is an initial generated login: changing the administrator password inside the CMS does not update the control Vault. Domain migration, app version upgrades/rollback, media publishing acceptance, full CMS browser/module acceptance and backups/restores remain separate work. DevOne Server updates include the installer/package and API table migration; they do not overwrite existing CMS instances or their data. AI-local step-up support for this operation remains open.

## QA scope

CMS source CI runs type checks, existing core/auth/license tests, Cloudflare and local builds, and a production-package test covering initialization, login, static assets, private-path denial, CSRF, data persistence and invalid-key handling.

DevOne Server adds Owner/origin/confirmation/vault/idempotency/job authorization and staged failure/unit/data-preservation regressions. The disposable Ubuntu container adds eight real CMS checks: new site and NGINX routing; private state/source isolation; real administrator login/secure cookies; setup/origin/CSRF protection; service restart/data/session persistence; an existing empty Node site; nonempty/replay protection; and failed-health recovery. Actual Node processes run as the site's Linux user. Service-manager commands are adapted in this container; systemd hardening/reboot, public DNS/ACME, rendered browser workflows and target-VPS performance remain unverified.

All CMS, WordPress and SQL container state is removed with the exact temporary container/image. No spare VPS is required for these isolated tests, and the user's current VPS is not accessed or reset. Full phase and stable-release gates remain open.
