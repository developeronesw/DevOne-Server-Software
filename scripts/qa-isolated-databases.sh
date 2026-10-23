#!/usr/bin/env bash
# Disposable local/CI Docker only. Never connects to a VPS or mounts host data.
set -euo pipefail
cd "$(dirname "$0")/.."
command -v docker >/dev/null || { echo 'BLOCKED: Docker is required for isolated SQL QA.' >&2; exit 2; }
[[ -f agent/dist/databases.js ]] || { echo 'Build the Agent first.' >&2; exit 2; }
mkdir -p qa-reports
report="$PWD/qa-reports/isolated-databases.json"
rm -f "$report"
context=$(mktemp -d)
identity="devone-sql-$(node -e 'process.stdout.write(require("node:crypto").randomUUID())')"
container=''
cleanup() {
  local status=$?
  trap - EXIT
  if [[ -n "$container" ]]; then
    docker rm -f "$container" >/dev/null || status=1
  fi
  if docker image inspect "$identity" >/dev/null 2>&1; then
    docker image rm "$identity" >/dev/null || status=1
  fi
  rm -rf "$context"
  exit "$status"
}
trap cleanup EXIT
# Allowlist only the compiled production module and test harness into the image.
cp qa/isolated-databases/Dockerfile qa/isolated-databases/integration.mjs "$context/"
cp agent/dist/databases.js "$context/"
docker build --label "devone.qa=$identity" -t "$identity" "$context"
container=$(docker create --name "$identity" --label "devone.qa=$identity" \
  --network none --memory 2g --cpus 2 --pids-limit 512 \
  --security-opt no-new-privileges "$identity")
status=0
timeout --signal=TERM --kill-after=15s 480s docker start -a "$container" || status=$?
docker cp "$container:/qa/result.json" "$report" || status=1
if [[ "$status" -eq 0 ]]; then
  node --input-type=module - "$report" <<'JS'
import {readFileSync} from 'node:fs';
const r=JSON.parse(readFileSync(process.argv[2],'utf8'));
if(r.scope!=='isolated-real-sql'||r.productionReady!==false||r.checks.length!==16||r.checks.some(c=>c.status!=='pass'))process.exit(1);
JS
fi
exit "$status"
