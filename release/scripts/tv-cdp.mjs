#!/usr/bin/env node
//
// tv-cdp.mjs — talk to the webOS app's Chrome DevTools endpoint from Node.
//
// Why this exists: ares-inspect opens a browser-hosted DevTools UI, which is
// fine for interactive debugging but useless for automation. This script
// connects directly to the CDP WebSocket so you can:
//
//   - dump app state on demand (no clicks)
//   - watch console messages while the user repros a bug
//   - filter network traffic to specific hosts (Twitch APIs, hls segments)
//   - run arbitrary JS in the app context
//
// Usage:
//   node tv-cdp.mjs <ws-url> <op> [duration-seconds]
//
//   ws-url   the page WebSocket URL printed by `ares-inspect`, e.g.
//            ws://localhost:58217/devtools/page/74A96A86B4DBA212AAA64305E929D211
//
//   op       state    — one-shot snapshot of the app's globals + DOM markers
//            logs     — capture console.* + uncaught exceptions for N seconds
//            net      — capture Twitch-host network requests for N seconds
//            watch    — logs + net together
//            eval:<expression> — run JS, print result (awaits promises)
//
//   duration-seconds   how long to listen for `logs` / `net` / `watch`
//                      (default: 10). Use 0 to listen until killed.
//
// You normally invoke this through `release/scripts/tv-debug.sh`, which
// handles the ares-inspect lifecycle for you. The raw script is documented
// here so you can call it manually too.

const wsUrl = process.argv[2];
const op = process.argv[3] || 'state';
const durationSec = Number(process.argv[4] || 10);

if (!wsUrl || !/^ws:\/\//.test(wsUrl)) {
    console.error('Usage: tv-cdp.mjs <ws-url> <op> [duration-seconds]');
    console.error('       op = state | logs | net | watch | eval:<expression>');
    process.exit(2);
}

const ws = new WebSocket(wsUrl);
let nextId = 1;
const pending = new Map();
const consoleMsgs = [];
const networkEvents = [];

function send(method, params = {}) {
    return new Promise((resolve, reject) => {
        const id = nextId++;
        pending.set(id, {resolve, reject});
        ws.send(JSON.stringify({id, method, params}));
    });
}

ws.addEventListener('message', (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) {
        const {resolve, reject} = pending.get(m.id);
        pending.delete(m.id);
        if (m.error) reject(new Error(JSON.stringify(m.error)));
        else resolve(m.result);
        return;
    }
    // Streaming events
    if (m.method === 'Runtime.consoleAPICalled') {
        const text = (m.params.args || [])
            .map(a => a.value !== undefined ? a.value : (a.description || a.type))
            .join(' ');
        consoleMsgs.push({t: nowMs(), level: m.params.type, text: trim(text, 500)});
        if (op === 'logs' || op === 'watch') stream('console', m.params.type, text);
    } else if (m.method === 'Runtime.exceptionThrown') {
        const e = m.params.exceptionDetails;
        const txt = e.exception?.description || e.text || JSON.stringify(e);
        consoleMsgs.push({t: nowMs(), level: 'EXCEPTION', text: trim(txt, 600)});
        if (op === 'logs' || op === 'watch') stream('exception', 'error', txt);
    } else if (m.method === 'Network.requestWillBeSent') {
        const u = m.params.request.url;
        if (matchTwitch(u)) {
            networkEvents.push({t: nowMs(), kind: 'request', method: m.params.request.method, url: u, requestId: m.params.requestId});
            if (op === 'net' || op === 'watch') stream('net', '→', `${m.params.request.method} ${shortUrl(u)}`);
        }
    } else if (m.method === 'Network.responseReceived') {
        const u = m.params.response.url;
        if (matchTwitch(u)) {
            networkEvents.push({t: nowMs(), kind: 'response', status: m.params.response.status, url: u, requestId: m.params.requestId});
            if (op === 'net' || op === 'watch') stream('net', '←', `${m.params.response.status} ${shortUrl(u)}`);
        }
    } else if (m.method === 'Network.loadingFailed') {
        networkEvents.push({t: nowMs(), kind: 'failed', err: m.params.errorText, blocked: m.params.blockedReason, requestId: m.params.requestId});
        if (op === 'net' || op === 'watch') stream('net', '✗', `${m.params.errorText}${m.params.blockedReason ? ' ('+m.params.blockedReason+')' : ''}`);
    }
});

ws.addEventListener('open', async () => {
    try {
        await send('Runtime.enable');
        if (op === 'net' || op === 'watch') await send('Network.enable');

        if (op === 'state') {
            await runState();
        } else if (op === 'logs' || op === 'net' || op === 'watch') {
            // Print a header so the stream output is self-explanatory.
            console.error(`[tv-cdp] listening for ${op} ${durationSec > 0 ? '('+durationSec+'s)' : '(until killed)'}…`);
            if (durationSec > 0) {
                setTimeout(() => finalize(), durationSec * 1000);
            } else {
                process.on('SIGINT', () => finalize());
            }
            return; // keep socket open
        } else if (op.startsWith('eval:')) {
            const r = await send('Runtime.evaluate', {
                expression: op.slice(5),
                returnByValue: true,
                awaitPromise: true
            });
            console.log(JSON.stringify(r.result?.value !== undefined ? r.result.value : r, null, 2));
        } else {
            console.error('Unknown op:', op);
            process.exit(2);
        }
        ws.close();
    } catch (e) {
        console.error('ERROR:', e.message);
        ws.close();
        process.exit(1);
    }
});

ws.addEventListener('error', () => {
    console.error('WebSocket error — is the inspector still running?');
    process.exit(2);
});

async function runState() {
    // One JS payload that probes everything we usually want. Add fields as the
    // surface area grows; keep return value JSON-stringifiable.
    const expression = `JSON.stringify({
        screen: {
            Main_Go: typeof Main_values !== 'undefined' ? Main_values.Main_Go : null,
            Main_Live: typeof Main_Live !== 'undefined' ? Main_Live : null,
            Main_addUser: typeof Main_addUser !== 'undefined' ? Main_addUser : null,
            Main_ChannelContent: typeof Main_ChannelContent !== 'undefined' ? Main_ChannelContent : null
        },
        play: {
            Play_isOn: typeof Play_isOn !== 'undefined' ? Play_isOn : null,
            Play_isFullScreen: typeof Play_isFullScreen !== 'undefined' ? Play_isFullScreen : null,
            Play_PreviewId: typeof Play_PreviewId !== 'undefined' ? Play_PreviewId : null
        },
        addUser: {
            in_user_screen: typeof AddUser_IsInUserScreen === 'function' ? AddUser_IsInUserScreen() : null,
            device_code: typeof AddUser_DeviceCode !== 'undefined' ? AddUser_DeviceCode : null,
            visible_text: (() => { var e = document.getElementById('add_user_text'); return e ? e.textContent.trim().slice(0, 240) : null; })(),
            users_count: typeof AddUser_UsernameArray !== 'undefined' ? AddUser_UsernameArray.length : null,
            current_user: typeof AddUser_UsernameArray !== 'undefined' && AddUser_UsernameArray[0]
                ? {
                    name: AddUser_UsernameArray[0].name,
                    has_access: !!AddUser_UsernameArray[0].access_token,
                    has_refresh: !!AddUser_UsernameArray[0].refresh_token,
                    expires_in: AddUser_UsernameArray[0].expires_in
                  }
                : null
        },
        platform: {
            Main_IsOn_OSInterface: typeof Main_IsOn_OSInterface !== 'undefined' ? Main_IsOn_OSInterface : null,
            has_Platform: typeof Platform !== 'undefined',
            has_Platform_http: typeof Platform !== 'undefined' && !!Platform.http && typeof Platform.http.request === 'function',
            has_WebOSServiceBridge: typeof WebOSServiceBridge !== 'undefined'
        },
        video: (() => {
            var v = document.querySelector('video');
            return v ? {
                paused: v.paused,
                ended: v.ended,
                currentTime: Math.round(v.currentTime * 10) / 10,
                readyState: v.readyState,
                src_set: !!v.src,
                muted: v.muted,
                volume: v.volume,
                video_w: v.videoWidth,
                video_h: v.videoHeight
            } : null;
        })(),
        twitch: {
            AddCode_Url: typeof AddCode_Url !== 'undefined' ? AddCode_Url : null,
            AddCode_clientId: typeof AddCode_clientId !== 'undefined' ? AddCode_clientId : null,
            AddCode_backup_client_id: typeof AddCode_backup_client_id !== 'undefined' ? AddCode_backup_client_id : null,
            has_main_token: typeof AddCode_main_token !== 'undefined' && !!AddCode_main_token
        },
        ua: navigator.userAgent,
        viewport: {w: window.innerWidth, h: window.innerHeight, dpr: devicePixelRatio}
    })`;
    const r = await send('Runtime.evaluate', {expression, returnByValue: true});
    if (r.exceptionDetails) {
        console.error('Probe threw:', r.exceptionDetails.text);
        return;
    }
    console.log(JSON.stringify(JSON.parse(r.result.value), null, 2));
}

function finalize() {
    console.log(JSON.stringify({
        op,
        durationSec,
        console: consoleMsgs,
        network: networkEvents
    }, null, 2));
    ws.close();
    setTimeout(() => process.exit(0), 50);
}

function nowMs() { return Date.now(); }
function trim(s, n) { return s.length > n ? s.slice(0, n) + '…' : s; }
function matchTwitch(url) {
    return /^(?:https?:\/\/)?(?:[^/]+\.)?(?:twitch\.tv|ttvnw\.net|jtvnw\.net|cloudfront\.net|twitchcdn\.net|akamaized\.net|llnwd\.net)\b/.test(url);
}
function shortUrl(u) {
    // Strip query string for readability — long signed CDN URLs flood the log
    var i = u.indexOf('?');
    return i === -1 ? u : u.slice(0, i) + '?…';
}
function stream(channel, level, text) {
    const ts = new Date().toISOString().slice(11, 23);
    console.log(`[${ts}] ${channel} ${level}: ${trim(text, 220)}`);
}
