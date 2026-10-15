#!/usr/bin/env bash
# CrowdSec Security Engine pilot. NO WAF, bouncer, firewall or NGINX edits.
# --check is read-only. --install requires typed, interactive confirmation.
set -Eeuo pipefail
umask 077
mode="--check"
if [[ "$#" -eq 1 ]]; then mode="$1"; fi
[[ $# -le 1 && ( "$mode" == "--check" || "$mode" == "--install" ) ]] || { echo "Usage: $0 [--check|--install]" >&2; exit 2; }
[[ "$EUID" -eq 0 ]] || { echo "Run with sudo/root." >&2; exit 2; }
[[ -f /etc/os-release ]] || { echo "Unsupported host" >&2; exit 2; }
. /etc/os-release
[[ "$ID" == "ubuntu" && "$VERSION_ID" == "24.04" ]] || { echo "Pilot only supports Ubuntu 24.04" >&2; exit 2; }
[[ "$(dpkg --print-architecture)" == "amd64" ]] || { echo "Pilot only supports x86-64" >&2; exit 2; }

if [[ "$mode" == "--install" ]]; then
  exec 9>/run/lock/devone-crowdsec-pilot.lock
  flock -n 9 || { echo "CrowdSec pilot is already running." >&2; exit 1; }
fi

# A manually trusted apt repository must ALREADY be configured. Never pipe
# remote scripts into a privileged shell or trust an unpinned HTTP source.
repo_file=/etc/apt/sources.list.d/crowdsec_crowdsec.list
key_file=/etc/apt/keyrings/crowdsec_crowdsec-archive-keyring.gpg
expected="deb [signed-by=$key_file] https://packagecloud.io/crowdsec/crowdsec/any any main"
[[ -f "$repo_file" && ! -L "$repo_file" ]] || { echo "Official signed CrowdSec apt source not configured. Follow official manual repository instructions." >&2; exit 1; }
[[ "$(stat -c '%u' "$repo_file")" == "0" ]] || { echo "Repository file must be root-owned." >&2; exit 1; }
grep -Fxq "$expected" "$repo_file" || { echo "Expected signed-by CrowdSec source not found." >&2; exit 1; }
[[ -f "$key_file" && ! -L "$key_file" ]] || { echo "CrowdSec signing key file missing/unsafe." >&2; exit 1; }
[[ "$(stat -c '%u' "$key_file")" == "0" ]] || { echo "CrowdSec key must be root-owned." >&2; exit 1; }
command -v gpg >/dev/null && gpg --quiet --show-keys "$key_file" >/dev/null 2>&1 || { echo "Signing key is unreadable or invalid." >&2; exit 1; }

candidate="$(apt-cache policy crowdsec | awk '/^[[:space:]]*Candidate:/{print $2;exit}')"
[[ -n "$candidate" && "$candidate" != "(none)" && "$candidate" =~ ^[a-zA-Z0-9._+~:-]+$ ]] || { echo "No valid CrowdSec candidate; update apt indexes using official instructions." >&2; exit 1; }
# Require the CANDIDATE version itself to appear in the official vendor
# repository, not merely some older vendor version.
apt-cache madison crowdsec | awk -F '|' -v candidate="$candidate" '
  {v=$2;gsub(/[[:space:]]/,"",v);if(v==candidate && $3 ~ /https:\/\/packagecloud.io\/crowdsec\/crowdsec\/any/) trusted=1}
  END {exit(trusted ? 0 : 1)}
' || { echo "APT candidate is not confirmed from the CrowdSec vendor source. Review apt pin priorities." >&2; exit 1; }

[[ "$(systemctl is-active nginx || true)" == "active" ]] || { echo "NGINX must already be active." >&2; exit 1; }
nginx -t >/dev/null 2>&1 || { echo "Existing NGINX config invalid; do not install." >&2; exit 1; }
# Hard floor for small VPS pilot; check actual capacity before production use.
available_kb="$(df -Pk / | awk 'NR==2 {print $4}')"
[[ "$available_kb" =~ ^[0-9]+$ && "$available_kb" -ge 524288 ]] || { echo "Need >= 512 MiB available disk." >&2; exit 1; }
simulate="$(mktemp /tmp/devone-crowdsec-apt.XXXXXXXX)"
trap 'rm -f "$simulate"' EXIT
apt-get -s --no-install-recommends install "crowdsec=$candidate" > "$simulate" || { echo "APT dependency simulation failed." >&2; exit 1; }
if grep -Eq '^(Remv|Inst (nginx|devone|openssh-server) )' "$simulate"; then
  echo "APT simulation includes removing packages or changing panel/SSH components. Aborted." >&2
  exit 1
fi
echo "Detection-only pilot preflight passed."
echo "Candidate: $candidate"
echo "Repo: Signed CrowdSec packagecloud source (locally configured)"
echo "NGINX: Active and nginx -t passed"
echo "Automatic installs: OFF. NGINX bouncer: NOT installed. AppSec: NOT installed."
if [[ "$mode" == "--check" ]]; then
  echo "No system changes were made. To pilot on a disposable host, run --install with confirmation."
  exit 0
fi
[[ -t 0 ]] || { echo "Interactive terminal required for install." >&2; exit 1; }
read -r -p "Type INSTALL DETECTION ONLY to proceed: " confirmation
[[ "$confirmation" == "INSTALL DETECTION ONLY" ]] || { echo "Cancelled." >&2; exit 1; }
DEBIAN_FRONTEND=noninteractive apt-get -y --no-install-recommends install "crowdsec=$candidate"
nginx -t >/dev/null 2>&1 || { echo "NGINX became invalid. Investigate immediately." >&2; exit 1; }
echo "CrowdSec engine package installed. Verify engine state and log acquisition separately."
echo "No NGINX remediation component, AppSec rules or IP blocking was installed by this script."
