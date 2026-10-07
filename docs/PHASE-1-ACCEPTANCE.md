# Phase 1 Acceptance

Phase 1 is complete only when the following are verified.

## Automated
- Node.js 22.13+ toolchain installs.
- TypeScript check passes.
- Dashboard builds.
- API builds.
- Agent builds.
- Tests pass.
- Installer passes shell syntax validation.
- NGINX and systemd deployment assets exist.

## Fresh Ubuntu 24.04 acceptance
1. Install on clean Ubuntu 24.04 amd64.
2. Installer installs Node.js automatically.
3. Installer creates the `devone` service account and persistent directories.
4. Installer creates API, Agent and NGINX systemd/configuration.
5. API listens only on 127.0.0.1.
6. Agent listens only on 127.0.0.1 and requires its bearer token.
7. Owner setup creates the first account and then permanently closes public setup.
8. Login creates an HttpOnly/Secure/SameSite session.
9. Dashboard is reachable at the configured HTTPS domain.
10. HTTP redirects to HTTPS.
11. API health and authenticated system status work.
12. API and Agent survive service restart.
13. Reboot restores the services.
14. No secrets are committed to Git.

The GitHub CI job validates source/build/install-script checks. A clean VPS is required for the final OS-level acceptance gate; CI must not be represented as a substitute for that test.
