#!/usr/bin/env bash
set -Eeuo pipefail
[[ $EUID -eq 0 ]] || { echo 'Run with sudo.' >&2; exit 1; }
KEY=/etc/devone/secrets.key
[[ -d /etc/devone ]] || { echo 'DevOne must be installed first.' >&2; exit 1; }
[[ ! -e "$KEY" && ! -L "$KEY" ]] || { echo 'A key already exists. It was not changed.'; exit 0; }
getent group devone >/dev/null || { echo 'DevOne service group missing.' >&2; exit 1; }
umask 077
# noclobber prevents replacement if another provisioning process creates it.
(set -o noclobber; openssl rand 32 > "$KEY")
chown root:devone "$KEY"
chmod 640 "$KEY"
echo 'Encrypted-vault key created. Back it up separately from the database.'
