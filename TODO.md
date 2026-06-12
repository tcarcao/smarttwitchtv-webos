# TODO

Items that still need work. Permanent platform/hardware limitations are in
`docs/adrs/` — anything completed gets deleted from here, not archived.

## Real gaps

- **Update mechanism.** No in-app update flow. New versions ship via manual side-load (`npm run deploy:tv` → `ares-install`). LG Content Store submission is the proper distribution path; alternatively, host the IPK on a known URL and have the app check periodically. Out of scope for now.

- **Multi-user.** Login flow works, but multi-user UX (switch users, login a 2nd account) not exercised. Upstream supports it via `AddUser_UsernameArray` being an array; should work but unverified.

## Tooling — quality-of-life

- **`debug:tv` rough edges:**
  - Port detection occasionally races when the inspector dies (e.g., TV app gets backgrounded → YouTube → inspector latches onto wrong page). Recovery: `npm run debug:tv stop`, then re-run any command.
  - No auto-reconnect when CDP page changes (app relaunch). Have to re-run after every `deploy:tv`.
  - Stream/watch ops don't have a clean Ctrl-C; need to `kill` the node process manually.
  - Process orphans on long runs leave `ares-inspect` running. `pkill -f ares-inspect` clears them.
  - **Caution:** an attached inspector janks TV playback (observer effect — verified 2026-06-11). Never diagnose stutter with the inspector attached.

- **Settings UX coverage.** Static enumeration done (138 settings). Most are pure JS/DOM and work; the platform-touching ones are mapped or documented no-ops. No subtle-behavior validation per toggle.
