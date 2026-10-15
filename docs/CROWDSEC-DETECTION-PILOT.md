# CrowdSec detection-only signed APT pilot (host acceptance gate)

The first stage of DevOne Security Shield's CrowdSec installation workflow lives at `scripts/crowdsec-detection-pilot.sh`. **It is not invoked from the DevOne dashboard.** It must first be tested on a disposable Ubuntu 24.04 amd64 VPS with the same NGINX build and host resources as production. A user running `--install` is making an explicit privileged package-installation decision; automatic upgrades and WAF blocking remain disabled.

## Prerequisite repository trust

Follow CrowdSec's official manual signed-APT repository instructions at https://docs.crowdsec.net/u/getting_started/installation/linux/ . The script does not download signing keys, execute curl-pipe-shell, edit apt sources, or introduce trusted keys on its own. It expects a root-owned local `/etc/apt/sources.list.d/crowdsec_crowdsec.list` containing exactly this approved `deb` record, and a non-symlink root-owned parseable signing key file:

`deb [signed-by=/etc/apt/keyrings/crowdsec_crowdsec-archive-keyring.gpg] https://packagecloud.io/crowdsec/crowdsec/any any main`

Do not assume that file presence proves the key fingerprint has been independently authenticated. Review vendor-provided key identifiers out of band with the operator and use APT signed metadata. The script requires that APT's selected CrowdSec candidate version exists in the expected packagecloud repository, and refuses candidate/version mismatches. It does not automatically run `apt update` or alter existing package priorities.

## Read-only preflight on a disposable test host

`sudo bash scripts/crowdsec-detection-pilot.sh --check`

Requires Ubuntu 24.04 x86-64, an already valid and running NGINX, the locally configured signed APT repository, the vendor candidate, at least 512 MiB free disk, and successful `apt-get -s` dependency simulation. It rejects package removals or changes to DevOne/NGINX/SSH from the simulation. Read-only mode only produces diagnostics and a temporary restrictive APT simulation output file.

## Explicit detection-only test installation

`sudo bash scripts/crowdsec-detection-pilot.sh --install`

This command must run with an interactive terminal and requires typing `INSTALL DETECTION ONLY`. It installs only the exact selected CrowdSec engine package and required dependencies, then tests NGINX configuration again. It **does not** install an NGINX bouncer, activate firewall rules, start an AppSec inspection proxy, edit managed sites, or make per-site policy changes. APT package postinstall behavior depends on upstream packaging; do not claim complete absence of side effects without verifying it on the disposable host.

After the pilot, confirm `systemctl status crowdsec`, `cscli version`, acquisition configuration, app resource use, and security events in the DevOne dashboard. If the detection engine is installed but logs aren't acquired, the dashboard can still report empty/unknown activity. Do not confuse a CrowdSec decision with a request actually blocked by NGINX.

## Next gated production stages

1. Verify this script and package-origin checks on a disposable VPS.
2. Install/configure an upstream-compatible CrowdSec NGINX remediation component, independently of DevOne's native rate limiter; test with synthetic attack traffic and account for NGINX Lua module compatibility.
3. Test AppSec rule collections in detection mode with per-website attribution and exceptions; exclude the control-panel domain and ACME from blocking.
4. Prove rollback, bouncer/LAPI outage behavior, external proxied client-IP trust, performance and false-positive handling before enabling per-site enforcement or dashboard-install actions.
5. Only then build an Owner-approved background installer similar to the DevOne update worker, with manifest signing, safety preflights, audit history and rollback.

GitHub CI validates script syntax, guardrails and safe defaults. It does **not** execute APT installs, prove vendor key authenticity, or replace live-host operational testing.
