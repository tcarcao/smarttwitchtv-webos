#!/usr/bin/env bash
#
# tv-setup.sh — register the webOS TV with ares-cli or update its IP.
#
# Run this when:
#   - first time setting up a new TV (developer mode enabled, IP known)
#   - the TV moved networks or got a new DHCP lease and deploys started hanging
#
# Usage:
#   release/scripts/tv-setup.sh <ip> [device-name]
#
# Defaults:
#   device-name = webostv  (matches what package.json's deploy:tv uses)
#   username    = prisoner (standard webOS dev-mode account)
#   port        = 9922     (standard webOS dev-mode SSH port)
#
# Idempotent: if the device already exists in ares config, the IP is
# updated; if not, it's added with the defaults above. Either way the
# script ends with `ares-setup-device --list` so you can eyeball the
# final state.
#
# A passphrase from the TV's Developer Mode app is still required for SSH
# auth — ares-cli will prompt the first time you try to deploy and cache
# the result. This script only manages the host/port/username config.

set -euo pipefail

if ! command -v ares-setup-device >/dev/null; then
    echo "ares-setup-device not on PATH — install ares-cli (npm i -g @webos-tools/cli)" >&2
    exit 2
fi

IP="${1:-}"
DEVICE="${2:-webostv}"

if [ -z "$IP" ]; then
    cat <<EOF >&2
Usage: $(basename "$0") <ip> [device-name]

Examples:
  $(basename "$0") 192.168.0.140
  $(basename "$0") 192.168.0.140 webostv
  $(basename "$0") 10.0.0.55 livingroom-tv
EOF
    exit 1
fi

# Basic IP sanity check (not perfect — just catches typos like "192.168.0").
if ! echo "$IP" | grep -qE '^[0-9]{1,3}(\.[0-9]{1,3}){3}$'; then
    echo "Warning: '$IP' doesn't look like an IPv4 address — proceeding anyway." >&2
fi

if ares-setup-device --list | awk '{print $1}' | grep -qx "$DEVICE"; then
    echo ">>> Device '$DEVICE' exists — updating IP to $IP"
    ares-setup-device -m "$DEVICE" -i "host=$IP"
else
    echo ">>> Device '$DEVICE' not found — adding with username=prisoner, host=$IP, port=9922"
    ares-setup-device -a "$DEVICE" -i "username=prisoner" -i "host=$IP" -i "port=9922"
fi

echo
echo ">>> Final device list:"
ares-setup-device --list
echo
echo "Next: npm run deploy:tv"
echo "(first deploy after a TV reset will prompt for the Developer Mode passphrase)"
