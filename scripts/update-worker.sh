#!/usr/bin/env bash
# Root-owned, systemd-launched updater. Never accepts URLs or shell fragments.
set -Eeuo pipefail
umask 077
TARGET="${1:-}"
[[ "$EUID" -eq 0 && "$TARGET" =~ ^[0-9a-f]{40}$ ]] || exit 2
STATE=/var/lib/devone-agent/update-status.json
LOG=/var/log/devone/update-worker.log
mkdir -p /var/lib/devone-agent /var/log/devone
chmod 700 /var/lib/devone-agent
write_state() {
  local phase="$1" updated tmp
  updated="$(date -u '+%Y-%m-%dT%H:%M:%SZ')"
  tmp="$(mktemp /var/lib/devone-agent/update-status.XXXXXXXX)"
  printf '{"state":"%s","target":"%s","updatedAt":"%s"}\n' "$phase" "$TARGET" "$updated" > "$tmp"
  chmod 600 "$tmp"
  mv -f "$tmp" "$STATE"
}
write_state running
fail_status(){
  local rc=$?
  trap - EXIT
  if [[ "$rc" -ne 0 ]]; then write_state failed; fi
  exit "$rc"
}
trap fail_status EXIT
# The update script is trusted from the local root-owned checkout. It independently
# checks clean tree, GitHub ancestry, backups, runtime permissions and health.
# The output stays root-only; credentials and shell details are never sent to the browser.
if ! /usr/bin/bash /opt/devone/current/scripts/update-in-place.sh "$TARGET" >> "$LOG" 2>&1; then
  write_state failed
  exit 1
fi
write_state succeeded
