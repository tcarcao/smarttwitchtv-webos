# Upstream-sync changelog

Records which upstream commits have been applied to this fork. Append-only.

## Format

Each entry:

````
## 2026-MM-DD — applied upstream <short-sha>
Range: <baseline-sha>..<short-sha> in smarttwitchtv-upstream
Slices touched: none / v1.X, v2.Y
Files modified here:
  - app/specific/Play.js (mechanical, mapping row already existed)
  - app/specific/Settings.js (mechanical)
  - app/platform/PlatformShim.js (new row added: <Android.X>)
  - sync/upstream-mapping.md (1 new row)
Conflicts: none / <details — include upstream and fork line ranges + resolution applied>
Notes: <anything unusual>
````

Verification or follow-up records for a particular entry use a `###` subsection under that entry's `##` heading (e.g., `### v1.0 seam verification` appears under `## 2026-05-14 — initial seed`).

## 2026-05-14 — initial seed
Baseline: upstream commit `f32215518` ("Format changelog entry; update release JS bundle"). No upstream commits applied yet; this fork starts from a pristine copy of upstream `app/`.

### v1.0 seam verification (2026-05-14)

Vite dev server confirms:
- HTTP 200 on /tests/platform-stubs.html
- HTTP 200 on /tests/shim-proxy.html
- HTTP 200 on /platform/Platform.js
- HTTP 200 on /platform/PlatformShim.js
- HTTP 200 on / (index.html)
- Script tags for Platform.js and PlatformShim.js present in index.html in correct order (Platform.js before PlatformShim.js, because the shim's IIFE captures `window['Platform']` at load time)

Visual verification by human: pending Chrome DevTools open by user. Result will be recorded as a follow-up `### v1.0 visual verification` subsection appended to this same `## 2026-05-14 — initial seed` block once the user has confirmed.
Expected on app load:
- console.error messages of the form `[Platform] Platform.X.Y not implemented` (loud surfacing of the seam)
- Possibly uncaught PlatformNotImplementedError from upstream code paths that don't try/catch
- Page may render partially or not at all — both acceptable for v1.0

Behavior: the seam is wired. Implementer-level verification complete.

### v1.0 visual verification (2026-05-14)

Driven by Chrome DevTools MCP against Vite dev server. Chrome on macOS.

**`/tests/platform-stubs.html`** — 14/14 PASS:
- window.Platform defined
- capabilities.multiPlayer is false
- capabilities has all 6 expected keys
- multiPlayer is null
- notifications is null
- 9 × `Platform.X.Y throws` (player.start, player.stop, http.request, device.appVersion, lifecycle.exit, storage.get, log.info, input.registerKeys, codec.supports)

Console emitted exactly 9 `[error] [Platform] Platform.X.Y not implemented` messages from the stub `console.error` calls (one per assertThrows). Plus 1 spurious 404 (favicon, cosmetic).

**`/tests/shim-proxy.html`** — 4/4 PASS:
- window.Android exists
- Android.getversion routes to Platform (throws PlatformNotImplementedError method=device.appVersion)
- Android.deviceIsTV routes to Platform (throws PlatformNotImplementedError method=device.isTV)
- unmapped Android.X throws loudly (message: "Android.NeverImplementedDontMapMe not mapped in PlatformShim — see sync/upstream-mapping.md")

Console emitted 3 errors: 2 from the routed Platform stubs, 1 from the shim's loud-unmapped path. All three match the expected `[Platform]` / `[PlatformShim]` prefixes.

**`/` (app entry)**:
- `window.Platform` and `window.Android` both defined (typeof 'object').
- 55 children rendered into `document.body` — the page DOM successfully constructed.
- 1 console.error: `[Platform] Platform.device.appVersion not implemented` — emitted by the boot-time `OSInterface_getversion()` → `Android.getversion()` → shim → `Platform.device.appVersion()` chain. Upstream's `try/catch` in `Main.js` catches it (sets `Main_IsOn_OSInterface=0`) and the app proceeds into browser-mode fallback paths.
- 1 unrelated 401 from a Twitch helix API call without auth (expected in browser/unauth state, not a v1.0 concern).

Conclusion: **the seam is real and behaves exactly as designed**. Upstream's boot-time `Android.X` call routed through the shim to a throwing Platform stub, console-logged loudly, was caught by upstream's existing try/catch, and execution continued. Visual verification closes the open loop from `### v1.0 seam verification`.

Screenshots saved under `sync/screenshots/`:
- `v1.0-platform-stubs.png`
- `v1.0-shim-proxy.png`
- `v1.0-app-boot.png`

## 2026-05-14 — v1.1 PlatformDesktop adapter

Implements browser-side adapter for Platform (device, log, storage, input, partial player via hls.js). No upstream code applied — pure fork work. The app still cannot run upstream's natural flow end-to-end (CORS + http adapter deferred to v1.4, real Twitch auth to v1.5), but `Platform.player.start({uri})` plays any public HLS stream in Chrome.

### v1.1 visual verification (2026-05-14)

Driven by Chrome DevTools MCP against Vite dev server. Chrome on macOS.

**`/tests/desktop-smoke.html`** — **36/36 PASS**:
- Bootstrap (3): hls.js loaded, `Hls.isSupported() === true`, `PlatformDesktopLoaded` flag set.
- device (5): `name`, `manufacturer === "Desktop"`, `systemVersion`, `isTV === false`, `appVersion === "0.0.1"`.
- log (3): `info`/`warn`/`error` each route to corresponding `console.*` (verified by stub-and-restore probe).
- storage (4): missing-key returns null, object round-trip, string round-trip, remove clears.
- capabilities (5): `multiPlayer`/`hardwareHLS`/`surfaceBehindWebView` all `false`; `multiPlayer`/`notifications` namespaces still `null`.
- input (10): `registerKeys()` no-throw, 8 keyCode value checks (BACK=8, UP=38, DOWN=40, LEFT=37, RIGHT=39, ENTER=13, PLAY=32, PAUSE=32), keyCodes object has ≥ 8 keys.
- player (6): `idle` before start; `start` no-throw on Mux's `test-streams.mux.dev/x36xhzz/x36xhzz.m3u8`; reached state `playing` in **1000ms**; pause → `paused`; resume → `playing` again; stop → `idle`.

**Direct video playback proof** (post-smoke, restarted via `evaluate_script`):
- `Platform.player.getState()` → `'playing'`
- `currentTime` → 11.26s (advancing in real time)
- `readyState` → 4 (HAVE_ENOUGH_DATA)
- `paused` → false
- `videoWidth × videoHeight` → 1920×1080
- `playing_indicator` (composite: `!paused && currentTime > 0 && readyState >= 2`) → true

**Console**: zero adapter errors. Only emissions:
- `[warn] smoke warn` and `[error] smoke error` — from the log section's intentional probe, NOT from the adapter.
- 1 favicon 404 (cosmetic).

No `PlatformNotImplementedError` from any surface PlatformDesktop owns.

Conclusion: **video plays end-to-end through the Platform interface in Chrome**. v1.1 deliverable met. Real Twitch flow still deferred per the v1 breakdown (v1.4 HTTP/CORS, v1.5 login, v1.6 PlayHLS refactor).

Screenshots saved under `sync/screenshots/`:
- `v1.1-desktop-smoke.png` — full smoke page, all 36 assertions green
- `v1.1-video-playing.png` — Mux x36xhzz frame rendering in the desktop player

## 2026-05-14 — v1.2 PlatformWebOS boot adapter + IPK packaging

Implements webOS adapter for Platform (device/log/storage/lifecycle.exit). Adds appinfo.json + icons + IPK build script. PlatformDesktop and PlatformWebOS now coexist via complementary `window.webOS` guards.

### v1.2 verification

**Code:**
- `node -c app/platform/PlatformWebOS.js` → syntax OK
- Vite still serves all platform/ files (200 on each)
- 4 contiguous `platform/*.js` script tags in index.html (Platform → Shim → Desktop → WebOS) before `specific/OSInterface.js`

**Icons:**
- Discovered Task 1 copy from user's LG adaptation produced JPEG files renamed `.png` (would have failed `ares-package` validation). Fixed in commit `154b873` — `sips` converted to real PNG and resized to webOS-recommended dimensions (`icon` 80×80, `largeIcon` 130×130).

**IPK build:** ✅ SUCCESS
- `npm run build:webos` produced `dist-ipk/com.fgl27.smarttwitchtv_0.0.1_all.ipk`
- File size: 545,018 bytes (~533 KB)
- `ares-package` reported "Success"

**Emulator install:** ⏳ PENDING USER
- Attempted: `ares-install --device emulator` → `ECONNREFUSED 127.0.0.1:6622`
- Emulator not running at execution time. When the user boots the LG webOS Virtual Box image:
  ```
  npm run install:emulator && npm run launch:emulator
  ```

**Real-TV install:** ⏳ PENDING USER
- Attempted: `ares-install --device webostv` → connection timeout
- TV at `192.168.0.140` unreachable at execution time (off or Developer Mode disabled). When the user wakes the TV:
  ```
  npm run install:tv && npm run launch:tv
  ```

**Visual verification on webOS:** PENDING USER. Expected behavior: launcher tile appears with Twitch-purple icon; launching shows the upstream's index.html UI (mostly working in "browser-mode" fallback because http/lifecycle/player aren't fully wired yet); pressing the back key from root closes the app via `Platform.lifecycle.exit()` → `webOS.platformBack()`.

**Chrome MCP desktop-smoke:** Still 36/36 — PlatformWebOS guards on `window.webOS` and no-ops in the browser; nothing changed. (Spot-verified via `curl -s -o /dev/null -w "%{http_code}" http://localhost:5173/platform/PlatformWebOS.js` → 200.)
