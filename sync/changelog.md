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
