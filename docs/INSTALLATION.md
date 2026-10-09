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

The installer prompts for the control-panel domain, the initial Owner email and a password (12+ characters). You can also supply `DEVONE_PANEL_DOMAIN`, `DEVONE_ADMIN_EMAIL`, and `DEVONE_ADMIN_PASSWORD` in the root process environment, but avoid putting passwords in command lines or shell history.

This is a **development checkout workflow**. The installer captures the exact Git HEAD commit, deploys that detached commit, and refuses an uncommitted worktree. For production, use a versioned, reviewed release tag/commit after the release acceptance gate passes.

## What the Bash installer provisions automatically

`installer/install-prerequisites.sh` runs before DevOne's system files are created:

- Ubuntu package indexes, certificate authorities, curl and Git
- NGINX HTTP reverse proxy; Certbot and the NGINX Let's Encrypt plugin
- Python 3, OpenSSL, ACLs, util-linux (`flock`), GnuPG, native build tools
- An OS-managed compatible Node.js runtime at `/usr/bin/node` with npm. If Node.js is absent/outdated, configures the HTTPS NodeSource 22.x APT repository with a dedicated GPG keyring and `Signed-By`, then installs Node.js through APT
- Private pinned pnpm **10.15.1** under `/opt/devone/toolchain` (not a global Corepack or pnpm overwrite)

It verifies the binaries and their versions before installing locked Node dependencies and building the API, Agent and React dashboard.

After dependencies, `installer/install.sh` provisions the restricted `devone` service account, folders, credential vault key, local API/Agent services, NGINX configuration, Certbot timer and HTTPS. It creates the Owner account and removes the one-time setup token.

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

Open `https://YOUR_PANEL_DOMAIN` and sign in with the Owner account. Do not expose the internal API/Agent ports publicly.

## Installation limitations and recovery

- Installation is **fresh-only**. Existing DevOne installations, CloudPanel and the legacy edition must be deployed on different VPSs. It is not an updater or a migration utility.
- Port conflicts, DNS propagation, firewall rules and ACME/Certbot failures cannot be resolved just by installing prerequisite packages.
- The installer stops on errors; it does not silently delete or overwrite unrelated websites. A failed partial installation may require operator inspection before retrying, because automatic recovery/upgrade has not been released.
- `pnpm qa` validates isolated development behavior in CI, not real package installation, live TLS issuance, reboot, isolation, or hosting parity. Complete the live-host acceptance checklist before deployment approval.

See `docs/PHASE-1-ACCEPTANCE.md` and `docs/STATIC-HOSTING-ACCEPTANCE.md`.
