#!/usr/bin/env bash
# Normalize ONLY generated runtime artifacts. Do not loosen secrets, state or env files.
set -Eeuo pipefail
[[ "$EUID" -eq 0 ]] || { echo "Run as root." >&2; exit 1; }
APP=/opt/devone/current
API_DIST="$APP/apps/api/dist"
AGENT_DIST="$APP/agent/dist"
WEB_DIST="$APP/apps/dashboard/dist"
id devone >/dev/null 2>&1 || { echo "DevOne service user is missing." >&2; exit 1; }
for folder in "$API_DIST" "$AGENT_DIST" "$WEB_DIST"; do
  [[ -d "$folder" ]] || { echo "Missing compiled folder: $folder" >&2; exit 1; }
  [[ -z "$(find "$folder" -type l -print -quit)" ]] || { echo "Unexpected link in compiled assets: $folder" >&2; exit 1; }
done

# The API is root-owned but must be readable by the unprivileged service group.
# 750/640 keeps server-side code private from unrelated OS users.
chown -R root:devone "$API_DIST"
find "$API_DIST" -type d -exec chmod 750 {} +
find "$API_DIST" -type f -exec chmod 640 {} +

# The root Agent only needs non-executable JavaScript modules.
chown -R root:root "$AGENT_DIST"
find "$AGENT_DIST" -type d -exec chmod 755 {} +
find "$AGENT_DIST" -type f -exec chmod 644 {} +

# NGINX serves static assets as www-data, so assets must be publicly readable.
chown -R root:root "$WEB_DIST"
find "$WEB_DIST" -type d -exec chmod 755 {} +
find "$WEB_DIST" -type f -exec chmod 644 {} +

# Fail before an API restart if the actual service identity cannot read the build.
runuser -u devone -- test -r "$API_DIST/index.js"
runuser -u devone -- /usr/bin/node --check "$API_DIST/index.js"
if [[ -f "$API_DIST/control.js" ]]; then
  runuser -u devone -- /usr/bin/node --check "$API_DIST/control.js"
  runuser -u devone -- /usr/bin/node --input-type=module -e 'await import("file:///opt/devone/current/apps/api/dist/control.js")'
fi
runuser -u devone -- /usr/bin/node --input-type=module -e 'await import("file:///opt/devone/current/apps/api/node_modules/fastify/fastify.js")'
if id www-data >/dev/null 2>&1; then
  runuser -u www-data -- test -r "$WEB_DIST/index.html"
fi
echo "Verified runtime artifact permissions for devone and NGINX."

# Site workers read these two trusted helpers after dropping their identity.
for helper in "$APP/scripts/wordpress-extract.py" "$APP/scripts/wordpress-install.php"; do
  [[ -f "$helper" && ! -L "$helper" ]] || { echo "Missing or linked WordPress helper." >&2; exit 1; }
  chown root:root "$helper"
  chmod 644 "$helper"
done
