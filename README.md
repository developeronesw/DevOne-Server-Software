# DevOne Server Software

DevOne Server Software is a Linux server management platform for Ubuntu 24.04 LTS.

## Project direction

DevOne is designed as a modern, light glass-SaaS control panel that manages the software and services running on a Linux server rather than depending on a particular web server.

### Core stack

- React + TypeScript + Vite — dashboard
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

1. Foundation
2. Server Management
3. Web Hosting
4. Software & Frameworks
5. Databases
6. Containers
7. Deployment
8. Cloudflare
9. DevOne AI
10. Hosting Platform

The first release is intentionally focused on a reliable fresh Ubuntu installation, core API/Agent boundaries, authentication, health reporting, logging, and the dashboard shell.

## Development

Requirements:

- Ubuntu 24.04 LTS or compatible Linux development environment
- Node.js 22+
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
