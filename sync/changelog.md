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
