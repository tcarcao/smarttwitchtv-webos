#!/usr/bin/env bash
#
# Build → install → launch on a configured webOS device.
# Run: bash release/scripts/deploy.sh <device-name>
#
# <device-name> matches `ares-setup-device --list` (e.g. "emulator", "webostv").
# Pass --skip-build to reuse the existing IPK without rebuilding.

set -euo pipefail

DEVICE="${1:-emulator}"
SKIP_BUILD=0
shift || true
for arg in "$@"; do
    [ "$arg" = "--skip-build" ] && SKIP_BUILD=1
done

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
APP_ID="com.fgl27.smarttwitchtv"
IPK="$ROOT/dist-ipk/${APP_ID}_0.0.1_all.ipk"

if [ "$SKIP_BUILD" -ne 1 ]; then
    echo ">>> Build"
    bash "$ROOT/release/scripts/build-webos.sh"
fi

if [ ! -f "$IPK" ]; then
    echo "IPK not found at $IPK" >&2
    echo "Run: npm run build:webos" >&2
    exit 2
fi

echo
echo ">>> Install to $DEVICE"
ares-install --device "$DEVICE" "$IPK"

echo
echo ">>> Launch $APP_ID on $DEVICE"
ares-launch --device "$DEVICE" "$APP_ID"

echo
echo "Done. To attach DevTools:"
echo "  npm run inspect:${DEVICE} 2>/dev/null || ares-inspect --device $DEVICE --app $APP_ID --open"
