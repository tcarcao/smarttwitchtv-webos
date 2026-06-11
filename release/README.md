# Release / deploy workflow

## One-time setup

- `npm install` — Vite for dev server + IPK build.
- LG webOS SDK CLI on `PATH` (`ares-cli`). Doctor verifies.
- macOS webOS TV Simulator at `/Applications/webOS_TV_*_Simulator_*.app` for emulator testing.
- Optional real TV registered with `ares-setup-device --add webostv ...` (already done on this machine).

Check the toolchain anytime:

```bash
npm run doctor
```

## Dev loop (browser)

```bash
npm run dev      # vite at http://localhost:5173 with /__proxy + /__usher
```

Twitch hosts are auto-rewritten via `/__proxy?url=...` in `Platform.http.request`
(see `app/platform/PlatformDesktop.js`). `hls.js` segments go through `/__usher`.

## Emulator loop

```bash
npm run sim                  # opens /Applications/webOS_TV_*_Simulator
npm run deploy:emulator      # build IPK → install → launch
npm run inspect:emulator     # open Chrome DevTools attached to the app
```

`deploy:emulator` calls `release/scripts/deploy.sh emulator`, which is:
`build:webos` → `install:emulator` → `launch:emulator`. Pass `--skip-build`
to reuse the existing IPK:

```bash
bash release/scripts/deploy.sh emulator --skip-build
```

## Real TV loop

Identical commands with `:tv` suffix:

```bash
npm run deploy:tv
npm run inspect:tv
```

The `webostv` device profile uses SSH key + passphrase, pre-registered.

## What gets built

`build:webos` (= `release/scripts/build-webos.sh`):

1. Wipes `dist-webos/` staging.
2. Copies `app/*` to the bundle root.
3. Adds `webos/appinfo.json` + icons.
4. Runs `ares-package` → `dist-ipk/com.fgl27.smarttwitchtv_0.0.1_all.ipk`.

The IPK contains the full bridge-layer architecture: `Platform.js` →
`PlatformShim.js` → `PlatformWebOS.js` (no-ops in browser, active here) →
unmodified upstream `Play.js` / `Screens.js` / `OSInterface.js`.

## Troubleshooting

- **`ares-package not found`** — install LG webOS SDK CLI. Doctor flags this.
- **Simulator install fails** — make sure the simulator window is actually
  running (`npm run sim`) before deploying. ares-install SSHes to
  `127.0.0.1:6622`.
- **DevTools URL won't open** — `ares-inspect --open` requires a working
  browser binding. Without `--open` it just prints the URL you can paste.
- **CORS errors on TV** — should not happen (TV WebView has no cross-origin
  block), but if usher.ttvnw.net behaves like a browser, we'd need a Luna
  service proxy. Flagged in `AFK-SESSION-SUMMARY.md` as a potential
  v1.7.x slice.
