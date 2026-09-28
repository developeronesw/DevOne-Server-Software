#!/usr/bin/env bash
set -euo pipefail

# DevOne Server Phase 1 bootstrap.
# This script is intentionally conservative. It validates the host before
# installing DevOne components. Full installation logic is added incrementally.

if [[ $EUID -ne 0 ]]; then
  echo "DevOne installer must be run as root (use sudo)." >&2
  exit 1
fi

source /etc/os-release

if [[ "${ID:-}" != "ubuntu" || "${VERSION_ID:-}" != "24.04" ]]; then
  echo "Unsupported operating system. DevOne 1.0 initially supports Ubuntu 24.04 LTS." >&2
  exit 1
fi

arch="$(dpkg --print-architecture)"
if [[ "$arch" != "amd64" ]]; then
  echo "Unsupported architecture: $arch. DevOne 1.0 initially supports x86-64/amd64." >&2
  exit 1
fi

echo "DevOne Server installer"
echo "OS: Ubuntu 24.04 LTS"
echo "Architecture: $arch"
echo
echo "Phase 1 bootstrap preflight passed."
echo "Full component installation will be enabled as Phase 1 is completed."
