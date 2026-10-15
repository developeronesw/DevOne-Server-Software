#!/usr/bin/env bash
# In-place update for an existing single-server DevOne Node installation.
# Does NOT run the fresh installer, reset the Owner or replace the live database.
set -Eeuo pipefail
[[ "$EUID" -eq 0 ]] || { echo "Run the updater with sudo/root." >&2; exit 1; }
umask 022
APP=/opt/devone/current
PNPM=/opt/devone/toolchain/node_modules/.bin/pnpm
DB=/var/lib/devone/devone.sqlite
TARGET="$1"
[[ "$TARGET" =~ ^[a-f0-9]{40}$ ]] || { echo "Usage: sudo bash update-in-place.sh <40-character approved commit SHA>" >&2; exit 1; }
[[ -d "$APP/.git" && -x "$PNPM" && -f "$DB" ]] || { echo "DevOne installation or toolchain missing." >&2; exit 1; }
[[ -f /etc/devone/devone.env && -f /etc/devone/secrets.key ]] || { echo "DevOne configuration missing." >&2; exit 1; }
[[ -z "$(git -C "$APP" status --porcelain)" ]] || { echo "Local source changes detected; refusing to overwrite them." >&2; exit 1; }
if ! /usr/bin/node --input-type=module -e 'import {backup} from "node:sqlite"; if(typeof backup!=="function")process.exit(1)' >/dev/null 2>&1; then
  echo "Node.js 22.16 or newer, with SQLite backup(), is required." >&2
  exit 1
fi

# A single maintenance operation at a time; flock remains held until the script exits.
exec 9>/var/lock/devone-update.lock
flock -n 9 || { echo "Another DevOne update is already running." >&2; exit 1; }
PREVIOUS="$(git -C "$APP" rev-parse HEAD)"
if [[ "$PREVIOUS" == "$TARGET" ]]; then
  echo "Already running the requested Git revision. Validating compiled-file permissions."
  bash "$APP/scripts/prepare-runtime-files.sh"
  exit 0
fi
cd "$APP"
git fetch origin main
git cat-file -e "$TARGET^{commit}"
git merge-base --is-ancestor "$TARGET" origin/main || { echo "Target is not in origin/main history." >&2; exit 1; }

# A restricted backup includes the SQLite snapshot, vault key and previous binaries.
BACKUP="/opt/devone/update-backup-$(date +%Y%m%d-%H%M%S)"
mkdir -m 700 "$BACKUP"
printf '%s\n' "$PREVIOUS" > "$BACKUP/previous-commit"
cp -a apps/api/dist "$BACKUP/api-dist"
cp -a agent/dist "$BACKUP/agent-dist"
cp -a apps/dashboard/dist "$BACKUP/dashboard-dist"
cp -a /etc/devone/devone.env "$BACKUP/devone.env"
cp -a /etc/devone/secrets.key "$BACKUP/secrets.key"
if [[ -f /usr/local/lib/devone/update-worker.sh ]]; then
  cp -a /usr/local/lib/devone/update-worker.sh "$BACKUP/update-worker.sh"
fi
python3 - "$DB" "$BACKUP/devone.sqlite" <<'PY'
import sqlite3,sys
src=sqlite3.connect("file:"+sys.argv[1]+"?mode=ro",uri=True)
dst=sqlite3.connect(sys.argv[2])
src.backup(dst)
integrity=dst.execute("PRAGMA integrity_check").fetchone()[0]
dst.close()
src.close()
if integrity!="ok":
    raise SystemExit("SQLite backup integrity check failed.")
print("Database backup verified.")
PY
chmod 600 "$BACKUP/devone.sqlite"
echo "Restricted backup: $BACKUP"

ROLLBACK_REQUIRED=1
rollback(){
  local exit_code=$?
  trap - ERR
  if [[ "$ROLLBACK_REQUIRED" -eq 0 ]]; then return "$exit_code"; fi
  echo "Update failed. Restoring previous compiled applications." >&2
  systemctl stop devone-api devone-agent || true
  git checkout --detach "$PREVIOUS" || true
  rm -rf apps/api/dist agent/dist apps/dashboard/dist
  cp -a "$BACKUP/api-dist" apps/api/dist
  cp -a "$BACKUP/agent-dist" agent/dist
  cp -a "$BACKUP/dashboard-dist" apps/dashboard/dist
  if [[ -f "$BACKUP/update-worker.sh" ]]; then
    install -D -o root -g root -m 700 "$BACKUP/update-worker.sh" /usr/local/lib/devone/update-worker.sh.restore
    mv -f /usr/local/lib/devone/update-worker.sh.restore /usr/local/lib/devone/update-worker.sh
  else
    rm -f /usr/local/lib/devone/update-worker.sh
  fi
  bash "$APP/scripts/prepare-runtime-files.sh" || true
  systemctl reset-failed devone-api devone-agent || true
  systemctl restart devone-agent devone-api || true
  echo "Previous application files restored. Database/configuration left unchanged." >&2
  return "$exit_code"
}
trap rollback ERR

git checkout --detach "$TARGET"
"$PNPM" install --frozen-lockfile
"$PNPM" --filter @devone/api build
"$PNPM" --filter @devone/agent build
"$PNPM" --filter @devone/dashboard build

# This is the EACCES regression fix: the default umask must not make JS unreadable.
bash "$APP/scripts/prepare-runtime-files.sh"
# Atomically install a root-owned worker, so an already running worker retains its inode.
install -D -o root -g root -m 700 "$APP/scripts/update-worker.sh" /usr/local/lib/devone/update-worker.sh.next
mv -f /usr/local/lib/devone/update-worker.sh.next /usr/local/lib/devone/update-worker.sh

systemctl restart devone-agent
systemctl restart devone-api

# Start service health checks only after building and checking runtime access.
OK=0
for try_number in $(seq 1 30); do
  if curl -fsS --max-time 2 http://127.0.0.1:8787/api/health >/dev/null 2>&1 \
    && systemctl is-active --quiet devone-api \
    && systemctl is-active --quiet devone-agent; then
    OK=1
    break
  fi
  sleep 1
done
[[ "$OK" -eq 1 ]] || { echo "API or Agent did not become healthy. Check journalctl." >&2; false; }
HTTP_CODE="$(curl -sS --max-time 3 -o /dev/null -w '%{http_code}' http://127.0.0.1:8787/api/qa)"
[[ "$HTTP_CODE" == "401" ]] || { echo "Authenticated QA endpoint check failed (HTTP $HTTP_CODE)." >&2; false; }
ROLLBACK_REQUIRED=0
trap - ERR
echo "==========================================="
echo "DevOne updated successfully."
echo "Commit: $(git rev-parse --short HEAD)"
echo "Backup: $BACKUP"
echo "API + Agent healthy. QA endpoint protected."
echo "==========================================="
