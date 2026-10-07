# DevOne Server Software — Five-Phase Master Plan

Status: LOCKED ROADMAP — FULL LEGACY FEATURE PARITY REQUIRED
Target: Ubuntu 24.04 LTS x86-64
Stack: Node.js + TypeScript + React + Vite + pnpm

## Phase 1 — Foundation & Secure Server Core
- Idempotent Ubuntu 24.04 installer and preflight
- DevOne service identity and filesystem layout
- Node API and React/Vite dashboard
- Privileged Agent boundary
- SQLite control-plane database
- Authentication, sessions and RBAC
- Encrypted secrets
- Jobs engine and audit logging
- Health/host metrics
- systemd services
- Production build and verification
- Light Glass UI foundation
Exit gate: fresh Ubuntu installs DevOne, authenticates, reports host health, runs a validated Agent job and records the operation.

## Phase 2 — Server Management & Software Center
- Server overview and monitoring
- systemd service management
- apt/package management
- Software Center
- NGINX, Apache, OpenLiteSpeed and licensed LiteSpeed support where applicable
- PHP/PHP-FPM versions
- Node.js, Python, Go, Java, Ruby and .NET runtimes
- Composer, Git and developer tools
- File Manager
- Guarded authenticated terminal
- Logs and diagnostics
Exit gate: DevOne can safely discover, install, configure, start, stop, restart and inspect managed software without an unrestricted root API.

## Phase 3 — Web Hosting & Application Management
- Websites, domains, aliases and subdomains
- Web-server adapters
- PHP sites and PHP-FPM pools
- Node applications
- Python applications
- SSL/Let's Encrypt
- Environment variables and encrypted secrets
- Git deployments
- Deployment history
- Health checks and rollback foundations
Exit gate: create a website/application, attach a domain, configure its runtime/web server, issue SSL and serve it successfully.

## Phase 4 — Infrastructure, Databases, Containers & Cloudflare
- PostgreSQL
- MySQL/MariaDB
- Redis
- Database users, permissions and credentials
- Backups and restores
- Docker/Compose
- Container/image/volume/network management
- Container security validation
- Cloudflare integration
- Existing-infrastructure discovery
- Server configuration backups and recovery
Exit gate: manage a realistic VPS containing websites, runtimes, databases, containers and optional Cloudflare integration.

## Phase 5 — DevOne AI & Platform
- Gemini integration
- Encrypted AI credentials configured from dashboard
- Read-only AI diagnostics
- AI tool/operation boundary
- Confirmation before mutations
- AI troubleshooting
- Multi-server Agent enrollment
- Hosting/provider capabilities
- Customer/resource isolation foundations
- Release/update/rollback system
- Production hardening and final regression
Exit gate: DevOne Server 1.0 operates as a production-grade Linux control plane with AI assistance and controlled recoverable releases.

## Non-negotiable rules
1. Dashboard/API never runs as root.
2. Privileged work goes through the DevOne Agent.
3. No unrestricted shell endpoint.
4. Privileged operations are explicit, validated, authorized and audited.
5. AI uses the same operation boundary.
6. Mutating AI actions require confirmation initially.
7. NGINX is a managed/default web server, not a DevOne dependency.
8. Cloudflare is optional.
9. Existing software is discovered before destructive replacement.
10. Install/update operations preserve user data unless explicitly confirmed otherwise.
11. Production uses a pinned release, not a moving Git branch.
12. GitHub pushes do not automatically change production.

## Legacy replacement acceptance
The Node edition must replace all functional capabilities of the cumulative 0.7.0 legacy release and its hotfixes before it is presented as the finished replacement. Foundation installation alone is not the acceptance target. Each legacy workflow needs a working backend, UI, authorization checks, automated acceptance evidence and target-VPS verification. See CONVERSION-READINESS.md for the category inventory and LEGACY-SCAN.json for observed route evidence. Security boundaries remain mandatory; administration workflows must be reproduced without introducing an unrestricted root API.

Performance improvement requires comparable measurements against the legacy release on equivalent hardware and workloads. Passing build/regression checks does not prove faster performance. Production acceptance includes full parity, measured performance, design verification and recovery tests before publication.

## Completion standard
A phase is complete only after automated checks, build, security checks, required installation/runtime tests, acceptance tests, documentation review and Git verification all pass.

## Production flow
development -> phase branch -> main -> release candidate -> QA -> versioned tag -> explicit production approval -> production update

Production must not blindly git pull or continuously track main.