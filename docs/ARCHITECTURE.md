# DevOne Server Architecture

## Principles

1. DevOne is management software, not a web server.
2. The API/dashboard must not run as root.
3. Privileged operations go through the DevOne Agent.
4. Every privileged operation is explicit, validated, authorized, logged, and auditable.
5. AI uses the same operation boundary as a human administrator.
6. NGINX is the default managed web server but is not a hard dependency of the DevOne control plane.
7. Ubuntu 24.04 LTS x86-64 is the initial supported host.
8. The first installation must be safe to repeat and must preserve existing host data unless an explicit destructive operation is confirmed.

## Control plane

```
Browser
  |
  v
React/Vite Dashboard
  |
  v
Node.js API
  |
  +--> Auth / RBAC
  +--> Jobs
  +--> Secrets
  +--> Audit
  |
  v
DevOne Agent
  |
  +--> systemd
  +--> package manager
  +--> web servers
  +--> runtimes
  +--> databases
  +--> containers
  +--> networking
```

## Web server model

DevOne manages web servers as installable host components:

- NGINX
- Apache
- OpenLiteSpeed
- LiteSpeed Enterprise where licensing/install requirements permit

DevOne itself must remain usable without any of those installed.

## AI model

DevOne AI initially targets Google Gemini 3.5 Flash-Lite. Credentials are configured by the administrator through the dashboard and stored in the encrypted DevOne secrets system. AI-generated mutations require explicit confirmation during the initial release.

## Multi-server readiness

The Agent protocol is designed as a separate boundary so a future DevOne control plane can manage multiple hosts without rewriting the dashboard/API domain model.
