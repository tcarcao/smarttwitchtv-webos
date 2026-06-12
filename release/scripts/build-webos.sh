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

# Bundle external static assets that the HTML references via ../release/githubio.
# In browser dev, vite serves these from the project root because root='app' and
# vite's serve allows .. to project root for static files. In the IPK, the bundle
# root IS app/, so `..` would escape outside the bundle. Mirror the path inside
# the bundle and patch the HTML to drop the leading `..`.
if [ -d "$ROOT/release/githubio" ]; then
    # Only the css/ and images/ subfolders are referenced via relative path
    # from index.html (icons.css + favicon.png). Other githubio assets
    # (paypal.png, version.json, etc.) load via https:// URLs at runtime,
    # so they don't need bundling. Copying selectively keeps the IPK small.
    mkdir -p "$STAGE/release/githubio"
    if [ -d "$ROOT/release/githubio/css" ]; then
        cp -R "$ROOT/release/githubio/css" "$STAGE/release/githubio/"
    fi
    if [ -d "$ROOT/release/githubio/images" ]; then
        # Just the favicon — the donation icons load over https at runtime.
        mkdir -p "$STAGE/release/githubio/images"
        if [ -f "$ROOT/release/githubio/images/favicon.png" ]; then
            cp "$ROOT/release/githubio/images/favicon.png" "$STAGE/release/githubio/images/favicon.png"
        fi
    fi
    # Rewrite "../release/githubio" → "release/githubio" in the staged HTML.
    # sed -i'' for BSD/macOS compatibility.
    sed -i'.bak' 's|\.\./release/githubio|release/githubio|g' "$STAGE/index.html"
    rm -f "$STAGE/index.html.bak"
    if [ -f "$STAGE/Extrapage/index.html" ]; then
        sed -i'.bak' 's|\.\./release/githubio|release/githubio|g' "$STAGE/Extrapage/index.html"
        rm -f "$STAGE/Extrapage/index.html.bak"
    fi
fi

# Drop webOS metadata into the bundle root.
cp "$ROOT/webos/appinfo.json" "$STAGE/appinfo.json"
cp "$ROOT/webos/icon.png" "$STAGE/icon.png"
cp "$ROOT/webos/largeIcon.png" "$STAGE/largeIcon.png"

# Build. -o sets the output directory; ares-package picks the filename.
#
# @webos-tools/cli 3.2.4 crashes in its post-package temp cleanup
# ("rimraf is not a function") AFTER writing a complete IPK — on every
# Node version we tried (22 and 24). Tolerate the exit code and verify
# the package structurally instead, so a real packaging failure still
# fails the build.
ares-package "$STAGE" -o "$OUT" || echo "(ares-package exited non-zero — verifying IPK anyway)"

IPK="$(ls "$OUT"/*.ipk 2>/dev/null | head -1)"
if [ -z "$IPK" ]; then
    echo "no .ipk produced — check ares-package output above" >&2
    exit 3
fi

# Structural verification: ar members + the files the app can't boot without.
if ! ar t "$IPK" | grep -q "^data.tar.gz$"; then
    echo "IPK at $IPK is malformed (missing data.tar.gz)" >&2
    exit 4
fi
for f in appinfo.json index.html platform/PlatformWebOS.js; do
    if ! ar p "$IPK" data.tar.gz | tar tz | grep -q "/$f\$"; then
        echo "IPK is missing $f" >&2
        exit 5
    fi
done

echo
echo "IPK built and verified:"
ls -la "$OUT"/*.ipk
