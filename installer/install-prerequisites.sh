#!/usr/bin/env bash
# Fresh Ubuntu 24.04 bootstrap for the DevOne Node edition.
# Called after the main installer checks the OS, edition conflicts and Git checkout.
set -Eeuo pipefail
export DEBIAN_FRONTEND=noninteractive

log() { printf '\n[DevOne prerequisites] %s\n' "$*"; }
fail() { printf '[DevOne prerequisites] ERROR: %s\n' "$*" >&2; exit 1; }

[[ $EUID -eq 0 ]] || fail 'Run the installer as root.'
[[ -r /etc/os-release ]] || fail 'Cannot identify the operating system.'
# shellcheck disable=SC1091
source /etc/os-release
[[ "${ID:-}" == ubuntu && "${VERSION_ID:-}" == 24.04 ]] || fail 'Ubuntu 24.04 LTS is required.'
[[ "$(dpkg --print-architecture)" == amd64 ]] || fail 'Only x86-64/amd64 is currently supported.'

log 'Updating Ubuntu package indexes...'
apt-get update -y

log 'Installing web server, TLS, build, Git and security prerequisites...'
apt-get install -y --no-install-recommends \
  ca-certificates curl gnupg git nginx certbot python3-certbot-nginx \
  python3 build-essential util-linux openssl acl

# systemd and user-management tools are part of our supported Ubuntu server
# baseline. Detect unexpectedly stripped images before changing DevOne state.
for tool in systemctl useradd getent flock nginx certbot git curl python3 openssl setfacl; do
  command -v "$tool" >/dev/null 2>&1 || fail "Missing required host executable: $tool"
done

node_compatible() {
  [[ -x /usr/bin/node && -x /usr/bin/npm ]] || return 1
  /usr/bin/node -e 'const [major,minor] = process.versions.node.split(".").map(Number); process.exit(major > 22 || (major === 22 && minor >= 13) ? 0 : 1)' >/dev/null 2>&1
}

if ! node_compatible; then
  log 'Installing an OS-managed Node.js 22 runtime from the signed NodeSource repository...'
  temporary="$(mktemp -d)"
  cleanup() { rm -rf -- "$temporary"; }
  trap cleanup EXIT
  curl --fail --silent --show-error --location \
    https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key \
    --output "$temporary/nodesource.asc"
  gpg --batch --yes --dearmor --output "$temporary/nodesource.gpg" "$temporary/nodesource.asc"
  install -d -m 0755 /usr/share/keyrings
  install -m 0644 "$temporary/nodesource.gpg" /usr/share/keyrings/devone-nodesource.gpg
  cat > /etc/apt/sources.list.d/devone-nodesource.sources <<'NODESOURCE'
Types: deb
URIs: https://deb.nodesource.com/node_22.x
Suites: nodistro
Components: main
Architectures: amd64
Signed-By: /usr/share/keyrings/devone-nodesource.gpg
NODESOURCE
  cat > /etc/apt/preferences.d/devone-nodejs <<'PINNING'
Package: nodejs
Pin: origin deb.nodesource.com
Pin-Priority: 600
PINNING
  apt-get update -y
  apt-get install -y --no-install-recommends nodejs
  cleanup
  trap - EXIT
fi

node_compatible || fail 'Node.js 22.13+ and npm must be available at /usr/bin/node and /usr/bin/npm.'
log "Node.js verified: $(/usr/bin/node --version)"

# Avoid modifying the machine's global package-manager shims or Corepack.
# A private, pinned pnpm makes installations deterministic and works whether
# Ubuntu's Node distribution happens to bundle Corepack or not.
TOOLCHAIN=/opt/devone/toolchain
PNPM="$TOOLCHAIN/node_modules/.bin/pnpm"
if [[ ! -x "$PNPM" || "$("$PNPM" --version 2>/dev/null || true)" != 10.15.1 ]]; then
  log 'Installing pinned pnpm 10.15.1 into the DevOne toolchain...'
  install -d -o root -g root -m 0755 "$TOOLCHAIN"
  /usr/bin/npm install --prefix "$TOOLCHAIN" --no-audit --no-fund --save-exact pnpm@10.15.1
fi
[[ "$("$PNPM" --version)" == 10.15.1 ]] || fail 'pnpm installation/version verification failed.'
log "pnpm verified: $("$PNPM" --version)"

for tool in /usr/bin/node /usr/bin/npm "$PNPM"; do
  [[ -x "$tool" ]] || fail "Missing required runtime executable: $tool"
done
log 'All required prerequisites installed and verified.'
