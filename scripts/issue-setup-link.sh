#!/usr/bin/env bash
set -euo pipefail
# One-time owner registration URL. Run as root on the installed host.
[[ "$EUID" -eq 0 ]] || { echo "Run with sudo." >&2; exit 1; }
ENV_FILE=/etc/devone/devone.env
TOKEN_FILE=/var/lib/devone/owner-setup-token
[[ -r "$ENV_FILE" && -d /var/lib/devone ]] || { echo "DevOne is not installed." >&2; exit 1; }
PANEL_URL="$(sed -n 's/^DEVONE_PANEL_URL=//p' "$ENV_FILE" | head -n 1)"
[[ "$PANEL_URL" =~ ^https://[a-z0-9.-]+$ ]] || { echo "Invalid HTTPS panel domain." >&2; exit 1; }
SETUP_REQUIRED="$(curl -fsS --max-time 8 http://127.0.0.1:8787/api/setup/status | python3 -c 'import json,sys; print("yes" if json.load(sys.stdin).get("setupRequired") is True else "no")')"
[[ "$SETUP_REQUIRED" == "yes" ]] || { echo "Owner account already configured. No setup link issued." >&2; exit 1; }
# Migrate older previews which stored a now-unusable token in the environment.
if ! grep -qx 'DEVONE_SETUP_TOKEN_FILE=/var/lib/devone/owner-setup-token' "$ENV_FILE"; then
  sed -i '/^DEVONE_SETUP_TOKEN=/d; /^DEVONE_SETUP_TOKEN_FILE=/d' "$ENV_FILE"
  printf '%s\n' 'DEVONE_SETUP_TOKEN_FILE=/var/lib/devone/owner-setup-token' >> "$ENV_FILE"
  systemctl restart devone-api
  for _ in 1 2 3 4 5; do
    if curl -fsS --max-time 3 http://127.0.0.1:8787/api/health >/dev/null; then break; fi
    sleep 1
  done
fi
if [[ ! -f "$TOKEN_FILE" ]]; then
  umask 077
  openssl rand -hex 32 > "$TOKEN_FILE"
  chown devone:devone "$TOKEN_FILE"
  chmod 600 "$TOKEN_FILE"
fi
[[ "$(stat -c '%a:%U' "$TOKEN_FILE")" == "600:devone" ]] || { echo "Unsafe setup token permissions." >&2; exit 1; }
SETUP_TOKEN="$(cat "$TOKEN_FILE")"
[[ "$SETUP_TOKEN" =~ ^[0-9a-f]{64}$ ]] || { echo "Invalid setup token file." >&2; exit 1; }
printf '\nDEVONE FIRST-RUN SETUP LINK (keep private):\n%s/#setup=%s\n\n' "$PANEL_URL" "$SETUP_TOKEN"
echo "Open this link in your browser to set up the Owner account."
echo "The one-time link is consumed when setup succeeds."
echo "Do not post the link publicly; the token is stored only in a root/devone-accessible file."
