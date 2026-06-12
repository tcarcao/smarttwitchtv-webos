/**
 * PlatformDesktop — Browser/Chrome adapter for the Platform interface.
 *
 * Loaded after Platform.js (which defines throwing stubs). This file
 * REPLACES individual methods on window['Platform'] with real
 * implementations backed by browser APIs (localStorage, console,
 * keyboard) and hls.js for video playback.
 *
 * NOT loaded on webOS — when v1.2 introduces PlatformWebOS.js,
 * this file's IIFE will detect window.webOS and no-op. For v1.1
 * it runs unconditionally because no webOS adapter exists yet.
 *
 * Capability deltas vs Platform.js defaults:
 *   - hardwareHLS stays false (we use hls.js, not native MSE policy)
 *   - surfaceBehindWebView stays false (player is a DOM <video>)
 *   - notifications stays null (browser desktop has no TV notifications)
 *   - multiPlayer stays null (deferred to capabilities/v4 anyway)
 */
(function() {
    'use strict';

    // Platform detection: no-op on webOS — PlatformWebOS owns those overrides.
    // Match the same set of markers PlatformWebOS activates on (webOS,
    // webOSSystem, PalmSystem) so the Simulator routes to PlatformWebOS
    // even when only webOSSystem is present. Loading both adapters would
    // race on Platform.X assignments and could leave an orphan <video>.
    if (window['webOS'] || window['webOSSystem'] || window['PalmSystem']) return;

    if (!window['Platform']) {
        throw new Error('PlatformDesktop: Platform.js must load first');
    }

    var Platform = window['Platform'];

    // Multi-video is fine in a real browser: HTML5 supports many concurrent
    // <video> elements, and modern Chromium decodes them in software when
    // the hardware decoder is busy. This flag drives the shim's
    // getcodecCapabilities — when true we report enough AVC instances to
    // unlock UserLiveFeed_MaxInstances and the in-fullscreen feed-row
    // preview overlay (Platform.preview). PlatformWebOS leaves it false
    // because the LG TV WebView has a single-instance hardware decoder
    // that auto-pauses the main when a second <video> starts.
    Platform.capabilities.multiPlayer = true;

    // -- device --
    Platform.device.name = function() {
        return navigator.userAgent || 'Desktop';
    };
    Platform.device.manufacturer = function() {
        return 'Desktop';
    };
    Platform.device.systemVersion = function() {
        // Best-effort browser/OS string; falls back to userAgent.
        return navigator.platform || navigator.userAgent || 'unknown';
    };
    Platform.device.isTV = function() {
        return false;
    };
    Platform.device.appVersion = function() {
        // High version on all three components — upstream's Main_needUpdate
        // checks parseFloat(major.minor) < VersionBase OR parseInt(patch) <
        // publishVersionCode (currently 379). 999.99.99999 satisfies both.
        // Our actual fork version is tracked in package.json + git.
        return '999.99.99999';
    };
    Platform.device.packageVersion = function() {
        // Dev build has no packaged appinfo.json; report the same high dev
        // version as appVersion() so the GitHub update check stays quiet.
        return Promise.resolve('999.99.99999');
    };

    // -- log --
    Platform.log.info = function(msg) {
        // ES5-style: forward all args via apply.
        var args = ['[info]', msg];
        for (var i = 1; i < arguments.length; i++) args.push(arguments[i]);
        console.log.apply(console, args);
    };
    Platform.log.warn = function(msg) {
        var args = ['[warn]', msg];
        for (var i = 1; i < arguments.length; i++) args.push(arguments[i]);
        console.warn.apply(console, args);
    };
    Platform.log.error = function(msg) {
        // ES5-style varargs: same shape as log.info / log.warn.
        var args = ['[error]', msg];
        for (var i = 1; i < arguments.length; i++) args.push(arguments[i]);
        console.error.apply(console, args);
    };

    // -- storage --
    Platform.storage.get = function(key) {
        var v = window.localStorage.getItem(key);
        if (v === null) return null;
        // Round-trip JSON for objects; fall back to raw string.
        try {
            return JSON.parse(v);
        } catch (e) {
            return v;
        }
    };
    Platform.storage.set = function(key, value) {
        var encoded = typeof value === 'string' ? value : JSON.stringify(value);
        window.localStorage.setItem(key, encoded);
    };
    Platform.storage.remove = function(key) {
        window.localStorage.removeItem(key);
    };

    // -- http --
    // Promise-based fetch wrapper with abort-based timeout and an optional
    // validate predicate. Rejects with a typed error object:
    //   {kind: 'http_status'|'http_timeout'|'network'|'validation', detail, raw}
    // Headers are passed as [[key,val], ...] arrays (mirrors upstream's shape).
    // The gql.twitch.tv endpoint rejects upstream's AddCode_clientId
    // (the user's registered OAuth app — valid for Helix only). The shim
    // swaps the Client-ID to AddCode_backup_client_id (the public-web ID
    // that GQL accepts) so we don't have to touch upstream's PlayEtc.js
    // Main_base_array_header. Other endpoints (Helix, oauth2, etc) keep
    // whatever Client-ID upstream set.
    function _patchGqlClientId(headers) {
        if (!headers || !headers.length) return headers;
        var ADDCODE = (typeof window !== 'undefined' && typeof window.AddCode_clientId === 'string')
            ? window.AddCode_clientId : null;
        var BACKUP = (typeof window !== 'undefined' && typeof window.AddCode_backup_client_id === 'string')
            ? window.AddCode_backup_client_id : null;
        if (!BACKUP || !ADDCODE) return headers;
        var out = [];
        for (var i = 0; i < headers.length; i++) {
            var k = headers[i][0];
            var v = headers[i][1];
            if (k && k.toLowerCase() === 'client-id' && v === ADDCODE) {
                out.push([k, BACKUP]);
            } else {
                out.push(headers[i]);
            }
        }
        return out;
    }
    Platform.http.request = function(args) {
        var url = args && args.url;
        if (!url) {
            return Promise.reject({kind: 'invalid_args', detail: 'url required'});
        }
        // Per-endpoint Client-ID quirks: gql.twitch.tv rejects upstream's
        // AddCode_clientId (registered-OAuth-app ID — only valid for Helix).
        // Swap to backup before encoding.
        if (/^https:\/\/gql\.twitch\.tv\//.test(url)) {
            args = Object.assign({}, args, {headers: _patchGqlClientId(args.headers)});
        }
        // Browser dev CORS bypass via universal /__proxy. Any Twitch-family
        // host gets routed server-side by Vite middleware which spoofs the
        // Origin/Referer headers to twitch.tv. Keep /__usher as a separate
        // path-based proxy because hls.js's internal XHRs (segments) need
        // a path-form URL to construct relative variant playlist URLs.
        var method = (args.method || 'GET').toUpperCase();
        if (url.indexOf('https://usher.ttvnw.net/') === 0) {
            url = url.replace('https://usher.ttvnw.net', '/__usher');
        } else if (/^https:\/\/(?:[^/]+\.)?(?:twitch\.tv|ttvnw\.net|jtvnw\.net|cloudfront\.net|twitchcdn\.net|akamaized\.net|llnwd\.net)\//.test(url)) {
            // Universal proxy for Twitch + CDN endpoints (gql, helix, AWS
            // CloudFront VOD assets like storyboards, etc.). The middleware
            // doesn't forward arbitrary client headers; we encode them in
            // the ?headers= b64-JSON param so Client-ID / Authorization
            // survive the round-trip.
            var hObj = {};
            if (args.headers && args.headers.length) {
                for (var hi = 0; hi < args.headers.length; hi++) {
                    hObj[args.headers[hi][0]] = args.headers[hi][1];
                }
            }
            var hB64 = '';
            try {
                // Twitch headers are ASCII (Client-ID, Authorization Bearer X);
                // btoa(JSON.stringify) is safe without the UTF-8 dance.
                hB64 = btoa(JSON.stringify(hObj));
            } catch (e) {
                hB64 = '';
            }
            url = '/__proxy?url=' + encodeURIComponent(url) + (hB64 ? '&headers=' + encodeURIComponent(hB64) : '');
        }
        var timeoutMs = typeof args.timeoutMs === 'number' ? args.timeoutMs : 8000;
        var validate = typeof args.validate === 'function' ? args.validate : null;

        var headers = {};
        // If we routed to /__proxy above, headers are already encoded in the
        // URL via ?headers= — don't re-send them as request headers (the
        // middleware ignores them anyway). But Content-Type for the POST
        // body still needs to be a real header so fetch sets it.
        var routedToProxy = url.indexOf('/__proxy?') === 0;
        if (args.headers && args.headers.length) {
            for (var i = 0; i < args.headers.length; i++) {
                var k = args.headers[i][0];
                var v = args.headers[i][1];
                if (routedToProxy && k.toLowerCase() !== 'content-type') continue;
                headers[k] = v;
            }
        }

        var ctrl = (typeof AbortController === 'function') ? new AbortController() : null;
        var timer = null;
        if (ctrl && timeoutMs > 0) {
            timer = setTimeout(function() { ctrl.abort(); }, timeoutMs);
        }

        return fetch(url, {
            method: method,
            headers: headers,
            body: args.body || undefined,
            signal: ctrl ? ctrl.signal : undefined
        }).then(function(res) {
            if (timer) { clearTimeout(timer); timer = null; }
            var ct = res.headers.get('content-type') || '';
            var parseBody = ct.indexOf('application/json') === 0
                ? res.text().then(function(t) { try { return JSON.parse(t); } catch (e) { return t; } })
                : res.text();
            return parseBody.then(function(body) {
                if (!res.ok) {
                    return Promise.reject({kind: 'http_status', status: res.status, detail: res.statusText, raw: body});
                }
                if (validate && !validate(body)) {
                    return Promise.reject({kind: 'validation', status: res.status, raw: body});
                }
                var outHeaders = {};
                res.headers.forEach(function(v, k) { outHeaders[k] = v; });
                return {status: res.status, headers: outHeaders, body: body};
            });
        }).catch(function(err) {
            if (timer) { clearTimeout(timer); timer = null; }
            if (err && err.kind) return Promise.reject(err);
            if (err && err.name === 'AbortError') {
                return Promise.reject({kind: 'http_timeout', detail: 'timed out after ' + timeoutMs + 'ms'});
            }
            return Promise.reject({kind: 'network', detail: err && err.message ? err.message : String(err), raw: err});
        });
    };

    // -- input --
    // Browser keyboard codes mapped to TV-remote concepts. Backspace is
    // the conventional "back" key in webOS dev; Space doubles as PLAY/PAUSE.
    Platform.input.keyCodes.BACK  = 8;
    Platform.input.keyCodes.UP    = 38;
    Platform.input.keyCodes.DOWN  = 40;
    Platform.input.keyCodes.LEFT  = 37;
    Platform.input.keyCodes.RIGHT = 39;
    Platform.input.keyCodes.ENTER = 13;
    Platform.input.keyCodes.PLAY  = 32;
    Platform.input.keyCodes.PAUSE = 32;
    Platform.input.registerKeys = function() {
        // Browser delivers all keys natively; nothing to register.
    };

    // -- lifecycle (browser dev — mostly no-op; webOS has its own adapter) --
    Platform.lifecycle.exit = function(args) {
        // Browser can't actually exit; closest is back-history pop or close.
        // No-op so upstream's BACK-twice doesn't error.
        void args;
    };
    Platform.lifecycle.loadUrl = function(url) {
        // No-op for browser dev — upstream sometimes uses this to deep-link
        // into a Twitch web page, but in our dev env we want to stay in the
        // app. webOS adapter uses the OS deep-link API; this stub is browser-only.
        console.log('[PlatformDesktop] lifecycle.loadUrl no-op for', url && url.slice(0, 80));
    };
    Platform.lifecycle.getLaunchParams = function() {
        return null;  // no deep-link payload in browser
    };
    // Browser dev: visibilitychange fires when tab is backgrounded.
    // Multiple subscribers supported; no off() in v1.
    var _resumeHandlers = [];
    var _suspendHandlers = [];
    function _fireLifecycle(arr) {
        for (var i = 0; i < arr.length; i++) {
            try { arr[i](); } catch (e) { /* swallow */ }
        }
    }
    document.addEventListener('visibilitychange', function () {
        if (document.hidden) _fireLifecycle(_suspendHandlers);
        else _fireLifecycle(_resumeHandlers);
    });
    Platform.lifecycle.onResume = function (handler) {
        if (typeof handler === 'function') _resumeHandlers.push(handler);
    };
    Platform.lifecycle.onSuspend = function (handler) {
        if (typeof handler === 'function') _suspendHandlers.push(handler);
    };
    Platform.lifecycle.setLanguage = function(/* lang */) {
        // Browser uses Accept-Language header; nothing app-side to do.
    };

    // Codec probe. args = {codec: 'h264'|'hevc'|'av1'|'vp9'|'aac'|...,
    // container?: 'mp4'|'webm'|'mpegurl'}. Returns 'yes'|'no'|'unknown'.
    // Uses MediaSource.isTypeSupported when available; falls back to
    // canPlayType for legacy paths.
    Platform.codec.supports = function (args) {
        var codec = args && args.codec;
        if (!codec) return 'unknown';
        var container = (args && args.container) || 'mp4';
        var codecMap = {
            h264:  'avc1.42E01E',
            avc:   'avc1.42E01E',
            hevc:  'hev1.1.6.L93.B0',
            h265:  'hev1.1.6.L93.B0',
            vp9:   'vp09.00.10.08',
            av1:   'av01.0.04M.08',
            aac:   'mp4a.40.2',
            opus:  'opus'
        };
        var c = codecMap[String(codec).toLowerCase()];
        if (!c) return 'unknown';
        var type = (container === 'webm' ? 'video/webm' : 'video/mp4') + '; codecs="' + c + '"';
        try {
            if (typeof MediaSource !== 'undefined' && MediaSource.isTypeSupported) {
                return MediaSource.isTypeSupported(type) ? 'yes' : 'no';
            }
            var v = document.createElement('video');
            var r = v.canPlayType(type);
            return r === 'probably' || r === 'maybe' ? 'yes' : 'no';
        } catch (e) {
            return 'unknown';
        }
    };
    Platform.codec.setBlacklist = function(/* codecs */) {};

    // -- player --
    // hls.js + a single <video> element appended to body. The element is
    // created on first start(); subsequent start() reuses it after destroying
    // the prior Hls instance.
    var _videoEl = null;
    var _hls = null;

    function _ensureVideo() {
        if (_videoEl) return _videoEl;
        _videoEl = document.createElement('video');
        _videoEl.id = 'platform-desktop-player';
        _videoEl.setAttribute('playsinline', '');
        // z-index: -1 mirrors LG's webOS port. The video sits BEHIND
        // upstream's scene2 (fullscreen player UI, z=1) so info bars,
        // controls panel, chat overlay etc. all render above it. For tile
        // preview, upstream marks the focused tile's <img> with the
        // `opacity_zero` class — the video at z=-1 shows through. No
        // controls=true: upstream's overlay UI is the user-facing player.
        _videoEl.style.cssText = 'position:fixed;left:0;top:0;width:100%;height:100%;background:#000;z-index:-1;display:block';
        document.body.appendChild(_videoEl);
        return _videoEl;
    }

    // Try unmuted first (matches LG webOS, where the TV's autoplay policy
    // is permissive and audio works from boot). If Chrome's desktop autoplay
    // block kicks in (NotAllowedError), mute and retry, then unmute on the
    // first user input. Mirrors OSInterface.js:812 in the LG port.
    var _unmuteHandlerWired = false;
    function _playWithMutedFallback(v) {
        var p = v.play();
        if (!p || typeof p.then !== 'function') return;
        p.catch(function (err) {
            if (!err || err.name !== 'NotAllowedError') return;
            v.muted = true;
            v.play().then(function () {
                if (_unmuteHandlerWired) return;
                _unmuteHandlerWired = true;
                var unmute = function () {
                    if (_videoEl) _videoEl.muted = false;
                    window.removeEventListener('keydown', unmute, true);
                    window.removeEventListener('pointerdown', unmute, true);
                };
                window.addEventListener('keydown', unmute, true);
                window.addEventListener('pointerdown', unmute, true);
            }).catch(function () { /* muted play also failed; nothing else we can do */ });
        });
    }

    // Apply a rect to the single <video>. z-index modes:
    //   fullscreen (default 0) — covers viewport, sits below upstream UI
    //     overlays at z>=1 but above the body root stacking context so
    //     chat translucency composites onto the actual video.
    //   tile (z=2) — small rect over the streams-grid thumbnails; needs
    //     to cover their black div bg.
    //   overlay (z=0) — large rect for side-by-side-with-chat mode; the
    //     bottom panel + info bar at z=auto/1 must render ABOVE the video.
    // Always anchor via top/left + width/height; clear right/bottom so a
    // prior rect doesn't bleed through.
    function _applyRect(v, rect) {
        if (!rect) return;
        v.style.position = 'fixed';
        v.style.right = 'auto';
        v.style.bottom = 'auto';
        if (rect.fullscreen === true) {
            v.style.left = '0';
            v.style.top = '0';
            v.style.width = '100%';
            v.style.height = '100%';
            v.style.zIndex = '0';
            return;
        }
        if (typeof rect.left   === 'number') v.style.left   = rect.left + 'px';
        if (typeof rect.top    === 'number') v.style.top    = rect.top + 'px';
        if (typeof rect.width  === 'number') v.style.width  = rect.width + 'px';
        if (typeof rect.height === 'number') v.style.height = rect.height + 'px';
        v.style.zIndex = rect.kind === 'tile' ? '2' : '0';
    }

    function _destroyHls() {
        if (_hls) {
            try { _hls.destroy(); } catch (e) { /* ignore */ }
            _hls = null;
        }
    }

    // Custom hls.js loader that proxies variant + segment URLs through the
    // dev /__proxy. Live variants come from *.ttvnw.net subdomains with
    // open CORS, but VOD variants live on AWS CloudFront which has none
    // — variant manifest + segment XHRs blow up in browser dev.
    //
    // Two transforms happen in this loader:
    // 1) Rewrite the request URL → /__proxy?url=<original>
    // 2) For .m3u8 responses, rewrite RELATIVE entries inside the playlist
    //    to absolute (against the original CloudFront URL). hls.js resolves
    //    relative segment URLs against context.url; since we changed
    //    context.url to the proxy URL, hls.js would otherwise resolve
    //    "2155.ts" to "localhost:5173/2155.ts" (a 404). Making them
    //    absolute lets our loader catch the segment request and re-proxy.
    // On real webOS this file isn't loaded; PlatformWebOS gets its own routing.
    var _ProxyLoader = null;
    function _getProxyLoader() {
        if (_ProxyLoader || !window.Hls) return _ProxyLoader;
        var Base = window.Hls.DefaultConfig.loader;
        var PROXY_RE = /^https:\/\/[^/]+\.(?:cloudfront|akamaized|llnwd|hls\.ttvnw|jtvnw|ttvnw)\.[^/]+\//;
        function ProxyLoader(config) {
            Base.call(this, config);
            var origLoad = this.load.bind(this);
            this.load = function (context, config, callbacks) {
                var origUrl = context && context.url;
                if (origUrl && PROXY_RE.test(origUrl) &&
                    origUrl.indexOf('/__proxy') === -1 && origUrl.indexOf('/__usher') === -1) {
                    context.url = '/__proxy?url=' + encodeURIComponent(origUrl);
                    // Wrap onSuccess to rewrite m3u8 relative URLs to absolute.
                    var origOnSuccess = callbacks.onSuccess;
                    callbacks.onSuccess = function (response, stats, ctx, networkDetails) {
                        if (response && typeof response.data === 'string' &&
                            response.data.charCodeAt(0) === 35 /* '#' */ &&
                            response.data.indexOf('#EXTM3U') === 0) {
                            var baseUrl = origUrl.substring(0, origUrl.lastIndexOf('/') + 1);
                            response.data = response.data.split('\n').map(function (line) {
                                if (!line || line.charCodeAt(0) === 35) return line;
                                if (/^https?:\/\//.test(line)) return line;
                                return baseUrl + line;
                            }).join('\n');
                        }
                        return origOnSuccess(response, stats, ctx, networkDetails);
                    };
                }
                return origLoad(context, config, callbacks);
            };
        }
        ProxyLoader.prototype = Object.create(Base.prototype);
        ProxyLoader.prototype.constructor = ProxyLoader;
        _ProxyLoader = ProxyLoader;
        return _ProxyLoader;
    }

    // Upstream OSInterface_mSetlatency values (en_US.js STR_LOWLATENCY_
    // ENABLE_ARRAY): 0 = Disabled, 1 = Normal mode, 2 = Lowest mode.
    var _latencyMode = 1;
    // Upstream setSpeedAdjustment: chase the live edge by playing
    // slightly fast while behind the target latency.
    var _speedAdjust = false;

    var _mediaRecoverAt = 0;
    var _netRecoverCount = 0;

    // _eventHandlers is declared further down (function-scoped var,
    // hoisted; assigned at module load — safe to reference here).
    function _emitPlayerEvent(event, payload) {
        var hs = _eventHandlers[event] || [];
        for (var i = 0; i < hs.length; i++) {
            try { hs[i](payload); } catch (e) { /* a listener error must not break playback */ }
        }
    }

    function _wireHlsErrorHandling() {
        var h = _hls;
        h.on(window.Hls.Events.ERROR, function(event, data) {
            if (!data || !data.fatal || _hls !== h) return;
            var H = window.Hls;
            if (data.type === H.ErrorTypes.MEDIA_ERROR) {
                // One recovery attempt per 10 s window — mirrors
                // upstream's single ExoPlayer retry before surfacing.
                var now = Date.now();
                if (now - _mediaRecoverAt > 10000) {
                    _mediaRecoverAt = now;
                    h.recoverMediaError();
                    return;
                }
            } else if (data.type === H.ErrorTypes.NETWORK_ERROR) {
                // Twitch 404s the playlist when the stream ends and 403s
                // sub-only content — surface those so the app runs its
                // offline path; retry everything else twice.
                var code = data.response && data.response.code;
                var surface = code === 404 || code === 403;
                if (!surface && _netRecoverCount < 2) {
                    _netRecoverCount++;
                    h.startLoad();
                    return;
                }
            }
            _emitPlayerEvent('error', {
                kind: data.type === H.ErrorTypes.MEDIA_ERROR ? 'media' : 'network',
                recoverable: false,
                detail: data.details
            });
        });
    }

    function _liveSyncFor(mode) {
        // Twitch live segments are 2 s. Disabled = conventional
        // 3-segment distance; Lowest hugs the edge hard (more rebuffer
        // risk, upstream warns the user the same way).
        if (mode === 0) return 6;
        if (mode === 2) return 1.5;
        return 2.5;
    }

    function _buildHlsConfig() {
        return {
            // ABR opens at ~6 Mbps so the first fragment request targets
            // the 1080p60 source rendition instead of ramping up from the
            // lowest. Twitch source tops out around 6-8 Mbps. Mirrors
            // upstream's raised DEFAULT_INITIAL_BITRATE_ESTIMATES_WIFI
            // media3 patch (apk/Media3 changes.md).
            abrEwmaDefaultEstimate: 6000000,
            testBandwidth: false,
            // Fetch the first fragment while MSE buffers are still being
            // set up (analog of upstream's 100 ms bufferForPlayback +
            // chunkless preparation: shave the startup round trips).
            startFragPrefetch: true,
            // Twitch splices ads with #EXT-X-DISCONTINUITY; jump small
            // buffer holes at splice points instead of stalling.
            maxBufferHole: 1,
            nudgeMaxRetry: 5,
            // liveSyncDuration is a TARGET (start position + rate-chase
            // goal), enforced only via maxLiveSyncPlaybackRate when speed
            // adjustment is on. liveMaxLatencyDuration is deliberately
            // NOT set: when exceeded it makes hls.js force-seek toward
            // the edge, and webOS swallows MSE seeks (verified on a real
            // TV, 2026-06-11) — the controller then seek-storms. Stock
            // hls.js also leaves it unset (count default = Infinity).
            liveSyncDuration: _liveSyncFor(_latencyMode),
            // webOS MSE appends get expensive as the SourceBuffer grows
            // (79 s of 1080p60 back-buffer measured ≈ 60 MB → per-append
            // jank); keep a short tail. Value live-tested on the TV.
            backBufferLength: 10,
            maxLiveSyncPlaybackRate: _speedAdjust ? 1.08 : 1
        };
    }

    // Serves the multivariant playlist that the app JS already fetched
    // (passed through StartAuto as manifestString) instead of letting
    // hls.js re-fetch the usher URL. Mirrors upstream Android's forked
    // DefaultHttpDataSource.setMainPlaylistBytes: every usher hit creates
    // a NEW playback session and costs a round trip, and a refetch can
    // hand the player a different variant set than the one the quality
    // menu was built from. Only requests with context.type === 'manifest'
    // (the multivariant playlist) are intercepted; level playlists and
    // segments flow through BaseLoader untouched.
    function _makeCachedManifestLoader(BaseLoader, manifestString) {
        function CachedManifestLoader(config) {
            BaseLoader.call(this, config);
            var inner = this;
            var origLoad = this.load.bind(this);
            var origAbort = this.abort.bind(this);
            var origDestroy = this.destroy.bind(this);
            var timer = null;
            function cancelPending() {
                if (timer !== null) {
                    clearTimeout(timer);
                    timer = null;
                }
            }
            // hls.js aborts/destroys loaders on stop and restart; a real
            // XHR dies with the abort, so the pending cached response
            // must die too instead of firing into a torn-down instance.
            this.abort = function () {
                cancelPending();
                return origAbort();
            };
            this.destroy = function () {
                cancelPending();
                return origDestroy();
            };
            this.load = function (context, cfg, callbacks) {
                if (context && context.type === 'manifest') {
                    var now = performance.now();
                    var stats = inner.stats;
                    stats.loading.start = now;
                    stats.loading.first = now;
                    stats.loading.end = now;
                    stats.loaded = manifestString.length;
                    stats.total = manifestString.length;
                    // Async so hls.js finishes wiring its event handlers
                    // before the response lands (sync callbacks break it).
                    timer = setTimeout(function () {
                        timer = null;
                        callbacks.onSuccess(
                            {url: context.url, data: manifestString},
                            stats,
                            context,
                            null
                        );
                    }, 0);
                    return;
                }
                return origLoad(context, cfg, callbacks);
            };
        }
        CachedManifestLoader.prototype = Object.create(BaseLoader.prototype);
        CachedManifestLoader.prototype.constructor = CachedManifestLoader;
        return CachedManifestLoader;
    }

    // Quick check for direct-playable (non-HLS) media. Twitch clips are MP4s
    // served from CloudFront; they don't need hls.js — we just point the
    // <video> at the URL. Strip the query string before checking extension.
    function _isDirectMedia(uri) {
        if (!uri) return false;
        var path = uri.split('?')[0].toLowerCase();
        return /\.(mp4|m4v|mov|webm)$/.test(path);
    }

    Platform.player.start = function(args) {
        if (!args || !args.uri) throw new Error('Platform.player.start: args.uri required');
        var v = _ensureVideo();
        v.style.display = 'block';
        _applyRect(v, args.rect);
        _destroyHls();

        // Direct media (e.g. clip .mp4): use native <video src>. Route Twitch
        // CDN hosts through /__proxy to clear CORS in dev.
        if (_isDirectMedia(args.uri)) {
            var directUri = args.uri;
            if (/^https:\/\/[^/]+\.(?:cloudfront|akamaized|llnwd|twitchcdn|jtvnw|ttvnw)\.[^/]+\//.test(directUri)) {
                directUri = '/__proxy?url=' + encodeURIComponent(directUri);
            }
            v.src = directUri;
            _playWithMutedFallback(v);
            return;
        }

        if (window.Hls && window.Hls.isSupported()) {
            // Rewrite the multivariant URL to the Vite /__usher proxy. Variant
            // playlists + segments hit *.ttvnw.net subdomains directly and may
            // CORS-fail in Chrome dev — full playback is gated by Twitch CDN
            // signing complexity. On webOS this rewrite is unnecessary (and
            // PlatformDesktop is not loaded on webOS).
            var startUri = args.uri;
            if (startUri.indexOf('https://usher.ttvnw.net/') === 0) {
                startUri = startUri.replace('https://usher.ttvnw.net', '/__usher');
            }
            var ProxyLoader = _getProxyLoader();
            var BaseLoader = ProxyLoader || window.Hls.DefaultConfig.loader;
            var hlsConfig = _buildHlsConfig();
            if (args.manifestString && args.manifestString.indexOf('#EXTM3U') === 0) {
                hlsConfig.loader = _makeCachedManifestLoader(BaseLoader, args.manifestString);
            } else if (ProxyLoader) {
                hlsConfig.loader = ProxyLoader;
            }
            _hls = new window.Hls(hlsConfig);
            _mediaRecoverAt = 0;
            _netRecoverCount = 0;
            _wireHlsErrorHandling();
            _hls.loadSource(startUri);
            _hls.attachMedia(v);
            _hls.on(window.Hls.Events.MANIFEST_PARSED, function() {
                _playWithMutedFallback(v);
            });
        } else if (v.canPlayType('application/vnd.apple.mpegurl')) {
            // Safari fallback (we don't target Safari, but it costs nothing).
            v.src = args.uri;
            _playWithMutedFallback(v);
        } else {
            throw new Error('Platform.player.start: HLS not supported in this browser');
        }
    };

    // Dev/test escape hatch: the HTML test pages and chrome-devtools
    // validation need the live hls.js instance. Not used by app code.
    Platform.player.getHlsInstance = function() {
        return _hls;
    };

    Platform.player.stop = function() {
        _destroyHls();
        if (_videoEl) {
            _videoEl.pause();
            _videoEl.removeAttribute('src');
            _videoEl.load();
            // Reset to fullscreen defaults so the next start() begins clean.
            // Mirrors LG's OSInterface_ClearSidePanelPlayer reset.
            _applyRect(_videoEl, {fullscreen: true});
            _videoEl.style.display = 'none';
        }
    };

    // setRect: reposition/resize the same <video> without restarting playback.
    // Used by upstream's ScreenPlayerRestore / SetPlayerViewSidePanel /
    // mupdatesize etc. so the SAME stream surface gets moved between
    // full-screen, side-panel, and feed-tile rects.
    Platform.player.setRect = function(rect) {
        if (!_videoEl) return;
        _applyRect(_videoEl, rect);
    };

    Platform.player.pause = function() {
        if (_videoEl) _videoEl.pause();
    };

    Platform.player.resume = function() {
        if (_videoEl) _playWithMutedFallback(_videoEl);
    };

    Platform.player.seek = function(positionMs) {
        if (_videoEl) _videoEl.currentTime = positionMs / 1000;
    };

    Platform.player.setQuality = function(position) {
        if (!_hls) return;
        // Upstream position semantics (Play.js Play_getQualities):
        // getQualities() lists 'Auto' first and assigns position = i - 1,
        // so -1 = Auto and 0..n-1 map 1:1 onto _hls.levels. nextLevel
        // switches at the next fragment without flushing the buffer.
        var p = parseInt(position, 10);
        _hls.nextLevel = (isNaN(p) || p < 0 || p >= _hls.levels.length) ? -1 : p;
    };

    Platform.player.getQualities = function() {
        // Shape matches upstream's expectation (see Play.js:999
        // `b.id.split('p')` — id must be a string like "1080p60"). First
        // element is "Auto" (position -1 in upstream's array), real
        // levels follow. Mirrors PlatformWebOS exactly.
        if (!_hls || !_hls.levels || !_hls.levels.length) return [];
        var out = [{id: 'Auto', bitrate: 0, band: '', codec: '', url: ''}];
        for (var i = 0; i < _hls.levels.length; i++) {
            var lvl = _hls.levels[i];
            var id = lvl.name;
            if (!id) {
                id = (lvl.height || 0) + 'p';
                if (lvl.frameRate && lvl.frameRate > 30) id += Math.round(lvl.frameRate);
            }
            var bitrate = lvl.bitrate || 0;
            var band = bitrate > 0 ? ' | ' + (bitrate / 1000000).toFixed(2) + 'Mbps' : '';
            var codec = '';
            var vc = (lvl.videoCodec || '').toLowerCase();
            if (vc.indexOf('avc') !== -1) codec = ' | AVC';
            else if (vc.indexOf('vp9') !== -1) codec = ' | VP9';
            else if (vc.indexOf('hvc') !== -1 || vc.indexOf('hev') !== -1) codec = ' | HEVC';
            else if (vc.indexOf('av01') !== -1) codec = ' | AV1';
            else if (vc.indexOf('mp4') !== -1) codec = ' | MP4';
            out.push({
                id: id, bitrate: bitrate, band: band, codec: codec,
                url: lvl.url && lvl.url[0] ? lvl.url[0] : ''
            });
        }
        return out;
    };

    Platform.player.getCurrentTime = function() {
        return _videoEl ? Math.floor(_videoEl.currentTime * 1000) : 0;
    };

    Platform.player.getDuration = function() {
        if (!_videoEl) return 0;
        var d = _videoEl.duration;
        if (!isFinite(d)) return 0;  // live streams report Infinity
        return Math.floor(d * 1000);
    };

    Platform.player.getState = function() {
        if (!_videoEl) return 'idle';
        if (!_videoEl.src && (!_hls || !_hls.url)) return 'idle';
        if (_videoEl.error) return 'error';
        if (_videoEl.ended) return 'ended';
        if (_videoEl.paused) {
            return _videoEl.readyState >= 2 ? 'paused' : 'loading';
        }
        return _videoEl.readyState >= 2 ? 'playing' : 'loading';
    };

    Platform.player.setPlaybackSpeed = function(rate) {
        // playbackRate must be > 0 — HTMLMediaElement throws NotSupportedError
        // on 0 or negative. Silently no-op invalid rates.
        if (!_videoEl || typeof rate !== 'number' || rate <= 0) return;
        _videoEl.playbackRate = rate;
    };

    Platform.player.setVolume = function(level) {
        if (_videoEl) _videoEl.volume = Math.max(0, Math.min(1, level));
    };

    Platform.player.setMuted = function(muted) {
        if (_videoEl) _videoEl.muted = !!muted;
    };

    // Upstream Settings sends a bitrate cap (bps) and a max vertical
    // resolution. Translate to hls.js's autoLevelCapping: find the highest
    // variant that satisfies BOTH constraints, pin auto-ABR to that index.
    // 0/0 clears the cap (-1).
    Platform.player.setMaxBitrate = function(bitrateBps, maxHeight) {
        if (!_hls || !_hls.levels || !_hls.levels.length) return;
        if (!bitrateBps && !maxHeight) { _hls.autoLevelCapping = -1; return; }
        var bestIdx = -1, bestBitrate = -1;
        for (var i = 0; i < _hls.levels.length; i++) {
            var l = _hls.levels[i];
            if (bitrateBps && l.bitrate > bitrateBps) continue;
            if (maxHeight && l.height > maxHeight) continue;
            if (l.bitrate > bestBitrate) { bestBitrate = l.bitrate; bestIdx = i; }
        }
        _hls.autoLevelCapping = bestIdx;
    };

    Platform.player.setLatencyMode = function(mode) {
        _latencyMode = mode === 0 || mode === 2 ? mode : 1;
        if (_hls && _hls.config) {
            // hls.js reads this continuously; mutating live config is
            // the supported way to retune latency without a restart.
            _hls.config.liveSyncDuration = _liveSyncFor(_latencyMode);
        }
    };

    Platform.player.setSpeedAdjustment = function(enabled) {
        _speedAdjust = !!enabled;
        if (_hls && _hls.config) {
            _hls.config.maxLiveSyncPlaybackRate = _speedAdjust ? 1.08 : 1;
        }
    };

    // Minimal event subscription. Maps a few hls.js / <video> events into
    // the Platform.player.on('event', handler) shape. v1.6 will harden this.
    // TODO v1.6: add off(event, handler) — _eventHandlers grows unboundedly.
    var _eventHandlers = {};  // {eventName: [handler, ...]}
    var _errorWired = false;
    var _endedWired = false;
    Platform.player.on = function(event, handler) {
        if (!_eventHandlers[event]) _eventHandlers[event] = [];
        _eventHandlers[event].push(handler);

        // Lazy-wire DOM/Hls listeners on first subscription. Idempotent.
        if (event === 'error' && !_errorWired) {
            _errorWired = true;
            _ensureVideo().addEventListener('error', function() {
                var hs = _eventHandlers['error'] || [];
                for (var i = 0; i < hs.length; i++) {
                    hs[i]({kind: 'media', recoverable: false});
                }
            });
        }
        if (event === 'ended' && !_endedWired) {
            _endedWired = true;
            _ensureVideo().addEventListener('ended', function() {
                var hs = _eventHandlers['ended'] || [];
                for (var i = 0; i < hs.length; i++) hs[i]();
            });
        }
        // 'progress', 'buffering', 'qualitychange' deferred to v1.6.
    };

    // Wire input handlers (no-op on Desktop; symmetry with PlatformWebOS).
    Platform.input.registerKeys();

    // ============ Platform.preview — second video surface ============
    //
    // Upstream Android exposes a "small player" for hover-preview while you
    // browse the feed row in-fullscreen. Without it, the shim has to no-op
    // StartFeedPlayer / StartSidePanelPlayer (otherwise they'd replace the
    // main stream's source — see PlatformShim's gate on Play_isOn). This
    // surface is the real implementation: a second <video> + Hls instance,
    // fixed to a bottom-right overlay, always muted (no audio contention
    // with the main stream).
    //
    // Live-only by design: feed-row previews never need VOD/clip playback.
    // Reuses _isDirectMedia / _getProxyLoader / _playWithMutedFallback from
    // the main player so dev-CORS routing stays consistent.

    var _previewVideoEl = null;
    var _previewHls = null;

    function _ensurePreviewVideo() {
        if (_previewVideoEl && document.body.contains(_previewVideoEl)) return _previewVideoEl;
        var v = document.createElement('video');
        v.id = 'platform-desktop-preview';
        v.muted = true;
        v.autoplay = true;
        v.playsInline = true;
        var s = v.style;
        // Default rect (corner overlay) — overwritten by _applyPreviewRect
        // when the shim hands us the focused-tile rect.
        s.cssText = [
            'position: fixed',
            'right: 3%', 'bottom: 6%',
            'width: 26%', 'aspect-ratio: 16 / 9',
            'background: #000',
            'z-index: 9999',
            'pointer-events: none',
            'box-shadow: 0 0.4em 1.6em rgba(0,0,0,0.6)',
            'border-radius: 0.3em',
            'display: none'
        ].join(';');
        document.body.appendChild(v);
        _previewVideoEl = v;
        return v;
    }

    // Position the preview video over a {top, left, width, height} rect in
    // viewport pixels. Used to overlay the focused feed-row thumbnail so
    // the live preview sits exactly where the user is looking. Clearing
    // `right`/`bottom`/`aspect-ratio` is important — leaving them in
    // combination with a width/height/top/left would fight CSS sizing.
    function _applyPreviewRect(rect) {
        if (!_previewVideoEl) return;
        var s = _previewVideoEl.style;
        if (rect && rect.width && rect.height) {
            s.right = 'auto';
            s.bottom = 'auto';
            s.aspectRatio = 'auto';
            s.top = rect.top + 'px';
            s.left = rect.left + 'px';
            s.width = rect.width + 'px';
            s.height = rect.height + 'px';
        } else {
            // Fall back to corner overlay
            s.top = 'auto';
            s.left = 'auto';
            s.right = '3%';
            s.bottom = '6%';
            s.width = '26%';
            s.height = 'auto';
            s.aspectRatio = '16 / 9';
        }
    }

    function _destroyPreviewHls() {
        if (_previewHls) {
            try { _previewHls.destroy(); } catch (e) {}
            _previewHls = null;
        }
    }

    Platform.preview = {};

    Platform.preview.start = function(args) {
        if (!args || !args.uri) return;
        var v = _ensurePreviewVideo();
        _destroyPreviewHls();
        _applyPreviewRect(args.rect);

        if (_isDirectMedia(args.uri)) {
            v.src = args.uri;
            v.style.display = 'block';
            _playWithMutedFallback(v);
            return;
        }

        if (window.Hls && window.Hls.isSupported()) {
            var startUri = args.uri;
            if (startUri.indexOf('https://usher.ttvnw.net/') === 0) {
                startUri = startUri.replace('https://usher.ttvnw.net', '/__usher');
            }
            var ProxyLoader = _getProxyLoader();
            _previewHls = new window.Hls(ProxyLoader ? { loader: ProxyLoader } : {});
            _previewHls.loadSource(startUri);
            _previewHls.attachMedia(v);
            _previewHls.on(window.Hls.Events.MANIFEST_PARSED, function() {
                v.style.display = 'block';
                v.muted = true;
                _playWithMutedFallback(v);
            });
        }
    };

    Platform.preview.stop = function() {
        _destroyPreviewHls();
        if (_previewVideoEl) {
            try { _previewVideoEl.pause(); } catch (e) {}
            _previewVideoEl.removeAttribute('src');
            try { _previewVideoEl.load(); } catch (e) {}
            _previewVideoEl.style.display = 'none';
        }
    };

    Platform.preview.setRect = function(rect) {
        _applyPreviewRect(rect);
    };

    // -- Bootstrap marker (smoke tests check this) --
    window['PlatformDesktopLoaded'] = true;
})();
