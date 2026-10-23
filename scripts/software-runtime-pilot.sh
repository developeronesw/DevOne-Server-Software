#!/usr/bin/env bash
# Phase 2 Software Center: guarded host installation engine.
# The API/Agent may use --managed-install only after Owner password/MFA approval.
# Real package mutations must be tested on a disposable Ubuntu VPS.
set -Eeuo pipefail
umask 077
fail() { local code="$1"; shift; printf >&2 "DEVONE_INSTALL_ERROR:%s\n" "$code"; printf >&2 "%s\n" "$*"; exit 1; }
usage() { echo "Usage: $0 [--check|--install|--managed-install] [php8.3-fpm|redis-server|docker.io|mariadb-server|postgresql]" >&2; exit 2; }
[[ $# -le 2 ]] || usage
mode="${1:---check}"
package="${2:-php8.3-fpm}"
[[ "$mode" == "--check" || "$mode" == "--install" || "$mode" == "--managed-install" ]] || usage
case "$package" in php8.3-fpm|redis-server|docker.io|mariadb-server|postgresql) ;; *) usage ;; esac
[[ "$EUID" -eq 0 ]] || fail "agent_permissions" "Installation requires the privileged DevOne Agent."
. /etc/os-release
[[ "${ID:-}" == "ubuntu" && "${VERSION_ID:-}" == "24.04" ]] || fail "unsupported_ubuntu" "Managed packages require Ubuntu 24.04."
[[ "$(dpkg --print-architecture)" == "amd64" ]] || fail "unsupported_architecture" "Managed packages require amd64."
# Only one host package mutation pilot may run at a time. Do NOT bypass apt/dpkg locks.
if [[ "$mode" == "--install" || "$mode" == "--managed-install" ]]; then
  exec 9>/run/lock/devone-software-pilot.lock
  flock -n 9 || fail "install_lock_busy" "Another DevOne installation is running."
fi
systemctl is-active --quiet nginx || fail "nginx_inactive" "NGINX is not active."
nginx -t >/dev/null 2>&1 || fail "nginx_configuration_invalid" "NGINX configuration validation failed."
# Do not install if the Agent/API are unhealthy; never restart or replace them.
for unit in devone-api devone-agent; do
  systemctl is-active --quiet "$unit" || fail "devone_service_inactive" "Required DevOne service $unit is not active."
done
free_kb="$(df -Pk / | awk 'NR==2{print $4}')"
[[ "$free_kb" =~ ^[0-9]+$ ]] || fail "disk_inventory_failed" "Disk inventory failed."
(( free_kb >= 524288 )) || fail "disk_space_low" "Need at least 512 MiB free disk."
# Capture APT policy exactly once, before parsing. The old
# apt-cache | awk '...{ print; exit }' pipeline generated SIGPIPE (exit 141)
# under 'set -o pipefail' on hosts with longer policy output, even though the
# Ubuntu candidate was valid and no package operation had begun.
# PHP's fixed profile includes the extensions needed by managed WordPress sites.
packages=("$package")
if [[ "$package" == "php8.3-fpm" ]]; then
  packages+=(php8.3-cli php8.3-mysql php8.3-curl php8.3-gd php8.3-mbstring php8.3-xml php8.3-zip php8.3-intl)
fi
install_targets=()
for selected_package in "${packages[@]}"; do
policy="$(apt-cache policy "$selected_package")" || fail "apt_policy_unavailable" "APT package policy could not be read."
candidate="$(awk '$1=="Candidate:"{value=$2;found=1} END {if(found)print value;else exit 1}' <<< "$policy")" || fail "apt_candidate_unavailable" "APT candidate could not be identified."
[[ "$candidate" =~ ^[0-9A-Za-z.+~:-]+$ && "$candidate" != "(none)" ]] || fail "apt_candidate_unavailable" "No valid candidate in current APT metadata."
# Validate the selected candidate against Ubuntu's signed repository metadata.
# apt-cache policy <package> usually prints *only* package versions and source
# URLs (as on Lightsail). Release o=Ubuntu/a=noble-updates metadata is reported
# by the separate no-argument apt-cache policy command. Requiring "release" in
# the package-specific output blocked valid Redis and PHP-FPM packages.
# Match candidate version -> exact repository URI/suite/arch -> Ubuntu release.
candidate_sources="$(awk -v version="$candidate" '
  $1=="***" { active=($2==version); next }
  $1 ~ /^[0-9][^[:space:]]*$/ && $2 ~ /^[0-9]+$/ {active=($1==version); next}
  active && $1 ~ /^[0-9]+$/ && $2 ~ /^https?:\/\// && $5=="Packages" {
    print $2 " " $3 " " $4
  }
' <<< "$policy")"
[[ -n "$candidate_sources" ]] || {
  fail "candidate_sources_unavailable" "The selected package version has no verified repository source."
}
repository_policy="$(apt-cache policy)" || {
  fail "repository_metadata_unavailable" "APT release metadata could not be read."
}
awk -v sources="$candidate_sources" '
  BEGIN {
    count=split(sources,records,"\n")
    for(i=1;i<=count;i++) if(records[i]!="") acceptable[records[i]]=1
  }
  $1 ~ /^[0-9]+$/ && $2 ~ /^https?:\/\// && $5=="Packages" {
    active=($2 " " $3 " " $4 in acceptable)
    next
  }
  active && $1=="release" &&
    /(^|,)o=Ubuntu(,|$)/ &&
    /(^|,)n=noble(-updates|-security)?(,|$)/ &&
    /(^|,)l=Ubuntu(,|$)/ {matched=1}
  END {exit(matched?0:1)}
' <<< "$repository_policy" || {
  fail "repository_origin_unverified" "APT candidate cannot be linked to signed Ubuntu Noble release metadata."
}
install_targets+=("$selected_package=$candidate")
done
simulation="$(mktemp /tmp/devone-software-apt.XXXXXXXX)"
trap 'rm -f "$simulation"' EXIT
apt-get -s --no-install-recommends install "${install_targets[@]}" > "$simulation" || fail "apt_simulation_failed" "APT dependency simulation failed; nothing installed."
if grep -Eq '^Remv |^Inst (nginx([^ ]*)|devone([^ ]*)|openssh-([^ ]*)|systemd([^ ]*)|linux-image([^ ]*)|linux-generic([^ ]*)) ' "$simulation"; then
  fail "protected_package_change" "APT would remove packages or alter protected components."
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
DEBIAN_FRONTEND=noninteractive apt-get -y --no-install-recommends install "${install_targets[@]}" || fail "apt_transaction_failed" "APT installation failed. Inspect apt logs and package state before retry."
nginx -t >/dev/null 2>&1 || fail "nginx_postcheck_failed" "NGINX validation failed following APT. No automatic removal attempted."
for unit in devone-api devone-agent; do
  systemctl is-active --quiet "$unit" || fail "devone_postcheck_failed" "Required DevOne service went down during installation."
done
service="$package"
[[ "$package" != "docker.io" ]] || service=docker
[[ "$package" != "mariadb-server" ]] || service=mariadb
systemctl is-active --quiet "$service" || fail "package_service_inactive" "Installed package service is not active."
if [[ "$package" == "redis-server" ]]; then
  redis_listeners="$(ss -ltnH)" || fail "redis_socket_check_failed" "Unable to validate Redis listening sockets."
  # Here-string parsing avoids another potential SIGPIPE from grep -q + pipefail.
  if awk '$4 ~ /^(0[.]0[.]0[.]0|\*|\[::\]|::):6379$/ { exposed=1 } END { exit(!exposed) }' <<< "$redis_listeners"; then
    fail "redis_exposed" "Redis is listening on a public interface; restrict access."
  fi
fi
if [[ "$package" == "mariadb-server" || "$package" == "postgresql" ]]; then
  database_port=3306
  [[ "$package" != "postgresql" ]] || database_port=5432
  database_listeners="$(ss -ltnH)" || fail "database_socket_check_failed" "Unable to inspect database listening sockets."
  if awk -v port="$database_port" '$4 ~ ":"port"$" && $4 !~ /^127[.]/ && $4 !~ /^\[::1\]:/ && $4 !~ /^::1:/ { exposed=1 } END {exit(!exposed)}' <<< "$database_listeners"; then
    fail "database_exposed" "Database is listening outside loopback. Review its network configuration before use."
  fi
fi
echo "Managed package installed and service active. Site integration and package-level rollback are separate capabilities."
