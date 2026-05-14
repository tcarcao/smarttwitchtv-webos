#!/usr/bin/env bash
#
# Stage app/ + webos/ metadata, then package as an LG webOS IPK.
#
# Outputs:
#   dist-webos/    staging bundle (cleaned each run)
#   dist-ipk/      final .ipk artifacts
#
# Requires: ares-package on PATH (LG webOS SDK CLI).

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
STAGE="$ROOT/dist-webos"
OUT="$ROOT/dist-ipk"

if ! command -v ares-package >/dev/null 2>&1; then
    echo "ares-package not found on PATH. Install the LG webOS SDK CLI." >&2
    exit 2
fi

rm -rf "$STAGE"
mkdir -p "$STAGE" "$OUT"

# Copy app/ contents to bundle root (appinfo.json expects index.html at root).
cp -R "$ROOT/app/." "$STAGE/"

# Drop webOS metadata into the bundle root.
cp "$ROOT/webos/appinfo.json" "$STAGE/appinfo.json"
cp "$ROOT/webos/icon.png" "$STAGE/icon.png"
cp "$ROOT/webos/largeIcon.png" "$STAGE/largeIcon.png"

# Build. -o sets the output directory; ares-package picks the filename.
ares-package "$STAGE" -o "$OUT"

echo
echo "IPK built:"
ls -la "$OUT"/*.ipk 2>/dev/null || { echo "(no .ipk produced — check ares-package output above)"; exit 3; }
