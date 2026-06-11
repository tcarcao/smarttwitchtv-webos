#!/usr/bin/env bash
#
# Verify the local toolchain needed to build/install/test on webOS.
# Run: npm run doctor

set -u

OK="✓"
FAIL="✗"
WARN="!"
fail=0

check() {
    local label="$1"
    local cmd="$2"
    if eval "$cmd" >/dev/null 2>&1; then
        printf "  %s  %s\n" "$OK" "$label"
    else
        printf "  %s  %s\n" "$FAIL" "$label"
        fail=$((fail + 1))
    fi
}

soft_check() {
    local label="$1"
    local cmd="$2"
    local hint="$3"
    if eval "$cmd" >/dev/null 2>&1; then
        printf "  %s  %s\n" "$OK" "$label"
    else
        printf "  %s  %s   (%s)\n" "$WARN" "$label" "$hint"
    fi
}

echo "Toolchain:"
check "ares (LG SDK CLI)"                    "command -v ares"
check "ares-package"                         "command -v ares-package"
check "ares-install"                         "command -v ares-install"
check "ares-launch"                          "command -v ares-launch"
check "ares-inspect"                         "command -v ares-inspect"
check "ares-setup-device"                    "command -v ares-setup-device"
check "node"                                 "command -v node"

echo
echo "Registered devices:"
if command -v ares-setup-device >/dev/null 2>&1; then
    ares-setup-device --list | sed 's/^/  /'
else
    echo "  (skipped — ares-setup-device missing)"
fi

echo
echo "macOS simulator app:"
SIM=$(ls -d /Applications/webOS_TV_*_Simulator_*.app 2>/dev/null | tail -1)
if [ -n "$SIM" ]; then
    printf "  %s  %s\n" "$OK" "$SIM"
else
    printf "  %s  no webOS_TV_*_Simulator_*.app in /Applications\n" "$WARN"
    echo "      download from https://webostv.developer.lge.com/develop/tools/simulator-installation"
fi

echo
echo "Build artifacts:"
soft_check "dist-ipk/*.ipk built" \
    "ls dist-ipk/*.ipk" \
    "run: npm run build:webos"

echo
if [ "$fail" -gt 0 ]; then
    echo "$fail required tool(s) missing."
    exit 1
fi
echo "Toolchain looks good. Next steps in: release/README.md"
