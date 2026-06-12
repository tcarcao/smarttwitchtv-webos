# ADR 0002: No playback-speed control on TV (webOS clamps playbackRate)

- **Status:** Accepted
- **Date:** 2026-06-12

## Context

webOS TV's WebView clamps `HTMLMediaElement.playbackRate` above 1.0 down to
1.0 and only partially honours rates below 1.0. Verified by direct probe on a
real TV (effective rate for a set rate):

| Set   | Chrome desktop | webOS TV |
|-------|----------------|----------|
| 0.5x  | 0.51           | 0.77     |
| 1.5x  | 1.54           | 1.0      |
| 2.0x  | 1.97           | 1.0      |

## Decision

`Platform.capabilities.controlsPlaybackRate` is `false` on webOS, `true` on
Desktop. The shim surfaces a one-shot toast ("Playback speed control isn't
supported on this TV") on the first non-1.0 attempt and still passes the call
through (1.0 works; partial slowdown below 1.0 works).

Rejected alternative: emulating speed > 1 with periodic seek-skips — visually
ugly (frame jumps), and doubly broken on webOS because the TV also swallows
MSE seeks (see `_buildHlsConfig` comments in app/platform/PlatformWebOS.js).

## Consequences

- VOD speed control is Desktop-only.
- hls.js `maxLiveSyncPlaybackRate` (the `speed_adjust` live-edge chasing
  ported from upstream's media3 speedAdjustment) is **inert on TV** — the
  clamp holds playback at 1.0x. Live latency on TV is therefore whatever
  accumulates from stalls and is never actively recovered; combined with the
  swallowed-seeks constraint this is accepted behaviour, matching how the
  stream stabilises naturally a few seconds behind the edge.
