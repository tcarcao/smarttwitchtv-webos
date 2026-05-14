# smarttwitchtv-webos

LG webOS port of [SmartTwitchTV](https://github.com/fgl27/smarttwitchtv).

**Status:** v1.0 scaffolding. Not usable yet.

**Design spec:** `docs/superpowers/specs/2026-05-14-webos-port-design.md`

## Development

```bash
npm install
npm run dev
```

Opens at `http://localhost:5173`. v1.0 expectation: the app boots into a `console.error` storm of `PlatformNotImplementedError` messages — that's success, the seam is wired.

## Sync from upstream

See `sync/apply-upstream.md`.
