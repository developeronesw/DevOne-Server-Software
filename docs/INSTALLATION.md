# DevOne Server Node edition — fresh VPS installation

**Status:** developer preview. Source/build checks are automated, but a complete live-host release acceptance is not yet verified. Use an expendable clean test VPS, not production or a server with customer data.

## Supported host

- Ubuntu 24.04 LTS, **amd64/x86-64** (systemd)
- Dedicated VPS with no CloudPanel, DevOne legacy edition, or existing Node edition
- Public DNS A/AAAA records for the **control-panel domain** point to the VPS
- Inbound TCP ports **80** and **443** permitted by the provider firewall; outbound HTTPS and apt repository access

## Install

Git is only needed to **obtain** the repository initially. The installer verifies/reinstalls all of its own runtime and OS dependencies after checkout. On a freshly provisioned Ubuntu VPS:

```bash
sudo apt-get update
sudo apt-get install -y git
git clone https://github.com/developeronesw/DevOne-Server-Software.git
cd DevOne-Server-Software
sudo bash installer/install.sh
```

The installer asks **only for the control-panel domain** (or accepts `DEVONE_PANEL_DOMAIN` in the root environment). Owner email/password are **never entered into the terminal**. Once TLS and health checks pass, it prints a **private, single-use HTTPS setup link**. Open that link to complete the three-step browser onboarding: review the server foundation, create the Owner account and enter the dashboard. Keep the link secret; the browser removes the secret from its address bar and history.

This is a **development checkout workflow**. The installer captures the exact Git HEAD commit, deploys that detached commit, and refuses an uncommitted worktree. For production, use a versioned, reviewed release tag/commit after the release acceptance gate passes.

## What the Bash installer provisions automatically

`installer/install-prerequisites.sh` runs before DevOne's system files are created:

- Ubuntu package indexes, certificate authorities, curl and Git
- NGINX HTTP reverse proxy; Certbot and the NGINX Let's Encrypt plugin
- Python 3, OpenSSL, ACLs, util-linux (`flock`), GnuPG, native build tools
- An OS-managed compatible Node.js runtime at `/usr/bin/node` with npm. If Node.js is absent/outdated, configures the HTTPS NodeSource 22.x APT repository with a dedicated GPG keyring and `Signed-By`, then installs Node.js through APT
- Private pinned pnpm **10.15.1** under `/opt/devone/toolchain` (not a global Corepack or pnpm overwrite)

It verifies the binaries and their versions before installing locked Node dependencies and building the API, Agent and React dashboard.

After dependencies, `installer/install.sh` provisions the restricted `devone` service account, folders, credential vault key, local API/Agent services, NGINX configuration, Certbot timer and HTTPS. It generates a one-time setup link for browser-based Owner account creation. The API deletes the setup-token file after successful completion and establishes a secure session.

SQLite is bundled into the Node.js runtime; DevOne does **not** need a separately installed MySQL or SQLite server for its control-plane data.

**Optional** database servers, Docker, PHP and other application runtimes are deliberately not installed by default. They belong in the future managed Software Center. This prevents unnecessary services from occupying memory and ports.

## Verify the installed server

```bash
node --version
/opt/devone/toolchain/node_modules/.bin/pnpm --version
sudo nginx -t
sudo systemctl status nginx devone-api devone-agent certbot.timer
curl -f http://127.0.0.1:8787/api/health
```

Open the **exact one-time HTTPS setup link** displayed by the installer. The browser wizard requires that private token so a stranger cannot register the first Owner. Enter an email and password (12–1024 characters) in the browser and click **Create Owner**. The API immediately signs in the Owner and invalidates the token. Subsequent visits to `https://YOUR_PANEL_DOMAIN` show the login interface. Do not expose the internal API/Agent ports publicly.

If you lose the link before completing setup, log into the VPS and run:

```bash
sudo bash /opt/devone/current/scripts/issue-setup-link.sh
```

The script refuses if an Owner already exists and prints the current single-use link if the server is still unconfigured. On older installations, deploy and build the **new API and dashboard** first, restart `devone-api`, and then run this script. This is not a database reset and must not be used to bypass an existing Owner.

Certbot's initial HTTPS account is registered without an email to keep the terminal domain-only; to receive certificate expiry notifications after setup, set a verified contact:

```bash
sudo certbot update_account --email YOUR_ACTUAL_EMAIL
```


## Installation limitations and recovery

- Installation is **fresh-only**. Existing DevOne installations, CloudPanel and the legacy edition must be deployed on different VPSs. It is not an updater or a migration utility.
- Port conflicts, DNS propagation, firewall rules and ACME/Certbot failures cannot be resolved just by installing prerequisite packages. The installer fails if the certificate or local HTTPS endpoint is not ready; it does not falsely claim web setup is available.
- The installer stops on errors; it does not silently delete or overwrite unrelated websites. A failed partial installation may require operator inspection before retrying, because automatic recovery/upgrade has not been released.
- `pnpm qa` validates isolated development behavior in CI, not real package installation, live TLS issuance, reboot, isolation, or hosting parity. Complete the live-host acceptance checklist before deployment approval.

See `docs/PHASE-1-ACCEPTANCE.md` and `docs/STATIC-HOSTING-ACCEPTANCE.md`.


## In-place updates (existing Node installations)

Do **not** rerun the fresh installer. Once a target commit is reviewed and passes automated GitHub QA, fetch that exact commit, retrieve its updater script, and execute it as root:

```bash
TARGET=REPLACE_WITH_REVIEWED_40_CHARACTER_COMMIT
sudo bash -e -s -- "$TARGET" <<'BASH'
set -euo pipefail
TARGET="$1"
APP=/opt/devone/current
git -C "$APP" fetch origin main
TMP="$(mktemp /root/devone-update.XXXXXX.sh)"
trap 'rm -f "$TMP"' EXIT
git -C "$APP" show "$TARGET:scripts/update-in-place.sh" > "$TMP"
bash "$TMP" "$TARGET"
BASH
```

The updater refuses an unclean worktree, snapshots the live SQLite database and secret configuration in a root-only backup folder, rebuilds the API/Agent/frontend, normalizes **only** generated assets, checks that the unprivileged \`devone\` account can open the API modules, restarts the API/Agent and verifies health. On failure it attempts to restore the previous compiled application files and Git commit; it does **not** automatically replace your live database or encrypted master key.

**Incident fixed:** building with \`umask 077\` created root-only compiled JavaScript (for example \`apps/api/dist/control.js\`), preventing the \`devone\` service from starting. Both fresh installation and updates now set a safe build umask and explicitly validate runtime file access before starting services. The API bundle is root-owned and readable by the \`devone\` group only; frontend assets remain readable by NGINX. The backup directory stays restricted.

GitHub CI catches syntax and permission-policy regressions, but cannot replace real-host verification. Use this updater only with a reviewed commit and a maintenance window. Do not store backups in public web roots.
