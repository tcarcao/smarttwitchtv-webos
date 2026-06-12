# SmartTwitchTV — webOS port

Unofficial LG webOS (smart TV) port of
[SmartTwitchTV](https://github.com/fgl27/SmartTwitchTV), the Twitch player app
for Android TV by Felipe de Leon ([@fgl27](https://github.com/fgl27)).

Plays live Twitch streams on real LG TVs: hardware-decoded 1080p60, fast
startup (single usher session, source-quality first fragment), quality
selection, HEVC/AV1 negotiation where the TV supports it, chat, VODs, clips.

## Attribution & license

This project is a derivative work of SmartTwitchTV and is licensed under the
**GNU General Public License v3.0** (see [LICENSE](LICENSE)), the same license
as upstream.

- The application logic under `app/specific/`, `app/languages/`, and related
  upstream directories is © 2017–present Felipe de Leon, vendored
  **byte-identical** from upstream — by design, those files are never modified
  here (see Architecture below).
- The webOS platform layer (`app/platform/`, `app/specific/PlayHLSPlatform.js`,
  build/deploy tooling under `release/`) is original work of this repository,
  under the same GPL-3.0.

## Architecture

Upstream's app JS calls a native Android bridge (`Android.*` /
`OSInterface_*`). This port keeps every upstream file untouched and provides:

- `app/platform/Platform.js` — the platform interface
- `app/platform/PlatformWebOS.js` — real TV adapter (hls.js + `<video>`,
  webOS Luna services, TV remote keycodes)
- `app/platform/PlatformDesktop.js` — desktop Chrome adapter for development
- `app/platform/PlatformShim.js` — exposes `window.Android` as a Proxy that
  routes upstream's bridge calls onto `Platform.*`

Permanent platform/hardware limitations are recorded as ADRs in
[`docs/adrs/`](docs/adrs/). Remaining work: [`TODO.md`](TODO.md).

## Development

```bash
npm install
npm run dev          # Vite dev server (root = app/) at http://localhost:5173
```

Player test page: `http://localhost:5173/tests/player-hls.html`
Live-playback smoke: `http://localhost:5173/tests/twitch-watch.html`

Build, deploy to TV/emulator, and on-TV debugging: see
[`release/README.md`](release/README.md).

## Sync from upstream

See [`sync/apply-upstream.md`](sync/apply-upstream.md) and
[`sync/upstream-mapping.md`](sync/upstream-mapping.md).
