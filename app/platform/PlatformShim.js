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
    // rect from upstream's pixel-coord args (bottom, right, left, web_height).
    // We position the single <video> element via inline style — Platform.player
    // is told the rect; the desktop adapter applies it.
    function _rectFromBRLH(bottom, right, left, web_height) {
        return {
            bottom: bottom,
            right: right,
            left: left,
            height: web_height
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
            Platform.player.setPlaybackSpeed(speed);
        },

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
                rect: _rectFromBRLH(bottom, right, left, web_height)
            });
        },
        ScreenPlayerRestore: function(bottom, right, left, web_height, /* who_called, isBigger */) {
            Platform.player.setRect && Platform.player.setRect(_rectFromBRLH(bottom, right, left, web_height));
        },
        SetPlayerViewFeedBottom: function(bottom, web_height) {
            Platform.player.setRect && Platform.player.setRect({bottom: bottom, height: web_height});
        },
        SetPlayerViewSidePanel: function(bottom, right, left, web_height) {
            Platform.player.setRect && Platform.player.setRect(_rectFromBRLH(bottom, right, left, web_height));
        },
        SetFeedPosition: function(/* position */) {},   // layout-only; resize handled separately
        FixViewPosition: function(/* orientation, who_called */) {}, // no-op; DOM <video> reflows naturally
        mupdatesize: function(isFullScreen) {
            Platform.player.setRect && Platform.player.setRect({fullscreen: !!isFullScreen});
        },
        mupdatesizePP: function(isFullScreen) {
            Platform.player.setRect && Platform.player.setRect({fullscreen: !!isFullScreen});
        },
        mSetPlayerPosition: function(/* picturePos */) {},
        mSwitchPlayer: function() {},
        mSwitchPlayerPosition: function(/* picturePos */) {},
        mSwitchPlayerSize: function(/* size */) {},
        SetFullScreenPosition: function(/* pos */) {},
        SetFullScreenSize: function(/* size */) {},
        msetPlayer: function(/* surface, FullScreen */) {},
        StartFeedPlayer: function(uri, mainPlaylistString, /* position */ _position, resumePosition, isVod) {
            // Used for hover-preview-on-feed. Without a real multi-player,
            // we route into the main player (same approach as the BACK→list
            // continued-playback flow). _position ignored.
            void _position;
            if (uri) {
                Platform.player.start({
                    uri: uri,
                    manifestString: mainPlaylistString,
                    kind: isVod ? 'vod' : 'live',
                    resumePosition: resumePosition > 0 ? resumePosition : undefined
                });
            }
        },
        StartSidePanelPlayer: function(uri, mainPlaylistString) {
            if (uri) Platform.player.start({uri: uri, manifestString: mainPlaylistString, kind: 'live'});
        },
        SidePanelPlayerRestore: function() {},
        ClearFeedPlayer:     function() { Platform.player.stop(); },
        ClearSidePanelPlayer:function() { Platform.player.stop(); },
        mClearSmallPlayer:   function() { Platform.player.stop(); },

        // ============ Multi-stream (no-op — capability gated off) ============
        EnableMultiStream:  function(/* mainBig, offset */) {},
        DisableMultiStream: function() {},
        StartMultiStream:   function(/* position, uri, playlist, restart */) {},

        // ============ Codec / bandwidth ============
        setBlackListQualities: function(/* list */) {},
        setBlackListMediaCodec: function(/* list */) {},
        getcodecCapabilities: function(/* codec */) { return JSON.stringify([]); },
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
                var detail = err && err.detail ? err.detail : '';
                var resultStr = _buildResult(status, urlString, detail, checkResult);
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
                var detail = err && err.detail ? err.detail : '';
                var resultStr = _buildResult(status, urlString, detail, checkResult);
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
        SetNotificationLive:       function(/* notify */) {},
        SetNotificationTitle:      function(/* notify */) {},
        SetNotificationGame:       function(/* notify */) {},
        SetNotificationPosition:   function(/* position */) {},
        SetNotificationRepeat:     function(/* repeat */) {},
        SetNotificationSinceTime:  function(/* timeMs */) {},
        upNotificationState:       function(/* enabled */) {},
        StopNotificationService:   function() {},
        hasNotificationPermission: function() { return false; },
        RunNotificationService:    function() {},
        showToast:                 function(/* message */) {},
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
        isAccessibilitySettingsOn: function() { return false; }
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
})();
