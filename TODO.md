# TODO

Items that still need work. Permanent platform/hardware limitations are in
`docs/adrs/` — anything completed gets deleted from here, not archived.

## Real gaps

- **Update mechanism.** No in-app update flow. New versions ship via manual side-load (`npm run deploy:tv` → `ares-install`). LG Content Store submission is the proper distribution path; alternatively, host the IPK on a known URL and have the app check periodically. Out of scope for now.

- **Multi-user.** Login flow works, but multi-user UX (switch users, login a 2nd account) not exercised. Upstream supports it via `AddUser_UsernameArray` being an array; should work but unverified.

- **Shim-injected strings aren't localized.** Toasts the platform layer adds
  (update guidance, playback-speed warning, "X is live" notifications) are
  hardcoded English; upstream's `STR_*` language tables don't cover them.
  Needs a small string table in PlatformShim keyed off upstream's language
  setting.

## Explorations

- **Hybrid hosted distribution (post-store).** Upstream's model — app served
  from github.io — doesn't transfer directly: their Twitch traffic goes
  through the native Android HTTP bridge, ours is browser XHR that only
  escapes CORS because the packaged app runs from a file:// origin (a pure
  hosted page would be blocked by usher.ttvnw.net, same reason desktop dev
  needs the /__usher proxy). The workable variant is a hybrid: keep the
  packaged IPK (retains the CORS exemption) but have a thin index.html load
  the JS bundles via `<script src>` from our hosting, version-pinned by
  version.json — most of the "ship fixes without IPK reinstall / store
  re-review" benefit with no proxy server. Revisit after LG store approval;
  de-risk first with a CDP probe on the TV fetching usher from an https
  origin to confirm where webOS draws its CORS line.

## Tooling — quality-of-life

- **`debug:tv` rough edges:**
  - Port detection occasionally races when the inspector dies (e.g., TV app gets backgrounded → YouTube → inspector latches onto wrong page). Recovery: `npm run debug:tv stop`, then re-run any command.
  - No auto-reconnect when CDP page changes (app relaunch). Have to re-run after every `deploy:tv`.
  - Stream/watch ops don't have a clean Ctrl-C; need to `kill` the node process manually.
  - Process orphans on long runs leave `ares-inspect` running. `pkill -f ares-inspect` clears them.
  - **Caution:** an attached inspector janks TV playback (observer effect — verified 2026-06-11). Never diagnose stutter with the inspector attached.

- **Settings UX coverage.** Static enumeration done (138 settings). Most are pure JS/DOM and work; the platform-touching ones are mapped or documented no-ops. No subtle-behavior validation per toggle.
