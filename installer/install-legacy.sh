#!/usr/bin/env bash
set -Eeuo pipefail
BASE_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
[[ $EUID -eq 0 ]] || { echo 'Run: sudo bash installer/install-legacy.sh' >&2; exit 1; }
[[ ! -f /etc/devone/devone.env && ! -d /opt/devone/current ]] || { echo 'Node edition detected. In-place conversion is unsupported; use a separate VPS.' >&2; exit 1; }
cd "$BASE_DIR"
python3 scripts/assemble-distribution.py
sha256sum -c distributions/checksums.sha256
command -v unzip >/dev/null || { echo 'Install unzip first: sudo apt-get install unzip' >&2; exit 1; }
WORK_DIR=$(mktemp -d)
trap 'rm -rf "$WORK_DIR"' EXIT
unzip -q distributions/DevOne-Server-0.7.0-All-in-One.zip -d "$WORK_DIR"
bash "$WORK_DIR/DevOne-Server-0.7.0-All-in-One/install.sh"
