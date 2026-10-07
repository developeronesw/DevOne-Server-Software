# DevOne Server Software

DevOne Server Software is a Linux server management platform for Ubuntu 24.04 LTS.

## Project direction

DevOne is designed as a modern, light glass-SaaS control panel that manages the software and services running on a Linux server rather than depending on a particular web server.

### Core stack

- React + TypeScript + Vite 8 — dashboard
- Node.js + TypeScript — API/control plane
- DevOne Agent — privileged, policy-controlled host operations
- pnpm workspaces — monorepo
- SQLite — initial DevOne control-plane state
- systemd — service supervision
- Ubuntu 24.04 LTS x86-64 — initial supported platform

### Managed software

DevOne will progressively support NGINX, Apache, OpenLiteSpeed/LiteSpeed, PHP/PHP-FPM, Node.js, Python, Go, Java, .NET, Ruby, Docker, databases, SSL, DNS, Git deployments, Cloudflare resources, and more.

### Security model

The dashboard/API does not run as root. Privileged host operations are performed by the DevOne Agent through an explicit, validated operation protocol. AI-assisted operations use the same authorization and confirmation boundaries.

## Development phases

1. Foundation & Secure Server Core
2. Server Management & Software Center
3. Web Hosting & Application Management
4. Infrastructure, Databases, Containers & Cloudflare
5. DevOne AI & Platform

See `docs/MASTER-PLAN.md` for acceptance gates. Service management is the first
Phase 2 port; the remaining roadmap is not claimed complete.

The first release is intentionally focused on a reliable fresh Ubuntu installation, core API/Agent boundaries, authentication, health reporting, logging, and the dashboard shell.

## Development

Requirements:

- Ubuntu 24.04 LTS or compatible Linux development environment
- Node.js 22.13+
- pnpm 10+

Install dependencies:

```bash
pnpm install
```

Run checks:

```bash
pnpm check
```

## Repository

Official repository:

https://github.com/developeronesw/DevOne-Server-Software

## Complete legacy distribution

The 0.7.0 cumulative server and applicable hotfixes are bundled in
`distributions/DevOne-Server-0.7.0-All-in-One.zip`. On a **fresh dedicated Ubuntu
24.04 LTS x86-64 VPS**, install with:

```bash
sudo apt-get install unzip
sudo bash installer/install-legacy.sh
```

Open `https://YOUR_SERVER_IP:8443` and run QA Center after installation. Permit
8443 in the provider firewall; hosted websites use 80/443. This installs the
legacy edition, including its original UI. It does not restore customer data.
Do not install over CloudPanel or the Node edition.

The Node edition remains under development. It now has functional sign-in,
logout, authenticated host metrics and allowlisted service controls, but its management modules are not yet
ported. See [the comparison and remaining work](docs/LEGACY-COMPARISON.md).
The fresh Node installer uses the exact clean checkout commit and refuses an
existing installation; automated updates and legacy migration remain pending.

## Conversion scan

[Conversion readiness](docs/CONVERSION-READINESS.md) identifies reusable React
assets, available QA Go source, compiled-only backends, current Node coverage
and pending ports. Run `python3 scripts/scan-legacy.py` for a reproducible static
inventory; it never executes bundled binaries or host installers.

The legacy ZIP is stored as checksum-verified parts because the GitHub upload API
limits large blobs. The legacy installer and verification scripts reassemble it
automatically; alternatively run `python3 scripts/assemble-distribution.py`.

## Jobs and credentials

Service actions now return persistent jobs (HTTP 202) and appear in the dashboard
job history. Owner-only encrypted credential storage is available for upcoming
integrations. See [job and secrets behavior](docs/JOBS-AND-SECRETS.md), including
restart recovery and master-key backup requirements.

## Automated QA

Run `pnpm qa` for the automated regression checks and saved JSON evidence. Run `pnpm qa:release` for the stricter release gate, which remains blocked while unfinished features and VPS verification are pending. See [QA Center](docs/QA-CENTER.md).
