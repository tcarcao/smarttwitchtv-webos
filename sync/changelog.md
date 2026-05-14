# Upstream-sync changelog

Records which upstream commits have been applied to this fork. Append-only.

## Format

Each entry:

````
## 2026-MM-DD — applied upstream <short-sha>
Range: <baseline-sha>..<short-sha> in smarttwitchtv-upstream
Slices touched: v1.X, v2.Y
Files modified here:
  - app/specific/Play.js (mechanical, mapping row already existed)
  - app/specific/Settings.js (mechanical)
  - app/platform/PlatformShim.js (new row added: <Android.X>)
  - sync/upstream-mapping.md (1 new row)
Conflicts: none / <details>
Notes: <anything unusual>
````

## 2026-05-14 — initial seed
Baseline: upstream commit `f32215518` ("Format changelog entry; update release JS bundle"). No upstream commits applied yet; this fork starts from a pristine copy of upstream `app/`.
