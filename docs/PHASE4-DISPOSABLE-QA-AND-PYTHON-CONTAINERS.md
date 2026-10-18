# Operational Python and container hosting with disposable QA

## Delivered features

**Python 3.12 application:** Dedicated `dvs_<site-id>` Linux account, NGINX private reverse proxy and systemd service. Upload a real `app.py` to the site File Manager; it must run an HTTP server on `HOST=127.0.0.1` and the injected `PORT`. Click **Start application**, then check the domain. The adapter accepts Python 3.12 only; it does not install requirements, manage virtual environments or support arbitrary ASGI/framework launch commands yet.

**Containerized NGINX website:** Installs the Ubuntu `docker.io` engine from the existing Owner-confirmed Software Center. Creates a per-site NGINX virtual host with a loopback proxy to a container. Site files are exposed to the fixed `nginxinc/nginx-unprivileged:stable-alpine` container through a read-only bind mount. The container runs under the site's numeric UID/GID with a read-only filesystem, dropped capabilities, CPU/memory/PID caps, limited temporary mounts and no Docker-socket mount. Upload `index.html` and click **Start application**. This is a **working containerized web hosting adapter**, not general-purpose Docker Compose or arbitrary images.

## Disposable QA application

1. Take a Lightsail snapshot first. This is an **opt-in mutating acceptance test**, never part of the hourly/scheduled read-only QA.
2. Install and verify PHP 8.3 FPM, Redis Server and Docker Engine under **Software Center → Managed Software**. Ubuntu 24.04 typically includes Python 3.12; verify Python's availability before site creation.
3. Open **QA Center → Disposable website and software QA**, sign in as the Owner, enter your password and MFA code (if enabled), tick explicit consent, and click **Run disposable host QA**.
4. The Agent creates six unique domains under `.invalid`, with randomly selected names and distinct site IDs: **static, files, PHP, Node, Python, container**. It writes QA-only source fixtures, starts services where needed, sends real loopback HTTP requests with the selected Host header (or reads the file-only workspace), then requests deletion using the *exact id/domain returned from site creation*. Normal sites are never selected for deletion.
5. For software installation QA, the Agent checks actual installed/running host packages without changing them. It then uses a **throwaway `ubuntu:24.04` Docker container** to install and run PHP CLI, Redis Server and Python 3.12 from Ubuntu's repositories. Docker uses `--rm`; failures trigger an additional exact-name, owner-label-checked cleanup attempt. It never uninstalls Docker, PHP-FPM, Redis or other shared host packages.
6. The UI polls run status and displays the result and cleanup outcome for every test. If a site cannot be removed, its ID remains in the report with a **Needs inspection** result; do not purge unrelated site folders, NGINX configuration, user accounts or containers manually.

**Interruption warning:** If the Agent is killed/restarted mid-run, an in-memory QA run may be interrupted before cleanup. QA-created sites remain in the DevOne registry for explicit inspection and deletion. The runner does not silently sweep other resources on reboot.

## Acceptance scope

GitHub CI verifies compilation, validation, low-level adapter generation, authorization and deterministic create/check/delete behavior against isolated fixture implementations. A green GitHub build does **not** prove all six types actually serve requests on your AWS Lightsail VPS. Only the manual disposable QA result supplies those host-level observations.

The generic CMS catalog remains informational; phpMyAdmin and database provisioning are not completed by this pass. The Docker hosting adapter intentionally does not accept uploaded unreviewed Dockerfile or Compose instructions; adding that safely would require a dedicated permissions, image-signature and environment-isolation design.

After this QA passes, prioritize **DevOne AI**: actionable diagnostics with a deny-by-default command allowlist, step-up authentication, auditable approval, preview/diff, guarded execution, failure recovery and tests against prompt injection. Maintain `pnpm qa:release` blocked until legacy parity, restores, load, TLS and end-to-end host operations are accepted.
