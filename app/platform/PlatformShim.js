/**
 * PlatformShim — legacy compatibility layer.
 *
 * Upstream JS calls window.Android.X(...) directly. This shim defines
 * window.Android as a Proxy that translates each call into Platform.X
 * equivalents. Upstream code stays unmodified; all adaptation happens
 * here. When upstream's OSInterface_getversion succeeds (returns a
 * truthy string), Main_IsOn_OSInterface becomes true and upstream
 * runs its native Android-path everywhere — chat, controls, progress
 * bar, tile previews, all rendered by upstream UI.
 *
 * Unmapped methods console.warn and return undefined (no-op). This
 * prevents boot-time exceptions from features we don't care about
 * (notifications, etc.) while making unmapped surface visible for
 * targeted mapping later. The default DOES NOT throw — that was the
 * old behaviour and it broke boot on `setAppIds` etc.
 *
 * Map of who_called → kind comes from grep across specific/*.js
 * (NOT the doc comment in upstream which says 0/1/2 — the actual
 * call sites use 1/2/3):
 *   1 = live (Play.js, PlayExtra.js, PlayEtc.js, PlayMulti.js)
 *   2 = vod  (PlayVod.js)
 *   3 = clip (PlayClip.js)
 */
(function() {
    'use strict';

    if (typeof window.Proxy !== 'function') {
        throw new Error('PlatformShim requires Proxy support (webOS 4.0+ / any modern browser)');
    }
    if (!window['Platform']) {
        throw new Error('PlatformShim: Platform.js must load first');
    }
    var Platform = window['Platform'];

    var WHO_MAP = {1: 'live', 2: 'vod', 3: 'clip'};

    // Notification state — mirrors what upstream would push to the Android
    // service. We hold it in memory so future foreground polling (when we
    // wire it) can read live/title/game flags without re-deriving from
    // Settings_value. See the Notifications block lower down.
    var _notifState = {
        live: false, title: false, game: false,
        position: 0, repeat: 0, sinceMs: 0,
        enabled: false, serviceRequested: false
    };

    // One-shot warning latch for playback-rate-not-supported toast.
    var _warnedAboutPlaybackRate = false;

    // -- focused feed-tile rect --
    // Upstream's UserLiveFeed_CheckIfIsLiveResult uses the same lookup just
    // before calling OSInterface_SetPlayerViewFeedBottom + StartFeedPlayer:
    // `ulf_img_<X>_<Y>`'s parent element is the visible cell tile. Mirror
    // that here so Platform.preview can size/position itself ON the
    // focused thumbnail instead of a fixed corner overlay. Returns null
    // when upstream globals aren't ready (preview falls back to its
    // default corner rect, which is harmless).
    function _focusedFeedTileRect() {
        try {
            if (typeof window.UserLiveFeed_ids !== 'object' ||
                typeof window.UserLiveFeed_FeedPosX === 'undefined' ||
                typeof window.UserLiveFeed_FeedPosY === 'undefined') return null;
            var x = window.UserLiveFeed_FeedPosX;
            var y = window.UserLiveFeed_FeedPosY[x];
            var id = window.UserLiveFeed_ids[1] + x + '_' + y; // ulf_img_<x>_<y>
            var el = document.getElementById(id);
            if (!el || !el.parentElement) return null;
            var r = el.parentElement.getBoundingClientRect();
            if (!r.width || !r.height) return null;
            return {top: r.top, left: r.left, width: r.width, height: r.height};
        } catch (e) {
            return null;
        }
    }

    // -- toast --
    // Upstream calls Android.showToast for UPDATE_RESULT / BACKUP_SUCCESS /
    // CHECKING_FAIL / NO_UPDATES etc. — all silent until now because our
    // shim no-op'd it. Implement a DOM-based toast that auto-dismisses.
    // Stacks calls: a second toast during the first one's display fades the
    // first out and shows the second (mirrors Android Toast.show behaviour).
    var _toastEl = null;
    var _toastTimer = null;
    function _toastEnsure() {
        if (_toastEl && document.body.contains(_toastEl)) return;
        _toastEl = document.createElement('div');
        _toastEl.id = 'platform-toast';
        // Inline styles so we don't depend on a CSS file load. !important
        // beats any upstream selector that might match (the LG app has very
        // broad rules on positioned divs).
        var s = _toastEl.style;
        s.cssText = [
            'position: fixed', 'bottom: 6%', 'left: 50%',
            'transform: translateX(-50%)',
            'background: rgba(0, 0, 0, 0.88)',
            'color: #fff',
            'padding: 0.7em 1.6em',
            'border-radius: 0.6em',
            'font-size: 1.4em',
            'font-family: inherit',
            'max-width: 70%',
            'text-align: center',
            'z-index: 100000',     // above scene_keys (z=200) and dialogs
            'pointer-events: none',
            'opacity: 0',
            'transition: opacity 220ms ease',
            'box-shadow: 0 0.2em 0.8em rgba(0,0,0,0.5)',
            'line-height: 1.3'
        ].join(';');
        document.body.appendChild(_toastEl);
    }
    function _showToast(message) {
        if (message == null) return;
        var text = String(message);
        if (!text) return;
        try {
            _toastEnsure();
            _toastEl.textContent = text;
            // Show INSTANTLY (no fade-in): turn off the transition just for
            // this style write, set opacity, then restore. Without this the
            // 220ms transition makes the toast invisible for the first frame
            // — fine for users but causes flaky validation when a test
            // screenshots immediately. Fade-out path keeps the transition.
            _toastEl.style.transition = 'none';
            _toastEl.style.opacity = '1';
            // Force reflow so the new opacity is committed before we
            // re-enable transition for the fade-out.
            void _toastEl.offsetWidth;
            _toastEl.style.transition = 'opacity 220ms ease';
            if (_toastTimer) clearTimeout(_toastTimer);
            _toastTimer = setTimeout(function() {
                if (_toastEl) _toastEl.style.opacity = '0';
                _toastTimer = null;
            }, 3500);
        } catch (e) {
            console.log('[Toast]', text);
        }
    }

    // -- helpers --
    function _parseHeaders(json) {
        if (!json) return [];
        try {
            var parsed = JSON.parse(json);
            if (Array.isArray(parsed)) return parsed;
            if (parsed && typeof parsed === 'object') {
                var out = [];
                for (var k in parsed) {
                    if (Object.prototype.hasOwnProperty.call(parsed, k)) {
                        out.push([k, parsed[k]]);
                    }
                }
                return out;
            }
        } catch (e) {}
        return [];
    }
    function _invokeCallback(name, args) {
        try {
            if (typeof name === 'string' && typeof window[name] === 'function') {
                window[name].apply(window, args);
            }
        } catch (e) {
            console.error('[PlatformShim] callback', name, 'threw', e);
        }
    }
    function _buildResult(status, url, bodyStr, checkResult) {
        return JSON.stringify({
            status: status,
            url: url,
            responseText: bodyStr,
            checkResult: checkResult
        });
    }
    // Upstream's (bottom, right, left, web_height) come straight from a tile's
    // getBoundingClientRect(): bottom/right/left are viewport-top/left offsets,
    // NOT CSS edge insets. The LG OSInterface treats them as such and
    // reconstructs a CSS rect assuming the tile is 16:9. We do the same so
    // the <video> overlays the focused tile precisely.
    // (height arg = window.innerHeight; we ignore it for tile rects but
    // keep it for the fullscreen check.)
    function _rectFromTileBox(bottom, right, left /*, web_height */) {
        var width = right - left;
        var height = width * 9 / 16;
        return {
            top: bottom - height,
            left: left,
            width: width,
            height: height,
            kind: 'tile'   // z-index 2 — covers grid thumbnail backgrounds
        };
    }

    // For chat-side-by-side mode, compute the video rect that fits beside
    // the chat overlay. Reads upstream's Play_FullScreenPosition + Play_
    // FullScreenSize config and Play_ChatFullScreenSizes table. Returns a
    // pixel rect or null if config unavailable.
    function _sideBySideRect() {
        var pos = window['Play_FullScreenPosition'];
        var size = window['Play_FullScreenSize'];
        var table = window['Play_ChatFullScreenSizes'];
        if (typeof pos !== 'number' || typeof size !== 'number' || !table || !table[pos] || !table[pos][size]) {
            return null;
        }
        var chat = table[pos][size];
        var W = window.innerWidth;
        var H = window.innerHeight;
        function pct(v) { return parseFloat(String(v).replace('%', '')) / 100; }
        var chatLeft = pct(chat.left);
        var chatWidth = pct(chat.width);
        if (pos === 0) {
            // Chat on the left → video starts right after it.
            var vidLeft = chatLeft + chatWidth;
            return {
                top: 0,
                left: Math.round(vidLeft * W),
                width: Math.round((1 - vidLeft) * W),
                height: H,
                kind: 'overlay'   // z-index 0 — sits below UI controls
            };
        }
        // Chat on the right (any non-zero pos) → video occupies left up to chat's left edge.
        return {
            top: 0,
            left: 0,
            width: Math.round(chatLeft * W),
            height: H,
            kind: 'overlay'
        };
    }

    var mapping = {
        // ============ Boot / device ============
        getversion:        function() { return Platform.device.appVersion(); },
        getdebug:          function() { return false; },
        deviceIsTV:        function() { return Platform.device.isTV(); },
        getDevice:         function() { return Platform.device.name(); },
        getManufacturer:   function() { return Platform.device.manufacturer(); },
        getSDK:            function() { return Platform.device.systemVersion(); },
        getWebviewVersion: function() { return Platform.device.systemVersion(); }, // same as getSDK
        // setAppIds is Firebase analytics setup; no-op so boot succeeds and
        // Main_IsOn_OSInterface stays true.
        setAppIds:         function(/* backupId, ?, ? */) {},
        initbodyClickSet:  function() {},

        // ============ Player control ============
        StartAuto: function(uri, mainPlaylistString, who_called, ResumePosition, /* player */) {
            Platform.player.start({
                uri: uri,
                manifestString: mainPlaylistString,
                kind: WHO_MAP[who_called] || 'live',
                resumePosition: ResumePosition > 0 ? ResumePosition : undefined,
                rect: {fullscreen: true}
            });
        },
        RestartPlayer: function(/* who_called, ResumePosition, player */) {
            Platform.player.stop();
            // The caller has to re-supply uri/playlist; in upstream the
            // RestartPlayer path is followed by another StartAuto. Just stop.
        },
        ReuseFeedPlayer: function(uri, mainPlaylistString, who_called, ResumePosition, /* player */) {
            // Used after a transient stop (e.g. resize, quality change). Same
            // as StartAuto from our pure-DOM perspective.
            Platform.player.start({
                uri: uri,
                manifestString: mainPlaylistString,
                kind: WHO_MAP[who_called] || 'live',
                resumePosition: ResumePosition > 0 ? ResumePosition : undefined,
                rect: {fullscreen: true}
            });
        },
        PlayPause: function(state) {
            if (state) Platform.player.resume();
            else Platform.player.pause();
        },
        PlayPauseChange: function() {
            var s = Platform.player.getState();
            if (s === 'playing') Platform.player.pause();
            else Platform.player.resume();
        },
        mseekTo: function(positionMs) {
            Platform.player.seek(positionMs);
        },
        stopVideo: function() {
            Platform.player.stop();
        },
        gettime: function() {
            return Platform.player.getCurrentTime();
        },
        gettimepreview: function() {
            return 0;  // multi-player not implemented
        },
        getPlaybackState: function() {
            return Platform.player.getState() === 'playing';
        },
        getQualities: function() {
            // Upstream callers `JSON.parse(Android.getQualities())` expects a
            // string. Build a shape that matches what upstream's Android side
            // returns. We expose what hls.js knows.
            var qs = Platform.player.getQualities();
            return JSON.stringify(qs || []);
        },
        SetQuality: function(position) {
            Platform.player.setQuality(position);
        },
        // Status / event queries — upstream calls these and reads a global
        // callback (Main_getVideoStatus_Callback etc.). For now we just
        // immediately fire a benign callback so upstream doesn't hang.
        getVideoStatus: function(/* showLatency, whoCalled */) {
            // upstream reads window.Main_getVideoStatus_Callback(jsonString)
            _invokeCallback('Main_getVideoStatus_Callback', [JSON.stringify({
                droppedFrames: 0,
                bufferSize: 0
            })]);
        },
        getVideoQuality: function(/* whoCalled */) {
            _invokeCallback('Main_getVideoQuality_Callback', [JSON.stringify({index: -1})]);
        },
        getDuration: function(callback) {
            var d = Platform.player.getDuration();
            _invokeCallback(callback, [d]);
        },
        updateScreenDuration: function(callback, key, obj_id) {
            var d = Platform.player.getDuration();
            _invokeCallback(callback, [d, key, obj_id]);
        },
        setPlaybackSpeed: function(speed) {
            // Honest UX on platforms whose media pipeline doesn't honour
            // playbackRate (webOS TV WebView clamps > 1.0 to 1.0). Surface
            // a toast on the first non-1 attempt so the user knows the
            // setting isn't broken — it's a platform limitation. Pass the
            // call through anyway: 1.0 still works, and rates < 1.0 are
            // partially honoured on webOS.
            if (Platform.capabilities &&
                Platform.capabilities.controlsPlaybackRate === false &&
                typeof speed === 'number' && speed !== 1 &&
                !_warnedAboutPlaybackRate) {
                _warnedAboutPlaybackRate = true;
                _showToast('Playback speed control isn’t supported on this TV');
            }
            Platform.player.setPlaybackSpeed(speed);
        },

        // ============ Audio ============
        // Upstream's multi-stream Android build supports 4 simultaneous audio
        // tracks, one per player position. Our single <video> only has
        // position 0; we ignore the rest until Platform.preview exists.
        // ApplyAudio is a commit step on Android (deferred until a batch is
        // ready); on web our setVolume/setMuted apply synchronously so it's a
        // no-op.
        SetVolumes: function(v0 /* , v1, v2, v3 */) {
            if (typeof v0 === 'number') Platform.player.setVolume(v0);
        },
        SetAudioEnabled: function(b0 /* , b1, b2, b3 */) {
            if (Platform.player.setMuted) Platform.player.setMuted(!b0);
        },
        ApplyAudio: function() {},

        // ============ Player surface positioning ============
        // The KEY for the tile-preview & top-portion-with-categories UX.
        // Upstream computes a rect via getBoundingClientRect() of the target
        // tile/area and asks the bridge to put the SAME video element there.
        StartScreensPlayer: function(uri, mainPlaylistString, resumePosition, bottom, right, left, web_height, who_called) {
            Platform.player.start({
                uri: uri,
                manifestString: mainPlaylistString,
                kind: WHO_MAP[who_called] || 'live',
                resumePosition: resumePosition > 0 ? resumePosition : undefined,
                rect: _rectFromTileBox(bottom, right, left, web_height)
            });
        },
        ScreenPlayerRestore: function(bottom, right, left, web_height, /* who_called, isBigger */) {
            Platform.player.setRect && Platform.player.setRect(_rectFromTileBox(bottom, right, left, web_height));
        },
        SetPlayerViewFeedBottom: function(/* bottom, web_height */) {
            // Upstream calls this just before StartFeedPlayer with the
            // focused cell's bottom-Y. We do the full DOM lookup ourselves
            // in StartFeedPlayer / SetFeedPosition; just re-pin the preview
            // rect here in case upstream re-fires this between scrolls.
            if (typeof Play_isOn !== 'undefined' && Play_isOn &&
                Platform.preview && Platform.preview.setRect) {
                Platform.preview.setRect(_focusedFeedTileRect());
            }
        },
        SetPlayerViewSidePanel: function(bottom, right, left, web_height) {
            Platform.player.setRect && Platform.player.setRect(_rectFromTileBox(bottom, right, left, web_height));
        },
        SetFeedPosition: function(/* position */) {
            if (typeof Play_isOn !== 'undefined' && Play_isOn &&
                Platform.preview && Platform.preview.setRect) {
                Platform.preview.setRect(_focusedFeedTileRect());
            }
        },
        FixViewPosition: function(/* orientation, who_called */) {}, // no-op; DOM <video> reflows naturally
        // Resize the player surface for fullscreen vs side-by-side-with-chat.
        // When !isFullScreen, upstream's Play_FullScreenPosition/Size config
        // determines where chat sits and how wide it is — we reflect that
        // by carving out the video rect to fill the remaining width.
        // Mirrors LG's OSInterface_mupdatesize layout math.
        mupdatesize: function(isFullScreen) {
            if (!Platform.player.setRect) return;
            if (isFullScreen) {
                Platform.player.setRect({fullscreen: true});
                return;
            }
            var rect = _sideBySideRect();
            Platform.player.setRect(rect || {fullscreen: false});
        },
        mupdatesizePP: function(isFullScreen) {
            // Picture-in-picture variant — same behaviour for our single video.
            if (!Platform.player.setRect) return;
            if (isFullScreen) {
                Platform.player.setRect({fullscreen: true});
                return;
            }
            var rect = _sideBySideRect();
            Platform.player.setRect(rect || {fullscreen: false});
        },
        mSetPlayerPosition: function(/* picturePos */) {},
        mSwitchPlayer: function() {},
        mSwitchPlayerPosition: function(/* picturePos */) {},
        mSwitchPlayerSize: function(/* size */) {},
        SetFullScreenPosition: function(/* pos */) {},
        SetFullScreenSize: function(/* size */) {},
        msetPlayer: function(/* surface, FullScreen */) {},
        // Preview / feed / side-panel players are a SECONDARY surface in
        // upstream's Android build — a separate video view that shows a
        // hover-preview of another stream while the main keeps playing.
        //
        // Routing rules:
        //   Play_isOn = true   → secondary calls go to Platform.preview
        //                        (if the adapter implements it) — main is
        //                        untouched, small overlay shows the new
        //                        stream. If Platform.preview is absent the
        //                        calls become no-ops; main keeps playing.
        //   Play_isOn = false  → preview / feed list is using the main
        //                        surface as the tile preview; preserve the
        //                        original Platform.player routing so the
        //                        tile preview keeps working.
        StartFeedPlayer: function(uri, mainPlaylistString, /* position */ _position, resumePosition, isVod) {
            void _position;
            if (!uri) return;
            var args = {
                uri: uri,
                manifestString: mainPlaylistString,
                kind: isVod ? 'vod' : 'live',
                resumePosition: resumePosition > 0 ? resumePosition : undefined
            };
            if (typeof Play_isOn !== 'undefined' && Play_isOn) {
                args.rect = _focusedFeedTileRect();
                if (Platform.preview && Platform.preview.start) Platform.preview.start(args);
                return;
            }
            Platform.player.start(args);
        },
        StartSidePanelPlayer: function(uri, mainPlaylistString) {
            if (!uri) return;
            var args = {uri: uri, manifestString: mainPlaylistString, kind: 'live'};
            if (typeof Play_isOn !== 'undefined' && Play_isOn) {
                args.rect = _focusedFeedTileRect();
                if (Platform.preview && Platform.preview.start) Platform.preview.start(args);
                return;
            }
            Platform.player.start(args);
        },
        SidePanelPlayerRestore: function() {},
        mClearSmallPlayer:   function() {
            if (Platform.preview && Platform.preview.stop) Platform.preview.stop();
        },
        ClearSidePanelPlayer: function() {
            if (typeof Play_isOn !== 'undefined' && Play_isOn) {
                if (Platform.preview && Platform.preview.stop) Platform.preview.stop();
                return;
            }
            Platform.player.stop();
        },
        ClearFeedPlayer: function() {
            if (typeof Play_isOn !== 'undefined' && Play_isOn) {
                if (Platform.preview && Platform.preview.stop) Platform.preview.stop();
                return;
            }
            Platform.player.stop();
        },

        // ============ Multi-stream (no-op — capability gated off) ============
        EnableMultiStream:  function(/* mainBig, offset */) {},
        DisableMultiStream: function() {},
        StartMultiStream:   function(/* position, uri, playlist, restart */) {},

        // ============ Codec / bandwidth ============
        setBlackListQualities: function(/* list */) {},
        setBlackListMediaCodec: function(/* list */) {},
        getcodecCapabilities: function(codec) {
            // Upstream reads this once per codec (avc, hevc, av01) and uses
            // `instances` to compute Play_MaxInstances — which gates the
            // feed-row preview AND the 4-way multi-stream UX.
            //
            // Multi-video on the web is platform-dependent: regular Chromium
            // supports many concurrent <video> elements; the webOS TV
            // WebView (verified empirically on a real LG TV) auto-pauses
            // the first <video> the moment a second one is created or
            // played, because the hardware decoder is single-instance.
            // Lying about instances here would break the main stream on TV
            // for no visible gain.
            //
            // We honour Platform.capabilities.multiPlayer set by the
            // adapter: when true (Desktop), report 4 AVC instances so the
            // feed-row preview overlay fires; when false (WebOS TV), report
            // 1 so UserLiveFeed_MaxInstances stays false and OSInterface_
            // StartFeedPlayer is never invoked — main player stays
            // uninterrupted, the feed row still renders thumbnails.
            var multi = Platform.capabilities && Platform.capabilities.multiPlayer;
            var probes = {
                avc:  {mime: 'video/mp4; codecs="avc1.640028"',      type: 'video/avc',  name: 'h264'},
                hevc: {mime: 'video/mp4; codecs="hvc1.1.6.L153.B0"', type: 'video/hevc', name: 'hevc'},
                av01: {mime: 'video/mp4; codecs="av01.0.08M.08"',    type: 'video/av01', name: 'av1'}
            };
            var probe = probes[codec];
            if (!probe) return JSON.stringify([]);
            // h264 is the universal baseline — always report it. hevc/av01
            // only when MSE can actually decode them: Settings.js matches
            // 'hevc'/'av01' inside .type to set Settings_HEVCSupported /
            // Settings_AV1Supported, which gate the supported_codecs usher
            // param (Twitch's 1440p/4K enhanced renditions need h265/av1).
            var supported = codec === 'avc' ||
                !!(window.MediaSource &&
                   typeof window.MediaSource.isTypeSupported === 'function' &&
                   window.MediaSource.isTypeSupported(probe.mime));
            if (!supported) return JSON.stringify([]);
            return JSON.stringify([{
                CanonicalName: 'platform.web.' + probe.name + '.decoder',
                name: 'platform.web.' + probe.name + '.decoder',
                nameType: 'platform.web.' + probe.name + '.decodervideo/' + codec,
                type: probe.type,
                instances: multi ? 4 : 1,
                isHardwareAccelerated: true,
                isSoftwareOnly: false,
                maxbitrate: '120 Mbps',
                maxlevel: '5.2',
                maxresolution: '4096x4096',
                resolutions: '1080p : 60 fps',
                supportsIsHw: true
            }]);
        },
        SetSmallPlayerBandwidth: function(/* bitrate, resolution */) {},
        SetSmallPlayerBitrate: function(/* bitrate, resolution */) {},
        SetCheckSource: function(/* check */) {},

        // ============ HTTP ============
        XmlHttpGetFull: function(urlString, timeout, postMessage, Method, JsonHeadersArray, callback, checkResult, check_1, check_2, check_3, check_4, check_5, callBackSuccess, callBackError) {
            var headers = _parseHeaders(JsonHeadersArray);
            Platform.http.request({
                url: urlString,
                method: (Method || 'GET').toUpperCase(),
                headers: headers,
                body: postMessage || undefined,
                timeoutMs: timeout || 8000
            }).then(function(res) {
                var bodyStr = typeof res.body === 'string' ? res.body : JSON.stringify(res.body);
                var resultStr = _buildResult(res.status, urlString, bodyStr, checkResult);
                _invokeCallback(callback, [resultStr, checkResult, check_1, check_2, check_3, check_4, check_5, callBackSuccess]);
            }).catch(function(err) {
                var status = err && err.status ? err.status : 0;
                // Upstream callbacks JSON.parse(responseText) and read fields
                // like .message ("authorization_pending" during device-grant
                // polling). The actual body lives on err.raw — err.detail is
                // just statusText ("Bad Request") which breaks parsing. Pass
                // raw through, stringifying if Platform.http already parsed it
                // as JSON.
                var raw = err && err.raw;
                var bodyStr = typeof raw === 'string' ? raw : (raw != null ? JSON.stringify(raw) : (err && err.detail ? err.detail : ''));
                var resultStr = _buildResult(status, urlString, bodyStr, checkResult);
                _invokeCallback(callBackError || callback, [resultStr, checkResult, check_1, check_2, check_3, check_4, check_5, callBackSuccess]);
            });
        },
        BasexmlHttpGet: function(urlString, timeout, postMessage, Method, JsonHeadersArray, callback, checkResult, key, callBackSuccess, callBackError) {
            // Java's BasexmlHttpGet callback invocation:
            //   callback(result, key, callBackSuccess, callBackError, checkResult)
            // Both Main_CheckBasexmlHttpGet and Main_CheckFullxmlHttpGet
            // (which is actually called by BasexmlHttpGet despite the name)
            // have signature (result, key, callbackSuccess, calbackError, checkResult).
            var headers = _parseHeaders(JsonHeadersArray);
            Platform.http.request({
                url: urlString,
                method: (Method || 'GET').toUpperCase(),
                headers: headers,
                body: postMessage || undefined,
                timeoutMs: timeout || 8000
            }).then(function(res) {
                var bodyStr = typeof res.body === 'string' ? res.body : JSON.stringify(res.body);
                var resultStr = _buildResult(res.status, urlString, bodyStr, checkResult);
                _invokeCallback(callback, [resultStr, key, callBackSuccess, callBackError, checkResult]);
            }).catch(function(err) {
                var status = err && err.status ? err.status : 0;
                var raw = err && err.raw;
                var bodyStr = typeof raw === 'string' ? raw : (raw != null ? JSON.stringify(raw) : (err && err.detail ? err.detail : ''));
                var resultStr = _buildResult(status, urlString, bodyStr, checkResult);
                _invokeCallback(callback, [resultStr, key, callBackSuccess, callBackError, checkResult]);
            });
        },
        mMethodUrlHeaders: function(urlString, timeout, postMessage, Method/* , checkResult */) {
            // Sync return — Platform.http is async. Fire and forget; return
            // empty headers JSON so callers that JSON.parse don't crash.
            try {
                Platform.http.request({
                    url: urlString,
                    method: (Method || 'HEAD').toUpperCase(),
                    body: postMessage || undefined,
                    timeoutMs: timeout || 5000
                }).then(function() {}).catch(function() {});
            } catch (e) {}
            return '{}';
        },

        // ============ Logging / debug ============
        LongLog: function(msg) { Platform.log.info(msg); },

        // ============ App lifecycle ============
        mclose: function(close) {
            Platform.lifecycle.exit({background: !close});
        },
        mloadUrl: function(url) {
            Platform.lifecycle.loadUrl(url);
        },
        GetLastIntentObj: function() {
            try {
                var p = Platform.lifecycle.getLaunchParams();
                return p == null ? '{}' : (typeof p === 'string' ? p : JSON.stringify(p));
            } catch (e) {
                return '{}';
            }
        },
        SetLanguage: function(lang) { Platform.lifecycle.setLanguage(lang); },
        upDateLang:  function(lang) { Platform.lifecycle.setLanguage(lang); },

        // ============ Loading UI ============
        mshowLoading: function(/* show */) {},
        mshowLoadingBottom: function(/* show */) {},

        // ============ Preview audio (small player volume ducking) ============
        SetPreviewAudio:        function(/* volume */) {},
        SetPreviewOthersAudio:  function(/* volume */) {},
        SetPreviewSize:         function(/* size */) {},

        // ============ Notifications (Android-only; safe to ignore) ============
        // ============ Notifications ============
        // Upstream's Android build runs an *out-of-process JobService* for
        // background follow-list polling — when a followed channel goes live
        // the service posts a system notification even with the app closed.
        // There is no equivalent in a webOS web app: the runtime tears down
        // our JS context the moment the app is backgrounded (no Service
        // Worker support either, since webOS doesn't ship one). So the
        // Set*/upState/Start/Stop pairs stay as state-only no-ops — keeping
        // the upstream Settings UI functional without lying about what we
        // can deliver. If/when we wrap a real Luna background service
        // (com.webos.service.notification) for the "always alive" privileged
        // app slot, these become real calls.
        SetNotificationLive:       function(notify) { _notifState.live  = !!notify; },
        SetNotificationTitle:      function(notify) { _notifState.title = !!notify; },
        SetNotificationGame:       function(notify) { _notifState.game  = !!notify; },
        SetNotificationPosition:   function(pos)    { _notifState.position = pos; },
        SetNotificationRepeat:     function(times)  { _notifState.repeat = times; },
        SetNotificationSinceTime:  function(ms)     { _notifState.sinceMs = ms; },
        upNotificationState:       function(en)     { _notifState.enabled = !!en; },
        // hasNotificationPermission: upstream gates the foreground toast
        // and Settings UI on this. Web has the Notification API, but for a
        // TV app the user-visible "notification" IS the in-app toast we own
        // — that needs no permission. Returning true keeps the upstream UX
        // available; the Settings panel can be toggled and showToast works.
        hasNotificationPermission: function() { return true; },
        RunNotificationService:    function() { _notifState.serviceRequested = true; },
        StopNotificationService:   function() { _notifState.serviceRequested = false; },
        showToast:                 function(message) { _showToast(message); },
        Settings_SetPingWarning:   function(/* warning */) {},

        // ============ Input ============
        keyEvent:            function(/* key, action */) {},
        KeyboardCheckAndHIde:function() {},
        hideKeyboardFrom:    function() {},
        AvoidClicks:         function(/* avoid */) {},
        SetKeysOpacity:      function(/* opacity */) {},
        SetKeysPosition:     function(/* position */) {},

        // ============ External / misc ============
        OpenExternal: function(url) {
            try { window.open(url, '_blank'); } catch (e) {}
        },
        isAccessibilitySettingsOn: function() { return false; },

        // ============ Intentional no-ops (no web equivalent) ============
        // These all came from upstream's native-Android-only APIs. Mapped
        // explicitly to stop the boot-time "unmapped" warnings — the no-op
        // is the correct mapping, not a placeholder.
        //
        // setSpeedAdjustment: maps upstream's media3 speed-up flag onto
        // hls.js maxLiveSyncPlaybackRate (live-edge chasing).
        // SetMainPlayerBitrate / mSetlatency: hls.js ABR handles this in JS;
        //   we'd need hls.config tuning to honour these, deferred.
        // UpdateBlockedChannels / UpdateBlockedGames: the JS-side filter
        //   already runs against Settings; these calls only mattered for
        //   native-side persistence (e.g. notification-service filtering).
        // mSetPlayerSize: multi-stream small-player sizing — Platform.preview
        //   doesn't exist yet.
        // mCheckRefreshToast: token-refresh result toast — no native
        //   refresh service to drive it.
        // setAppToken: notification-service auth token.
        setSpeedAdjustment:    function(enabled) {
            if (Platform.player.setSpeedAdjustment) Platform.player.setSpeedAdjustment(enabled);
        },
        SetMainPlayerBitrate:  function(bitrate, resolution) {
            if (Platform.player.setMaxBitrate) Platform.player.setMaxBitrate(bitrate || 0, resolution || 0);
        },
        mSetlatency: function(value) {
            if (Platform.player.setLatencyMode) Platform.player.setLatencyMode(value);
        },
        UpdateBlockedChannels: function(/* json */) {},
        UpdateBlockedGames:    function(/* json */) {},
        mSetPlayerSize:        function(/* size */) {},
        mCheckRefreshToast:    function(/* type */) {},
        setAppToken:           function(/* token */) {},

        // ============ Update flow ============
        // A side-loaded webOS app can't self-install an IPK (docs/adrs/0003
        // territory: unprivileged). The update dialog's confirm therefore
        // becomes guidance instead of an install.
        getInstallFromPLay:    function() { return false; },
        UpdateAPK:             function(/* url, failStr, failDlStr */) {
            // Upstream showed the load dialog and persisted IsUpDating=true
            // right before calling — undo both or the app is stuck on the
            // loading screen.
            if (typeof window.Main_HideLoadDialog === 'function') window.Main_HideLoadDialog();
            if (window.Main_values && window.Main_values.IsUpDating) {
                window.Main_values.IsUpDating = false;
                if (typeof window.Main_SaveValues === 'function') window.Main_SaveValues();
            }
            _showToast('Self-install isn’t supported on webOS — update via github.com/tcarcao/smarttwitchtv-webos/releases');
        },
        // Test seam (app/tests/player-hls.html asserts the comparator).
        _isNewerVersion:       function(remote, local) { return _isNewerVersion(remote, local); }
    };

    // Default-fallback: log unmapped property accesses but DON'T throw.
    // Throwing in unmapped functions broke boot (e.g. on setAppIds before
    // we added it). Logging surfaces gaps; returning undefined keeps the
    // app booting. Add a real mapping above when an unmapped call matters.
    var _warnedAbout = {};
    window['Android'] = new Proxy(mapping, {
        get: function(target, prop) {
            if (prop in target) return target[prop];
            // Symbol checks (Proxy can be probed) — return undefined silently
            if (typeof prop === 'symbol') return undefined;
            // Don't spam console for the same prop twice
            if (!_warnedAbout[prop]) {
                _warnedAbout[prop] = true;
                console.warn('[PlatformShim] Android.' + String(prop) + ' is unmapped (no-op) — see sync/upstream-mapping.md');
            }
            return function() { /* no-op */ };
        }
    });

    // ============ Refresh-token capture (post-load monkey patch) ============
    //
    // Upstream's AddUser_SaveNewUser hard-codes refresh_token: 0 and relies on
    // Android.mCheckRefresh (a native service) to populate/use the refresh
    // token later. On web/webOS that service doesn't exist, so without this
    // patch every fresh login persists with no refresh_token — meaning when
    // the access_token expires (~60 days) the user has to re-authorize from
    // scratch instead of silently refreshing.
    //
    // We intercept AddUser_getDeviceCodeSuccess to stash the refresh_token
    // from Twitch's device-grant response, then patch AddUser_SaveNewUser to
    // inject it (and the matching expires_in/expires_when) into the saved
    // userObj. Touching upstream files is off-limits per the architecture
    // contract, so we monkey-patch after DOMContentLoaded — by then every
    // defer'd <script> has run and the AddUser_* functions exist.
    function _installRefreshTokenCapture() {
        if (typeof window.AddUser_getDeviceCodeSuccess !== 'function' ||
            typeof window.AddUser_SaveNewUser !== 'function') {
            return false;
        }
        var origGetSuccess = window.AddUser_getDeviceCodeSuccess;
        var origSaveNew    = window.AddUser_SaveNewUser;
        var pending = null;

        window.AddUser_getDeviceCodeSuccess = _setName(function(resultObj) {
            if (resultObj && resultObj.status === 200 && resultObj.responseText) {
                try {
                    var data = JSON.parse(resultObj.responseText);
                    if (data && data.refresh_token) {
                        pending = {
                            refresh_token: data.refresh_token,
                            expires_in: typeof data.expires_in === 'number' ? data.expires_in : 0
                        };
                    }
                } catch (e) {}
            }
            return origGetSuccess.apply(this, arguments);
        }, 'AddUser_getDeviceCodeSuccess');

        window.AddUser_SaveNewUser = _setName(function() {
            var ret = origSaveNew.apply(this, arguments);
            if (pending && Array.isArray(window.AddUser_UsernameArray)) {
                // Newly-saved user is the last entry pushed. AddUser_SaveNewUser
                // also sets Users_Userlastadded to its id — use that to find
                // the exact record rather than indexing [0] (which is fragile
                // when multiple users are logged in).
                var idx = -1;
                if (typeof window.Users_Userlastadded !== 'undefined' && window.Users_Userlastadded) {
                    for (var i = 0; i < window.AddUser_UsernameArray.length; i++) {
                        if (window.AddUser_UsernameArray[i] && window.AddUser_UsernameArray[i].id === window.Users_Userlastadded) {
                            idx = i; break;
                        }
                    }
                }
                if (idx === -1 && window.AddUser_UsernameArray.length) idx = window.AddUser_UsernameArray.length - 1;
                if (idx !== -1) {
                    var u = window.AddUser_UsernameArray[idx];
                    u.refresh_token = pending.refresh_token;
                    u.expires_in = pending.expires_in;
                    u.expires_when = Date.now() + pending.expires_in * 1000;
                    try { if (typeof window.AddUser_SaveUserArray === 'function') window.AddUser_SaveUserArray(); } catch (e) {}
                    // Newly-added user has a fresh refresh_token; arm the
                    // refresh scheduler for it so we don't wait for the
                    // next app boot to start tracking expiry.
                    try { _scheduleRefreshFor(u); } catch (e) {}
                }
                pending = null;
            }
            return ret;
        }, 'AddUser_SaveNewUser');
        return true;
    }

    // ============ Token refresh scheduler ============
    //
    // Upstream relies on Android's Twitch refresh-token JobService to keep
    // access_tokens valid in the background. Web/webOS has no equivalent
    // out-of-process runtime, so we re-implement the same contract in JS:
    // when a user's access_token is within REFRESH_LEAD_MS of expiring,
    // POST grant_type=refresh_token to id.twitch.tv/oauth2/token and
    // replace the in-memory + persisted record. Twitch ROTATES the
    // refresh_token on every refresh, so we always overwrite both.
    //
    // On app boot we inspect every stored user; expires_when already in
    // the past (or within LEAD) → refresh now; otherwise arm a setTimeout
    // for (expires_when - LEAD - now). Each successful refresh re-arms
    // the chain. If the runtime sleeps past the timer (TV powered off,
    // setTimeout doesn't fire), the next boot's catch-up refresh handles
    // it before any user-visible call uses a dead token.
    //
    // invalid_grant from Twitch means the refresh_token itself has been
    // revoked — clear the user's tokens so the upstream Auth UI surfaces
    // the re-login prompt rather than firing endless silent retries.
    var REFRESH_LEAD_MS = 5 * 60 * 1000;
    var REFRESH_RETRY_MS = 60 * 1000;
    // setTimeout takes a 32-bit signed int (~24.8 days); cap below that.
    var REFRESH_MAX_DELAY = 2147483000;
    var _refreshTimers = {};

    function _scheduleRefreshFor(user) {
        if (!user || !user.refresh_token || !user.id) return;
        if (_refreshTimers[user.id]) {
            clearTimeout(_refreshTimers[user.id]);
            _refreshTimers[user.id] = null;
        }
        var msUntil = (user.expires_when || 0) - Date.now() - REFRESH_LEAD_MS;
        if (msUntil <= 0) {
            _doRefresh(user);
        } else {
            var ms = Math.min(msUntil, REFRESH_MAX_DELAY);
            _refreshTimers[user.id] = setTimeout(function() { _doRefresh(user); }, ms);
        }
    }

    function _doRefresh(user) {
        var clientId = (typeof window.AddCode_backup_client_id === 'string') ? window.AddCode_backup_client_id : '';
        var tokenBase = (typeof window.AddCode_UrlToken === 'string') ? window.AddCode_UrlToken : 'https://id.twitch.tv/oauth2/token?';
        var url = tokenBase +
                  'grant_type=refresh_token' +
                  '&refresh_token=' + encodeURIComponent(user.refresh_token) +
                  '&client_id=' + clientId;

        Platform.http.request({
            url: url,
            method: 'POST',
            timeoutMs: 10000
        }).then(function(res) {
            var body = (typeof res.body === 'string') ? (function() { try { return JSON.parse(res.body); } catch (e) { return null; } })() : res.body;
            if (!body || !body.access_token) {
                console.warn('[TokenRefresh] response missing access_token; retrying');
                _refreshTimers[user.id] = setTimeout(function() { _doRefresh(user); }, REFRESH_RETRY_MS);
                return;
            }
            user.access_token = body.access_token;
            if (body.refresh_token) user.refresh_token = body.refresh_token;
            user.expires_in = body.expires_in || 0;
            user.expires_when = Date.now() + (body.expires_in || 0) * 1000;
            // Upstream caches Bearer headers on login; rebuild them now so
            // the next API call uses the new token.
            try { if (typeof window.HttpGetSetUserHeader === 'function') window.HttpGetSetUserHeader(); } catch (e) {}
            try { if (typeof window.AddUser_SaveUserArray === 'function') window.AddUser_SaveUserArray(); } catch (e) {}
            var nextMin = Math.max(1, Math.round(((body.expires_in || 0) - 300) / 60));
            console.log('[TokenRefresh]', user.name || user.id, 'refreshed; next in ~' + nextMin + ' min');
            _scheduleRefreshFor(user);
        }).catch(function(err) {
            if (err && err.status === 400) {
                // invalid_grant — refresh_token revoked. Clear so upstream
                // forces a re-login on next attempt.
                console.warn('[TokenRefresh] invalid_grant for', user.name || user.id, '; clearing tokens');
                user.access_token = null;
                user.refresh_token = null;
                user.expires_when = 0;
                try { if (typeof window.HttpGetSetUserHeader === 'function') window.HttpGetSetUserHeader(); } catch (e) {}
                try { if (typeof window.AddUser_SaveUserArray === 'function') window.AddUser_SaveUserArray(); } catch (e) {}
                return;
            }
            console.warn('[TokenRefresh] transient failure, retrying in', REFRESH_RETRY_MS / 1000, 's:', err && err.detail);
            _refreshTimers[user.id] = setTimeout(function() { _doRefresh(user); }, REFRESH_RETRY_MS);
        });
    }

    function _installTokenRefreshScheduler() {
        if (!Array.isArray(window.AddUser_UsernameArray)) return false;
        window.AddUser_UsernameArray.forEach(function(u) {
            if (u && u.refresh_token && u.expires_when) _scheduleRefreshFor(u);
        });
        return true;
    }

    // ============ Foreground "channel went live" notifier ============
    //
    // Upstream's Android JobService polled the user's follow list in the
    // background and fired OS-level notifications. Web/webOS has no
    // equivalent runtime, so we settle for in-app: every NOTIF_POLL_MS
    // we hit /helix/streams/followed and diff against the previous tick.
    // Channels that just came online get a showToast. Channels going
    // offline are silent (matching Android UX — no "X went offline" toast).
    //
    // The first poll after boot is a PRIMING pass: it populates the
    // known-live set without firing toasts, otherwise restarting the app
    // would spam every currently-live followed channel as "new". Real
    // background delivery (channels going live while the app is closed)
    // would need a Luna service wrapper — out of scope here.
    //
    // Settings.live_notification gates the whole thing; if upstream's
    // SetNotificationLive(false) flips _notifState.live, the poll bails.

    var NOTIF_POLL_MS = 5 * 60 * 1000;
    var NOTIF_INITIAL_DELAY_MS = 30 * 1000;
    var _notifPollTimer = null;
    var _notifKnownLive = null; // null = not primed yet; Set<user_id> after

    function _notifPollOnce() {
        if (!_notifState.live) return;
        if (!Array.isArray(window.AddUser_UsernameArray)) return;
        var user = window.AddUser_UsernameArray[0];
        if (!user || !user.access_token || !user.id) return;
        var clientId = (typeof window.AddCode_backup_client_id === 'string') ? window.AddCode_backup_client_id : '';
        if (!clientId) return;

        var url = 'https://api.twitch.tv/helix/streams/followed?user_id=' + encodeURIComponent(user.id) + '&first=100';
        Platform.http.request({
            url: url,
            method: 'GET',
            headers: [
                ['Client-ID', clientId],
                ['Authorization', 'Bearer ' + user.access_token]
            ],
            timeoutMs: 10000
        }).then(function(res) {
            var body = (typeof res.body === 'string')
                ? (function() { try { return JSON.parse(res.body); } catch (e) { return null; } })()
                : res.body;
            if (!body || !Array.isArray(body.data)) return;

            var nowLive = {};
            body.data.forEach(function(s) { if (s && s.user_id) nowLive[s.user_id] = s; });

            if (_notifKnownLive === null) {
                _notifKnownLive = nowLive;
                return;
            }

            // Toast each newly-live channel (in nowLive but not in previous)
            Object.keys(nowLive).forEach(function(uid) {
                if (!_notifKnownLive[uid]) {
                    var s = nowLive[uid];
                    var who = s.user_name || s.user_login || 'A followed channel';
                    var what = s.title ? ' — ' + String(s.title).slice(0, 80) : '';
                    _showToast(who + ' is live' + what);
                }
            });
            _notifKnownLive = nowLive;
        }).catch(function(err) {
            // 401 = token died (refresh hasn't kicked in yet); poll again
            // next cycle. 5xx = Twitch flap; same. No retry — quiet failure
            // is the right UX for an opportunistic notifier.
            console.warn('[Notif] poll failed:', err && (err.detail || err.kind));
        });
    }

    function _installLiveNotifier() {
        if (_notifPollTimer) clearInterval(_notifPollTimer);
        _notifPollTimer = setInterval(_notifPollOnce, NOTIF_POLL_MS);
        // Prime shortly after boot; gives upstream time to restore the
        // user record from localStorage and set up bearer headers.
        setTimeout(_notifPollOnce, NOTIF_INITIAL_DELAY_MS);
    }

    // CRITICAL: upstream's Main_CheckFullxmlHttpGet looks up callbacks via
    // `eval(callbackSuccess.name)`. If `.name` is empty, eval('') returns
    // undefined and the calling chain dies silently. Named function
    // expressions LOOK like they preserve `.name`, but vite's minifier
    // rewrites identifier names in bundled builds — `.name` ends up as 's'
    // or similar. The only reliable fix is to set `.name` explicitly via
    // defineProperty, which the minifier doesn't touch (string literal).
    // Used by every monkey-patch that replaces an upstream global function.
    function _setName(fn, name) {
        try { Object.defineProperty(fn, 'name', {value: name, configurable: true}); } catch (e) {}
        return fn;
    }

    // ============ Update check (GitHub Releases) ============
    //
    // Upstream's Main_CheckUpdate only fetches when the app runs from
    // https://fgl27.github.io (the Android model: the hosted page IS the
    // app). Our port is fully packaged, so we replace the function body —
    // keeping upstream's scheduling, dialog, and changelog rendering — with
    // a check against our release pipeline's version.json. The stable
    // `latest/download` URL always points at the newest GitHub Release.
    var UPDATE_VERSION_URL = 'https://github.com/tcarcao/smarttwitchtv-webos/releases/latest/download/version.json';

    function _isNewerVersion(remote, local) {
        if (!remote || !local) return false;
        var r = String(remote).split('.');
        var l = String(local).split('.');
        var len = Math.max(r.length, l.length);
        for (var i = 0; i < len; i++) {
            var a = parseInt(r[i], 10) || 0;
            var b = parseInt(l[i], 10) || 0;
            if (a !== b) return a > b;
        }
        return false;
    }

    function _updateCheckSettle() {
        window.Main_Ischecking = false;
        if (typeof window.Main_getclock === 'function') {
            window.Main_UpdateDialogLastCheck = window.Main_getclock();
        }
        if (typeof window.Main_UpdateDialogTitle === 'function') window.Main_UpdateDialogTitle();
        if (typeof window.Main_UpdateDialogSetTitle === 'function') window.Main_UpdateDialogSetTitle();
    }

    function _installUpdateCheck() {
        if (typeof window.Main_CheckUpdate !== 'function' ||
            typeof window.Main_WarnUpdate !== 'function' ||
            !window.version) {
            return;
        }
        window.Main_CheckUpdate = _setName(function(forceUpdate) {
            if (!window.checkUpdates) return;
            // Mirror upstream's background-update suppression.
            if (window.Main_HasUpdate && !forceUpdate &&
                typeof window.Main_isUpdateDialogVisible === 'function' && window.Main_isUpdateDialogVisible() &&
                window.Settings_value && window.Settings_value.update_background &&
                window.Settings_value.update_background.defaultValue) {
                return;
            }
            Platform.device.packageVersion().then(function(current) {
                if (!current) {
                    _updateCheckSettle();
                    return null;
                }
                return Platform.http.request({url: UPDATE_VERSION_URL, timeoutMs: 8000}).then(function(res) {
                    var body = typeof res.body === 'string' ? JSON.parse(res.body) : res.body;
                    if (body && body.version && _isNewerVersion(body.version, current)) {
                        window.version.ApkUrl = body.ipkUrl || '';
                        window.version.changelog = body.changelog && body.changelog.length
                            ? body.changelog
                            : [{title: 'Version ' + body.version, changes: []}];
                        window.Main_HasUpdate = true;
                        window.Main_IsWebupdate = false;
                        window.Main_WarnUpdate(false);
                        _updateCheckSettle();
                    } else {
                        _updateCheckSettle();
                        if (typeof window.Main_isUpdateDialogVisible === 'function' && window.Main_isUpdateDialogVisible()) {
                            _showToast(typeof window.STR_NO_UPDATES !== 'undefined' ? window.STR_NO_UPDATES : 'No updates');
                        }
                    }
                });
            }).catch(function() {
                _updateCheckSettle();
                if (typeof window.Main_CheckUpdateFail === 'function') window.Main_CheckUpdateFail();
            });
        }, 'Main_CheckUpdate');
    }

    // ============ Changelog/about dialog scrolling ============
    //
    // Upstream's #dialog_about box (.about_dialogs) has no height cap and
    // the overlay is overflow:hidden, while the active key handler ignores
    // UP/DOWN — a changelog taller than the screen is simply unreachable
    // (verified in Chrome and on the TV). Cap + scroll it from the shim.
    function _installChangelogScroll() {
        if (typeof window.Main_UpdateDialogKeyFun !== 'function') return;

        var style = document.createElement('style');
        style.textContent =
            '#dialog_about .about_dialogs{max-height:92%;overflow-y:auto;}' +
            '#dialog_about .about_dialogs::-webkit-scrollbar{width:0.4vh;}' +
            '#dialog_about .about_dialogs::-webkit-scrollbar-thumb{background:#666;border-radius:0.2vh;}';
        document.head.appendChild(style);

        // Main_showUpdateDialog resolves the global by name at show time, so
        // wrapping here covers every later registration (and the matching
        // removeEventListener on hide sees the same patched reference).
        var orig = window.Main_UpdateDialogKeyFun;
        window.Main_UpdateDialogKeyFun = _setName(function(event) {
            var up = typeof window.KEY_UP !== 'undefined' ? window.KEY_UP : 38;
            var down = typeof window.KEY_DOWN !== 'undefined' ? window.KEY_DOWN : 40;
            if ((event.keyCode === up || event.keyCode === down) &&
                typeof window.Main_isAboutDialogVisible === 'function' &&
                window.Main_isAboutDialogVisible()) {
                var box = document.querySelector('#dialog_about .about_dialogs');
                if (box) {
                    box.scrollTop += (event.keyCode === down ? 1 : -1) * Math.round(box.clientHeight * 0.4);
                }
            }
            return orig(event);
        }, 'Main_UpdateDialogKeyFun');
    }

    function _bootShimPatches() {
        _installRefreshTokenCapture();
        _installTokenRefreshScheduler();
        _installLiveNotifier();
        _installUpdateCheck();
        _installChangelogScroll();
    }

    // Debug hook (test-only): expose helpers on a single window namespace
    // so Chrome MCP can drive flows without authenticating. Production code
    // never reads __PlatformShimDebug — it just exists.
    window.__PlatformShimDebug = {
        scheduleRefresh: _scheduleRefreshFor,
        doRefresh: _doRefresh,
        refreshTimers: _refreshTimers,
        notifPollOnce: _notifPollOnce,
        notifKnownLive: function() { return _notifKnownLive; },
        notifState: _notifState
    };

    // PlatformShim.js itself is a defer'd script, so it runs *before* later
    // defer'd scripts like AddUser.js. document.readyState at this point is
    // 'interactive' — sounds done, but later defer scripts haven't executed
    // yet. DOMContentLoaded is the only signal that ALL defer scripts have
    // run. If we already missed that event (e.g. shim re-evaluated late),
    // _bootShimPatches handles the case where the functions exist.
    if (document.readyState === 'complete') {
        _bootShimPatches();
    } else {
        document.addEventListener('DOMContentLoaded', _bootShimPatches);
    }
})();
