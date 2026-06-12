#!/usr/bin/env bash
#
# install-from-github.sh — install the latest released IPK onto a webOS TV.
#
# Usage:
#   bash release/scripts/install-from-github.sh [device-name]
#
#   device-name   ares device to install to (default: webostv).
#                 List configured devices: ares-setup-device --list
#                 Register a TV first:     bash release/scripts/tv-setup.sh <tv-ip>
#
# Requirements:
#   - curl
#   - LG webOS CLI on PATH (npm i -g @webos-tools/cli)
#   - LG Developer Mode enabled on the TV (developer.lge.com account).
#     NOTE: Dev Mode sessions expire (~50 h) unless extended in the Dev Mode
#     app — side-loaded apps stop launching when the session lapses. The LG
#     Content Store is the proper long-term distribution path.
#
# How it resolves the release: the release pipeline publishes version.json
# alongside the IPK on every GitHub Release; the `latest/download` URL always
# points at the newest release's copy.

set -euo pipefail

REPO="${SMARTTWITCHTV_REPO:-tcarcao/smarttwitchtv-webos}"
DEVICE="${1:-webostv}"
VERSION_URL="https://github.com/${REPO}/releases/latest/download/version.json"

for cmd in curl ares-install ares-launch; do
    if ! command -v "$cmd" >/dev/null 2>&1; then
        case "$cmd" in
            curl) echo "curl not found on PATH." >&2 ;;
            *) echo "$cmd not found — install the LG webOS CLI: npm i -g @webos-tools/cli" >&2 ;;
        esac
        exit 2
    fi
done

echo ">>> Resolving latest release of ${REPO}"
VERSION_JSON="$(curl -fsSL "$VERSION_URL")" || {
    echo "Could not fetch ${VERSION_URL} — no release published yet, or no network." >&2
    exit 3
}

# version.json is flat {"version": "...", "ipkUrl": "..."} — extract without
# requiring jq (sed keeps the dependency list at curl + ares only).
VERSION="$(printf '%s' "$VERSION_JSON" | sed -nE 's/.*"version"[[:space:]]*:[[:space:]]*"([^"]+)".*/\1/p')"
IPK_URL="$(printf '%s' "$VERSION_JSON" | sed -nE 's/.*"ipkUrl"[[:space:]]*:[[:space:]]*"([^"]+)".*/\1/p')"

if [ -z "$IPK_URL" ]; then
    echo "version.json did not contain an ipkUrl — got: $VERSION_JSON" >&2
    exit 4
fi

TMP_DIR="$(mktemp -d -t sttv-install-XXXXXX)"
trap 'rm -rf "$TMP_DIR"' EXIT
IPK_FILE="$TMP_DIR/$(basename "$IPK_URL")"

echo ">>> Downloading v${VERSION}: $(basename "$IPK_URL")"
curl -fL --progress-bar -o "$IPK_FILE" "$IPK_URL"

echo ">>> Installing to device '$DEVICE'"
ares-install --device "$DEVICE" "$IPK_FILE"

echo ">>> Launching"
ares-launch --device "$DEVICE" com.fgl27.smarttwitchtv

echo
echo "Installed SmartTwitchTV v${VERSION} on '$DEVICE'."
