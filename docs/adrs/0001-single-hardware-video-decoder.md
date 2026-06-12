# ADR 0001: Single hardware video decoder — no live preview overlay, no multistream on TV

- **Status:** Accepted
- **Date:** 2026-06-12

## Context

LG webOS's WebView has a single hardware video decoder instance. Creating (or
playing) a second `<video>` element pauses the first one — confirmed on a real
LG TV with a bare-metal test page (no hls.js, none of our code; an unrelated
second `<video>` paused the main stream).

The upstream Android app supports N concurrent players by querying
`MediaCodec` decoder capabilities (`instances` feeds `Play_MaxInstances`),
which gates the feed-row live-preview overlay and the 4-way multistream UX
(`!` hotkey).

## Decision

The shim's `getcodecCapabilities` (app/platform/PlatformShim.js) reports
`instances: 1` on TV and `4` on Desktop, driven by
`Platform.capabilities.multiPlayer`. Upstream's own gating then disables the
live-preview overlay and multistream on TV with no upstream-file changes.

Do **not** "fix" this by reporting more instances — it silently breaks the
main stream the moment a preview spawns.

## Consequences

- Live preview overlay and 4-way multistream are Desktop-only. The TV feed
  row still renders static thumbnails.
- The multistream UI affordance remains visible upstream but won't start the
  extra streams on TV.
- Possible future UX, if ever wanted: poll Twitch's thumbnail JPEG (~30 s
  refresh) into the focused tile slot — visual feedback without a second
  video pipeline. Deferred indefinitely.
