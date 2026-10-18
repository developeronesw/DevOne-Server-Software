#!/usr/bin/env bash
# Phase 2 Software Center: guarded host installation engine.
# The API/Agent may use --managed-install only after Owner password/MFA approval.
# Real package mutations must be tested on a disposable Ubuntu VPS.
set -Eeuo pipefail
umask 077
usage() { echo "Usage: $0 [--check|--install|--managed-install] [php8.3-fpm|redis-server|docker.io]" >&2; exit 2; }
[[ $# -le 2 ]] || usage
mode="${1:---check}"
package="${2:-php8.3-fpm}"
[[ "$mode" == "--check" || "$mode" == "--install" || "$mode" == "--managed-install" ]] || usage
case "$package" in php8.3-fpm|redis-server|docker.io) ;; *) usage ;; esac
[[ "$EUID" -eq 0 ]] || { echo "Run with sudo/root." >&2; exit 2; }
. /etc/os-release
[[ "${ID:-}" == "ubuntu" && "${VERSION_ID:-}" == "24.04" ]] || { echo "Requires Ubuntu 24.04." >&2; exit 2; }
[[ "$(dpkg --print-architecture)" == "amd64" ]] || { echo "Requires amd64." >&2; exit 2; }
# Only one host package mutation pilot may run at a time. Do NOT bypass apt/dpkg locks.
if [[ "$mode" == "--install" || "$mode" == "--managed-install" ]]; then
  exec 9>/run/lock/devone-software-pilot.lock
  flock -n 9 || { echo "Another DevOne pilot is running." >&2; exit 1; }
fi
systemctl is-active --quiet nginx || { echo "NGINX is not active." >&2; exit 1; }
nginx -t >/dev/null 2>&1 || { echo "Invalid NGINX configuration." >&2; exit 1; }
# Do not install if the Agent/API are unhealthy; never restart or replace them.
for unit in devone-api devone-agent; do
  systemctl is-active --quiet "$unit" || { echo "$unit is not active." >&2; exit 1; }
done
free_kb="$(df -Pk / | awk 'NR==2{print $4}')"
[[ "$free_kb" =~ ^[0-9]+$ ]] || { echo "Disk inventory failed." >&2; exit 1; }
(( free_kb >= 524288 )) || { echo "Need at least 512 MiB free disk." >&2; exit 1; }
# Capture APT policy exactly once, before parsing. The old
# apt-cache | awk '...{ print; exit }' pipeline generated SIGPIPE (exit 141)
# under 'set -o pipefail' on hosts with longer policy output, even though the
# Ubuntu candidate was valid and no package operation had begun.
policy="$(apt-cache policy "$package")" || { echo "APT package policy could not be read." >&2; exit 1; }
candidate="$(awk '$1=="Candidate:"{value=$2;found=1} END {if(found)print value;else exit 1}' <<< "$policy")" || { echo "APT candidate could not be identified." >&2; exit 1; }
[[ "$candidate" =~ ^[0-9A-Za-z.+~:-]+$ && "$candidate" != "(none)" ]] || { echo "No valid candidate in current APT metadata." >&2; exit 1; }
# Candidate must have the Ubuntu Noble release origin, never an arbitrary PPA.
# Awk reads a here-string; no producer is killed by an early pipe close.
awk -v version="$candidate" '
  $1 == "***" { active=($2 == version); next }
  $1 ~ /^[0-9][^[:space:]]*$/ && $2 ~ /^[0-9]+$/ { active=($1 == version); next }
  active && $1 == "release" && /(^|,)o=Ubuntu(,|$)/ && /(^|,)n=noble(-updates|-security)?(,|$)/ && /(^|,)l=Ubuntu(,|$)/ { ok=1 }
  END { exit(ok ? 0 : 1) }
' <<< "$policy" || { echo "Candidate is not proven to originate from Ubuntu Noble metadata." >&2; exit 1; }
simulation="$(mktemp /tmp/devone-software-apt.XXXXXXXX)"
trap 'rm -f "$simulation"' EXIT
apt-get -s --no-install-recommends install "$package=$candidate" > "$simulation" || { echo "APT simulation failed; no install attempted." >&2; exit 1; }
if grep -Eq '^Remv |^Inst (nginx([^ ]*)|devone([^ ]*)|openssh-([^ ]*)|systemd([^ ]*)|linux-image([^ ]*)|linux-generic([^ ]*)) ' "$simulation"; then
  echo "APT simulation would remove packages or change protected components." >&2; exit 1
fi
echo "Software Center pilot preflight passed: $package $candidate"
echo "APT: Ubuntu candidate, dependency simulation accepted; no removals."
echo "APT install is allowlisted, origin-checked and audited by the calling DevOne Agent."
if [[ "$mode" == "--check" ]]; then
  echo "READ-ONLY: Nothing installed. Use --install only on a disposable test VPS."
  exit 0
fi
if [[ "$mode" == "--install" ]]; then
  [[ -t 0 ]] || { echo "Interactive console required for manual installation." >&2; exit 1; }
  read -r -p "Type INSTALL $package to proceed: " confirmation
  [[ "$confirmation" == "INSTALL $package" ]] || { echo "Cancelled." >&2; exit 1; }
else
  # Only the authenticated, privileged local Agent can reach this path through
  # the private host endpoint; this script still requires root.
  [[ ! -t 0 ]] || { echo "Managed installs run without an interactive terminal." >&2; exit 1; }
fi
DEBIAN_FRONTEND=noninteractive apt-get -y --no-install-recommends install "$package=$candidate"
nginx -t >/dev/null 2>&1 || { echo "NGINX changed unexpectedly; inspect host. No automatic removal attempted." >&2; exit 1; }
for unit in devone-api devone-agent; do
  systemctl is-active --quiet "$unit" || { echo "$unit is down after install. Manual inspection required." >&2; exit 1; }
done
systemctl is-active --quiet "${package/docker.io/docker}" || { echo "$package is installed but its service is not active; inspect host." >&2; exit 1; }
if [[ "$package" == "redis-server" ]]; then
  redis_listeners="$(ss -ltnH)" || { echo "Unable to validate Redis listening sockets." >&2; exit 1; }
  # Here-string parsing avoids another potential SIGPIPE from grep -q + pipefail.
  if awk '$4 ~ /^(0[.]0[.]0[.]0|\*|\[::\]|::):6379$/ { exposed=1 } END { exit(!exposed) }' <<< "$redis_listeners"; then
    echo "Redis may be exposed on all interfaces; restrict access before continuing." >&2; exit 1
  fi
fi
echo "Managed package installed and service active. Site integration and package-level rollback are separate capabilities."
