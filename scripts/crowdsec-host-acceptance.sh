#!/usr/bin/env bash
# Security Center: read-only CrowdSec detection-engine host acceptance checks.
# NOT a WAF/AppSec or blocked-request verification.
set -Eeuo pipefail
[[ $# -eq 0 || ( $# -eq 1 && "$1" == "--check" ) ]] || { echo "Usage: $0 [--check]" >&2; exit 2; }
[[ "$EUID" -eq 0 ]] || { echo "Run as root on a disposable test VPS." >&2; exit 2; }
. /etc/os-release
[[ "${ID:-}" == "ubuntu" && "${VERSION_ID:-}" == "24.04" ]] || { echo "Unsupported host." >&2; exit 2; }
[[ "$(dpkg --print-architecture)" == "amd64" ]] || { echo "Requires x86-64." >&2; exit 2; }
failures=0
check() {
  local label="$1"; shift
  if "$@" >/dev/null 2>&1; then echo "PASS: $label"; else echo "BLOCKED: $label"; failures=$((failures+1)); fi
}
check 'NGINX running' systemctl is-active --quiet nginx
check 'NGINX valid configuration' nginx -t
check 'DevOne API running' systemctl is-active --quiet devone-api
check 'DevOne Agent running' systemctl is-active --quiet devone-agent
crowdsec_installed() { [[ "$(dpkg-query -W -f='${Status}' crowdsec 2>/dev/null)" == 'install ok installed' ]]; }
check 'CrowdSec package installed' crowdsec_installed
check 'CrowdSec engine running' systemctl is-active --quiet crowdsec
check 'CrowdSec CLI available' command -v cscli
check 'CrowdSec CLI responding' cscli version
# A readable file does not prove it is correctly configured or that events arrive.
if [[ -d /etc/crowdsec/acquis.d ]] && find /etc/crowdsec/acquis.d -maxdepth 1 -type f \( -name '*.yaml' -o -name '*.yml' \) -print -quit | grep -q .; then
  echo 'INFO: Acquisition configuration files exist; log processing NOT verified.'
elif [[ -f /etc/crowdsec/acquis.yaml ]]; then
  echo 'INFO: Acquisition file exists; log processing NOT verified.'
else
  echo 'BLOCKED: No acquisition configuration file found.'
  failures=$((failures+1))
fi
echo 'NOT VERIFIED: NGINX bouncer, AppSec inspection, client-IP trust, attack detection, blocking, false positives and rollback.'
if (( failures > 0 )); then
  echo "BLOCKED: $failures engine prerequisites failed; do not enable enforcement."
  exit 1
fi
echo 'ENGINE BASELINE PASS: Detection events and WAF protection still require independent, live evidence.'
