#!/usr/bin/env bash
set -euo pipefail
# Runtime bundles must be readable by devone and NGINX after compilation.
umask 022

REPO_URL="${DEVONE_REPO_URL:-https://github.com/developeronesw/DevOne-Server-Software.git}"
INSTALL_ROOT="/opt/devone"
APP_USER="devone"
ENV_FILE="/etc/devone/devone.env"
DOMAIN="${DEVONE_PANEL_DOMAIN:-}"
SOURCE_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"

log() { printf '\n[DevOne] %s\n' "$*"; }
fail() { echo "[DevOne] ERROR: $*" >&2; exit 1; }

[[ $EUID -eq 0 ]] || fail "Run as root."
[[ ! -f /etc/devone/api.json && ! -d /opt/devone/bin ]] || fail "Legacy edition detected; in-place conversion is unsupported."
[[ ! -d /home/clp ]] || fail "CloudPanel detected; use a separate VPS."
[[ ! -d /opt/devone/current ]] || fail "Existing Node installation detected. Updates require a versioned migration, not this fresh installer."
[[ -e "$SOURCE_DIR/.git" ]] || fail "Run from a Git checkout of the DevOne Server repository."
source /etc/os-release
[[ "${ID:-}" == "ubuntu" && "${VERSION_ID:-}" == "24.04" ]] || fail "DevOne 1.0 requires Ubuntu 24.04 LTS."
[[ "$(dpkg --print-architecture)" == "amd64" ]] || fail "DevOne 1.0 requires amd64/x86-64."

if [[ -z "$DOMAIN" ]]; then read -r -p "Control-panel domain (example: panel.devonecms.com): " DOMAIN; fi
[[ "$DOMAIN" =~ ^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$ && ${#DOMAIN} -le 253 ]] || fail "A valid lowercase panel hostname is required."

log "Installing and validating all required host prerequisites..."
bash "$SOURCE_DIR/installer/install-prerequisites.sh"
SOURCE_COMMIT="$(git -C "$SOURCE_DIR" rev-parse --verify HEAD)" || fail "Source must be a valid committed checkout."
[[ -z "$(git -C "$SOURCE_DIR" status --porcelain)" ]] || fail "Install from a clean committed checkout."
PNPM="/opt/devone/toolchain/node_modules/.bin/pnpm"
# Prefer the supported OS Node binary and private pnpm in all build subprocesses.
export PATH="/opt/devone/toolchain/node_modules/.bin:/usr/bin:/bin:$PATH"

log "Creating DevOne service account and persistent directories..."
id "$APP_USER" >/dev/null 2>&1 || useradd --system --home /var/lib/devone --create-home --shell /usr/sbin/nologin "$APP_USER"
install -d -o root -g root -m 755 "$INSTALL_ROOT"
install -d -o "$APP_USER" -g "$APP_USER" /var/lib/devone /var/log/devone
install -d -o root -g "$APP_USER" -m 750 /etc/devone
chown root:"$APP_USER" /etc/devone
chmod 750 /etc/devone
install -d -o root -g root -m 700 /var/lib/devone-agent
install -d -o root -g root -m 755 /home/devone-sites /var/www/devone-acme

if [[ ! -d "$INSTALL_ROOT/current/.git" ]]; then
  git clone --no-checkout "$REPO_URL" "$INSTALL_ROOT/current"
  git -C "$INSTALL_ROOT/current" checkout --detach "$SOURCE_COMMIT"
fi
chown -R root:root "$INSTALL_ROOT/current"

AGENT_TOKEN="$(openssl rand -hex 32)"
cat > "$ENV_FILE" <<EOF
NODE_ENV=production
PORT=8787
DEVONE_DB_PATH=/var/lib/devone/devone.sqlite
DEVONE_MASTER_KEY_FILE=/etc/devone/secrets.key
DEVONE_PANEL_URL=https://$DOMAIN
DEVONE_AGENT_URL=http://127.0.0.1:8790
DEVONE_AGENT_PORT=8790
DEVONE_AGENT_TOKEN=$AGENT_TOKEN
DEVONE_SETUP_TOKEN_FILE=/var/lib/devone/owner-setup-token
EOF
chown root:"$APP_USER" "$ENV_FILE"
chmod 640 "$ENV_FILE"

log "Creating the encrypted-vault master key..."
bash "$INSTALL_ROOT/current/scripts/provision-vault-key.sh"

log "Installing dependencies and building DevOne..."
cd "$INSTALL_ROOT/current"
"$PNPM" install --frozen-lockfile
"$PNPM" --filter @devone/api build
"$PNPM" --filter @devone/agent build
"$PNPM" --filter @devone/dashboard build
bash "$INSTALL_ROOT/current/scripts/prepare-runtime-files.sh"
install -D -o root -g root -m 700 "$INSTALL_ROOT/current/scripts/update-worker.sh" /usr/local/lib/devone/update-worker.sh

log "Installing systemd services..."
install -m 644 deploy/systemd/devone-api.service /etc/systemd/system/devone-api.service
install -m 644 deploy/systemd/devone-agent.service /etc/systemd/system/devone-agent.service
install -d -o root -g root -m 755 /etc/letsencrypt/renewal-hooks/deploy
install -o root -g root -m 755 deploy/certbot/devone-nginx.sh /etc/letsencrypt/renewal-hooks/deploy/devone-nginx
systemctl daemon-reload
systemctl enable nginx devone-api devone-agent
systemctl enable --now certbot.timer

log "Configuring HTTP bootstrap gateway..."
cat > /etc/nginx/sites-available/devone-panel <<EOF
server {
    listen 80;
    listen [::]:80;
    server_name $DOMAIN;
    location /.well-known/acme-challenge/ { root /var/www/devone-acme; }
    location / { proxy_pass http://127.0.0.1:8787; proxy_set_header Host \$host; proxy_set_header X-Real-IP \$remote_addr; }
}
EOF
ln -sfn /etc/nginx/sites-available/devone-panel /etc/nginx/sites-enabled/devone-panel

# Preserve existing host VHosts, including the default site.
nginx -t
systemctl restart nginx devone-api devone-agent
sleep 2
curl -fsS http://127.0.0.1:8787/api/health >/dev/null || fail "DevOne API failed health check."
curl -fsS http://127.0.0.1:8790/v1/health -H "Authorization: Bearer $AGENT_TOKEN" >/dev/null || fail "DevOne Agent failed health check."

log "Requesting HTTPS certificate..."
if ! certbot certificates 2>/dev/null | grep -q "Domains:.*$DOMAIN"; then
  # Administrator identity is created in HTTPS onboarding, not the shell.
  # Renewal is automatic; owner may add an ACME contact email after setup.
  certbot certonly --webroot -w /var/www/devone-acme \
    --non-interactive --agree-tos --register-unsafely-without-email \
    --cert-name "$DOMAIN" -d "$DOMAIN" || fail "Certificate request failed. Verify DNS points to this server and ports 80/443 are open."
fi

[[ -s "/etc/letsencrypt/live/$DOMAIN/fullchain.pem" && -s "/etc/letsencrypt/live/$DOMAIN/privkey.pem" ]] || fail "TLS certificate files missing at expected path."
log "Installing hardened HTTPS NGINX configuration..."
sed "s/__DEVONE_PANEL_DOMAIN__/$DOMAIN/g" deploy/nginx/devone-panel.conf.template > /etc/nginx/sites-available/devone-panel
nginx -t
systemctl reload nginx

# Check local HTTPS and dashboard before reporting ready.
curl -fsS --resolve "$DOMAIN:443:127.0.0.1" "https://$DOMAIN/api/health" >/dev/null \
  || fail "Panel HTTPS API is not responding."
curl -fsS --resolve "$DOMAIN:443:127.0.0.1" "https://$DOMAIN/" >/dev/null \
  || fail "Panel HTTPS dashboard is not responding."

log "Generating secure first-run browser setup link..."
bash "$INSTALL_ROOT/current/scripts/issue-setup-link.sh"
log "DevOne is installed. Complete initial setup in the browser."
echo "Control panel: https://$DOMAIN"
echo "After setup, register a certificate contact email for renewal notices:"
echo "  sudo certbot update_account --email you@example.com"
