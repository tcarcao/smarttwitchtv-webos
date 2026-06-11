#!/usr/bin/env bash
#
# Launch the macOS webOS TV Simulator app.
# Run: npm run sim
#
# Picks the most recent webOS_TV_*_Simulator_*.app installed under
# /Applications. The simulator boots a TV emulation in a window;
# ares-cli's "emulator" device profile then SSH-installs into it.

set -euo pipefail

SIM=$(ls -d /Applications/webOS_TV_*_Simulator_*.app 2>/dev/null | sort -V | tail -1)

if [ -z "$SIM" ]; then
    echo "No webOS_TV_*_Simulator_*.app found in /Applications." >&2
    echo "Download from: https://webostv.developer.lge.com/develop/tools/simulator-installation" >&2
    exit 2
fi

echo "Opening $SIM"
open "$SIM"
