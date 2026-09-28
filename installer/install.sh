#!/usr/bin/env bash
set -euo pipefail

REPO_URL="${DEVONE_REPO_URL:-https://github.com/developeronesw/DevOne-Server-Software.git}"
INSTALL_ROOT="/opt/devone"
APP_USER="devone"
ENV_FILE="/etc/devone/devone.env"
DOMAIN="${DEVONE_PANEL_DOMAIN:-}"
ADMIN_EMAIL="${DEVONE_ADMIN_EMAIL:-}"
ADMIN_PASSWORD="${DEVONE_ADMIN_PASSWORD:-}"

log() { printf '\n[DevOne] %s\n' "$*"; }
fail() { echo "[DevOne] ERROR: $*" >&2; exit 1; }

[[ $EUID -eq 0 ]] || fail "Run as root."
source /etc/os-release
[[ "${ID:-}" == "ubuntu" && "${VERSION_ID:-}" == "24.04" ]] || fail "DevOne 1.0 requires Ubuntu 24.04 LTS."
[[ "$(dpkg --print-architecture)" == "amd64" ]] || fail "DevOne 1.0 requires amd64/x86-64."

if [[ -z "$DOMAIN" ]]; then read -r -p "Control-panel domain (example: panel.devonecms.com): " DOMAIN; fi
[[ "$DOMAIN" =~ ^[A-Za-z0-9.-]+$ ]] || fail "Invalid panel domain."
if [[ -z "$ADMIN_EMAIL" ]]; then read -r -p "Initial Owner email: " ADMIN_EMAIL; fi
if [[ -z "$ADMIN_PASSWORD" ]]; then read -r -s -p "Initial Owner password (12+ characters): " ADMIN_PASSWORD; echo; fi
[[ "${#ADMIN_PASSWORD}" -ge 12 ]] || fail "Admin password must be at least 12 characters."

log "Installing host prerequisites..."
apt-get update
DEBIAN_FRONTEND=noninteractive apt-get install -y curl ca-certificates git nginx certbot python3-certbot-nginx build-essential

if ! command -v node >/dev/null 2>&1 || [[ "$(node -p 'process.versions.node.split(".")[0]')" -lt 22 ]]; then
  log "Installing Node.js 22 LTS runtime..."
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  DEBIAN_FRONTEND=noninteractive apt-get install -y nodejs
fi
node_major="$(node -p 'process.versions.node.split(".")[0]')"
[[ "$node_major" -ge 22 ]] || fail "Node.js 22+ is required."

corepack enable
corepack prepare pnpm@10.15.1 --activate

log "Creating DevOne service account and persistent directories..."
id "$APP_USER" >/dev/null 2>&1 || useradd --system --home /var/lib/devone --create-home --shell /usr/sbin/nologin "$APP_USER"
install -d -o "$APP_USER" -g "$APP_USER" "$INSTALL_ROOT" /var/lib/devone /var/log/devone /etc/devone /var/www/devone-acme
chmod 750 /etc/devone

if [[ ! -d "$INSTALL_ROOT/current/.git" ]]; then
  git clone "$REPO_URL" "$INSTALL_ROOT/current"
fi
chown -R "$APP_USER:$APP_USER" "$INSTALL_ROOT/current"

AGENT_TOKEN="${DEVONE_AGENT_TOKEN:-$(openssl rand -hex 32)}"
cat > "$ENV_FILE" <<EOF
NODE_ENV=production
PORT=8787
DEVONE_DB_PATH=/var/lib/devone/devone.sqlite
DEVONE_PANEL_URL=https://$DOMAIN
DEVONE_AGENT_URL=http://127.0.0.1:8790
DEVONE_AGENT_PORT=8790
DEVONE_AGENT_TOKEN=$AGENT_TOKEN
EOF
chown root:"$APP_USER" "$ENV_FILE"
chmod 640 "$ENV_FILE"

log "Installing dependencies and building DevOne..."
cd "$INSTALL_ROOT/current"
pnpm install
pnpm --filter @devone/api build
pnpm --filter @devone/agent build
pnpm --filter @devone/dashboard build

log "Installing systemd services..."
install -m 644 deploy/systemd/devone-api.service /etc/systemd/system/devone-api.service
install -m 644 deploy/systemd/devone-agent.service /etc/systemd/system/devone-agent.service
systemctl daemon-reload
systemctl enable devone-api devone-agent

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
rm -f /etc/nginx/sites-enabled/default
nginx -t
systemctl restart nginx devone-api devone-agent
sleep 2
curl -fsS http://127.0.0.1:8787/api/health >/dev/null || fail "DevOne API failed health check."
curl -fsS http://127.0.0.1:8790/v1/health -H "Authorization: Bearer $AGENT_TOKEN" >/dev/null || fail "DevOne Agent failed health check."

log "Requesting HTTPS certificate..."
if ! certbot certificates 2>/dev/null | grep -q "Domains:.*$DOMAIN"; then
  certbot --nginx --non-interactive --agree-tos --register-unsafely-without-email -d "$DOMAIN" || fail "Certificate request failed. Verify DNS points to this server and ports 80/443 are open."
fi

log "Installing hardened HTTPS NGINX configuration..."
sed "s/__DEVONE_PANEL_DOMAIN__/$DOMAIN/g" deploy/nginx/devone-panel.conf.template > /etc/nginx/sites-available/devone-panel
nginx -t
systemctl reload nginx

log "Initializing Owner account..."
payload="$(python3 -c 'import json,sys; print(json.dumps({"email":sys.argv[1],"password":sys.argv[2]}))' "$ADMIN_EMAIL" "$ADMIN_PASSWORD")"
curl -fsS -X POST "https://$DOMAIN/api/auth/setup" -H "Content-Type: application/json" --data "$payload" >/dev/null || fail "Owner account setup failed."

log "DevOne Phase 1 installation complete."
echo "Control panel: https://$DOMAIN"
echo "Owner: $ADMIN_EMAIL"
echo "API: http://127.0.0.1:8787 (internal only)"
