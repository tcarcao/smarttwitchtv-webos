#!/usr/bin/env bash
#
# tv-debug.sh — one-shot CDP probe of the webOS app running on the TV.
#
# Wraps ares-inspect's lifecycle: starts the inspector if it isn't already
# running, scrapes the CDP page URL from `http://localhost:<port>/json`, and
# forwards args to release/scripts/tv-cdp.mjs.
#
# Usage:
#   release/scripts/tv-debug.sh state              # snapshot of app globals
#   release/scripts/tv-debug.sh logs 15            # 15s of console/exceptions
#   release/scripts/tv-debug.sh net 20             # 20s of Twitch-host XHRs
#   release/scripts/tv-debug.sh watch 30           # logs + net together
#   release/scripts/tv-debug.sh eval:'Main_values.Main_Go'
#
#   DEVICE=emulator release/scripts/tv-debug.sh state  # target the simulator
#
# The script keeps the ares-inspect background process alive across runs so
# repeated probes don't pay the connect tax every time. If a previous
# inspector is still up but on a stale port, kill it manually:
#
#   pkill -f 'ares-inspect.*com.fgl27.smarttwitchtv'
#
# Requires Node 22+ (uses the built-in WebSocket).

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
DEVICE="${DEVICE:-webostv}"
APP_ID="com.fgl27.smarttwitchtv"
CDP_SCRIPT="$ROOT/release/scripts/tv-cdp.mjs"

if [ $# -lt 1 ]; then
    cat <<EOF >&2
Usage: $(basename "$0") <op> [duration-seconds]
   op = state | logs | net | watch | eval:<expression> | stop
EOF
    exit 2
fi

# stop: kill any lingering ares-inspect processes for our app. Useful when the
# TV app gets backgrounded (YouTube etc.) and the inspector latches onto the
# wrong page, or when port detection starts returning stale data.
if [ "$1" = "stop" ]; then
    KILLED=0
    for pid in $(pgrep -f "ares-inspect.*${APP_ID}" 2>/dev/null); do
        kill "$pid" 2>/dev/null && KILLED=$((KILLED + 1))
    done
    echo "Killed $KILLED ares-inspect process(es)."
    exit 0
fi

if ! command -v ares-inspect >/dev/null; then
    echo "ares-inspect not on PATH — install ares-cli (npm i -g @webos-tools/cli)" >&2
    exit 3
fi

# Reuse a running inspector if there is one. ares-inspect prints
# `Application Debugging - http://localhost:<port>/devtools/inspector.html...`
# on stdout; we grep that out on first launch.
RUNNING_PID="$(pgrep -f "ares-inspect.*${APP_ID}" 2>/dev/null || true)"
if [ -z "$RUNNING_PID" ]; then
    LOG="$(mktemp -t tv-inspect-XXXXXX.log)"
    ares-inspect --device "$DEVICE" --app "$APP_ID" > "$LOG" 2>&1 &
    INSPECT_PID=$!
    # ares-inspect takes ~1-3s to print the URL; poll briefly.
    for i in 1 2 3 4 5 6 7 8 9 10; do
        if grep -q 'Application Debugging' "$LOG"; then break; fi
        sleep 0.5
    done
fi

# Find the inspector's TCP port. ares-inspect picks a random one and prints it
# in its startup banner. Easier path: scan local listening ports for one that
# answers /json with our app id.
PORT=""
# BSD sed (macOS) needs -E for `+`. Use ERE explicitly.
for p in $(lsof -nP -iTCP -sTCP:LISTEN 2>/dev/null | awk '/node|ares/ {print $9}' | sed -nE 's/.*:([0-9]+)$/\1/p' | sort -u); do
    if curl -s --max-time 1 "http://localhost:$p/json" 2>/dev/null | grep -q "$APP_ID"; then
        PORT=$p
        break
    fi
done

if [ -z "$PORT" ]; then
    echo "Could not locate the inspector port. Run 'ares-inspect --device $DEVICE --app $APP_ID' manually and check it printed an http://localhost:<port> URL." >&2
    exit 4
fi

# Extract the page id from /json. There is typically only one page per app.
PAGE_ID="$(curl -s "http://localhost:$PORT/json" | grep -m1 '"id"' | sed -E 's/.*"id": "([^"]+)".*/\1/')"
if [ -z "$PAGE_ID" ]; then
    echo "Failed to find a debuggable page on localhost:$PORT — is the app still running on the TV?" >&2
    exit 5
fi

WS_URL="ws://localhost:$PORT/devtools/page/$PAGE_ID"
exec node "$CDP_SCRIPT" "$WS_URL" "$@"
