# Upstream-mapping table

Every `Android.X` function declared in upstream's `app/specific/OSInterface.js`
has one row here, listing its mapping to a `Platform.X` equivalent (or
explicit deferral / skip). When upstream adds a new `Android.X`, a new row
must be added here in the same commit that refactors the caller.

**Source:** `smarttwitchtv-upstream/app/specific/OSInterface.js`
**Last verified against upstream commit:** `f32215518` (baseline seed; subsequent slices update as they pull newer upstream commits)

## Mapping table

| Upstream `Android.X` | `Platform.X` | Status | Notes |
|---|---|---|---|
| `getversion()` | `Platform.device.appVersion()` | mapped | sync; boot-time |
| `getdebug()` | (constant `false`) | mapped | shim returns false; debug builds toggle later |
| `deviceIsTV()` | `Platform.device.isTV()` | mapped | sync |
| `getDevice()` | `Platform.device.name()` | mapped | e.g. "LG OLED55C1" |
| `getManufacturer()` | `Platform.device.manufacturer()` | mapped | e.g. "LG" |
| `getSDK()` | `Platform.device.systemVersion()` | mapped | upstream returns int; webOS returns string — caller may need adjustment |
| `getWebviewVersion()` | `Platform.device.systemVersion()` | mapped | webOS does not distinguish; aliased |
| `mclose(close)` | `Platform.lifecycle.exit({background: !close})` | pending v1.2 | bool inversion: upstream `close=true` means exit; we use `background` flag |
| `mloadUrl(url)` | `Platform.lifecycle.loadUrl(url)` | pending v1.5 | |
| `GetLastIntentObj()` | `Platform.lifecycle.getLaunchParams()` | pending v3 | deep links |
| `SetLanguage(lang)` | `Platform.lifecycle.setLanguage(lang)` | pending v2 | |
| `upDateLang(lang)` | `Platform.lifecycle.setLanguage(lang)` | pending v2 | aliased |
| `keyEvent(key, action)` | (no direct mapping) | skip | synthetic key dispatch; webOS receives keys natively |
| `KeyboardCheckAndHIde()` | (no direct mapping) | skip | Android-specific keyboard hide |
| `hideKeyboardFrom()` | (no direct mapping) | skip | Android-specific |
| `BasexmlHttpGet(url, ...)` | `Platform.http.request({url, ...})` | pending v1.4 | eval-by-name callback → Promise |
| `XmlHttpGetFull(url, ...)` | `Platform.http.request({url, validate, ...})` | pending v1.4 | 5-check slots → single validate predicate |
| `mMethodUrlHeaders(url, ...)` | `Platform.http.request({method: 'HEAD', url})` | pending v1.4 | |
| `StartAuto(uri, playlist, who, resume, player)` | `Platform.player.start({uri, manifestString: playlist, kind: WHO_MAP[who], resumePosition: resume})` | pending v1.6 | `who_called` 0/1/2 → 'live'/'vod'/'clip' (WHO_MAP constant to be defined in `app/specific/PlayHLS.js` at v1.6 implementation; not yet created) |
| `RestartPlayer(who, resume, player)` | `Platform.player.stop()` then `Platform.player.start({...})` | pending v1.6 | same arg shape as StartAuto minus uri/manifest (reuses current); see StartAuto row |
| `ReuseFeedPlayer(uri, playlist, who, resume, player)` | `Platform.multiPlayer?.start(...)` | gated | only if capabilities.multiPlayer |
| `PlayPause(state)` | `state ? Platform.player.resume() : Platform.player.pause()` | pending v1.6 | |
| `PlayPauseChange()` | `Platform.player.getState() === 'playing' ? .pause() : .resume()` | pending v1.6 | |
| `mseekTo(position)` | `Platform.player.seek(position)` | pending v1.6 | |
| `stopVideo()` | `Platform.player.stop()` | pending v1.6 | |
| `mClearSmallPlayer()` | `Platform.multiPlayer?.stop()` | gated | only if capabilities.multiPlayer |
| `getQualities()` | `Platform.player.getQualities()` | pending v1.6 | sync |
| `SetQuality(position)` | `Platform.player.setQuality(position)` | pending v1.6 | |
| `gettime()` | `Platform.player.getCurrentTime()` | pending v1.6 | sync, ms |
| `gettimepreview()` | (no direct mapping) | skip | multi-player preview; revisit v4 if multiPlayer capability lands |
| `getVideoStatus(showLatency, whoCalled)` | `Platform.player.on('progress', handler)` | pending v1.6 | callback-by-name → event subscription |
| `getVideoQuality(whoCalled)` | `Platform.player.on('qualitychange', handler)` | pending v1.6 | |
| `getDuration(callback)` | `Platform.player.getDuration()` | pending v1.6 | sync return, drop callback |
| `getPlaybackState()` | `Platform.player.getState()` | pending v1.6 | |
| `EnableMultiStream(MainBig, offset)` | `Platform.multiPlayer?.enable({mainBig, offset})` | gated | |
| `DisableMultiStream()` | `Platform.multiPlayer?.disable()` | gated | |
| `StartMultiStream(position, uri, playlist, restart)` | `Platform.multiPlayer?.start({position, uri, manifestString})` | gated | |
| `(remaining ~60 functions)` | | | populate by walking `smarttwitchtv-upstream/app/specific/OSInterface.js` end to end |

## Row format reference

- **Upstream `Android.X`:** exact function name and parameters as declared upstream
- **`Platform.X`:** the equivalent call; use `?.` when capability-gated (`multiPlayer?.start`)
- **Status:** one of
  - `mapped` — implemented in PlatformShim; routes correctly today
  - `pending vX.Y` — slot reserved for slice vX.Y of the v1 plan
  - `gated` — only implemented if `Platform.capabilities.<capability>` is true; the Platform.X column's `?.` chain names the capability (e.g., `Platform.multiPlayer?.start` ⇒ `capabilities.multiPlayer`)
  - `skip` — intentionally not ported (Android-specific concern)
- **Notes:** any caller-side adjustments (signature changes, sync→async, callback→event)

## Workflow when adding a row

1. Identify the upstream function (`grep -n "function OSInterface_" smarttwitchtv-upstream/app/specific/OSInterface.js`).
2. Pick the responsibility namespace in Platform (player, http, lifecycle, etc.).
3. Add the row, marking status `pending vX.Y` if not yet implemented.
4. When implementing, change status to `mapped` and add the mapping entry to `PlatformShim.js` (or refactor the caller to use `Platform.X` directly, deleting the shim entry).
