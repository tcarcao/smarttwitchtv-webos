/**
 * PlatformWebOS — LG webOS adapter for the Platform interface.
 *
 * Loaded after PlatformDesktop. No-ops in browser (no window.webOS);
 * PlatformDesktop has the mirror guard (no-ops on webOS). The result
 * is mutual exclusion without conditional loading.
 *
 * v1.2 surface: device / log / storage / lifecycle.exit.
 * v1.3 will add input. v1.6 will add player. http stays as throwing
 * stub for now — v1.4 will decide whether to use fetch (works on
 * webOS Chromium) or a webOS service for CORS-restricted endpoints.
 *
 * webOS API references used here:
 *   - window.webOS.platformBack()        : back/close semantics
 *   - webOSSystem.deviceInfo()           : JSON string with modelName/firmwareVersion/etc.
 *     (older firmware: window.PalmSystem.deviceInfo)
 */
(function() {
    'use strict';

    // Activate on ANY webOS marker. Real TVs expose window.webOS (from
    // webOSjs) + webOSSystem + PalmSystem. The desktop Simulator may only
    // expose webOSSystem — gating on window.webOS alone falls through to
    // PlatformDesktop, whose relative /__proxy URLs break under file://.
    if (!window['webOS'] && !window['webOSSystem'] && !window['PalmSystem']) return;

    if (!window['Platform']) {
        throw new Error('PlatformWebOS: Platform.js must load first');
    }

    var Platform = window['Platform'];

    // The webOS TV WebView's media pipeline ignores
    // HTMLMediaElement.playbackRate > 1.0 (clamped to 1.0) and partially
    // honours rates < 1.0 (~0.77x for 0.5x set). Verified empirically vs
    // Chrome which honours all rates accurately. Adapter declares the gap
    // so the shim's setPlaybackSpeed warns instead of silently doing
    // nothing.
    Platform.capabilities.controlsPlaybackRate = false;

    // -- webOS device-info cache --
    // webOSSystem.deviceInfo() returns a JSON string; parse once and cache.
    var _deviceInfo = null;
    function _getDeviceInfo() {
        if (_deviceInfo) return _deviceInfo;
        var raw = null;
        try {
            if (window['webOSSystem'] && typeof window['webOSSystem'].deviceInfo === 'function') {
                raw = window['webOSSystem'].deviceInfo();
            } else if (window['PalmSystem'] && window['PalmSystem'].deviceInfo) {
                raw = window['PalmSystem'].deviceInfo;
            }
        } catch (e) {
            raw = null;
        }
        try {
            _deviceInfo = raw ? JSON.parse(raw) : {};
        } catch (e) {
            _deviceInfo = {};
        }
        return _deviceInfo;
    }

    // -- device --
    Platform.device.name = function() {
        var info = _getDeviceInfo();
        return info.modelName || info.modelNumber || 'LG webOS TV';
    };
    Platform.device.manufacturer = function() {
        return 'LG';
    };
    Platform.device.systemVersion = function() {
        var info = _getDeviceInfo();
        return info.sdkVersion || info.firmwareVersion || 'unknown';
    };
    Platform.device.isTV = function() {
        return true;
    };
    Platform.device.appVersion = function() {
        // High version on all three components — upstream's Main_needUpdate
        // checks parseFloat(major.minor) < VersionBase (3.0) OR parseInt(patch)
        // < publishVersionCode (379). 999.99.99999 satisfies both, so the
        // forced-update dialog never appears. Our actual fork version lives
        // in package.json + git.
        return '999.99.99999';
    };

    // -- log --
    Platform.log.info = function(msg) {
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
        var args = ['[error]', msg];
        for (var i = 1; i < arguments.length; i++) args.push(arguments[i]);
        console.error.apply(console, args);
    };

    // -- storage --
    // webOS Chromium has full localStorage. Same impl as PlatformDesktop.
    Platform.storage.get = function(key) {
        var v = window.localStorage.getItem(key);
        if (v === null) return null;
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

    // -- lifecycle --
    // webOS.platformBack() pops navigation; from the root screen it returns
    // to the Launcher (effective app exit). args.background is ignored on
    // webOS — the OS controls foreground/background lifecycle.
    Platform.lifecycle.exit = function(/* args */) {
        if (window['webOS'] && typeof window['webOS'].platformBack === 'function') {
            window['webOS'].platformBack();
        } else if (window['PalmSystem'] && typeof window['PalmSystem'].platformBack === 'function') {
            window['PalmSystem'].platformBack();
        } else if (typeof window.close === 'function') {
            window.close();
        }
    };
    Platform.lifecycle.loadUrl = function(url) {
        // Upstream uses this to deep-link into Twitch web pages. In the TV
        // app we don't navigate the WebView away — that would unload the
        // entire app. webOSDev has a launchService for opening URLs in the
        // browser app; without it, the safest behavior is a no-op + log.
        console.log('[PlatformWebOS] lifecycle.loadUrl no-op for', url && String(url).slice(0, 80));
    };
    Platform.lifecycle.getLaunchParams = function() {
        // webOS passes launch params via window.webOSSystem.launchParams (JSON
        // string) or appinfo.json's launchPoint. Parse defensively; if unset,
        // return null so upstream's GetLastIntentObj handler sees no deep-link.
        try {
            var raw = window['webOSSystem'] && window['webOSSystem'].launchParams;
            if (!raw) return null;
            return typeof raw === 'string' ? raw : JSON.stringify(raw);
        } catch (e) {
            return null;
        }
    };
    // Lifecycle event sources on webOS TV:
    //   - 'visibilitychange' on document — fires when the app moves between
    //     foreground/background (user pressed Home, switched apps, etc).
    //   - 'webOSRelaunch' on document — fires when the user re-launches the
    //     app while it's already running (with new launchParams).
    // We register a single set of internal listeners and dispatch to any
    // handler the caller subscribes via onResume/onSuspend. Multiple calls
    // append handlers (no off() for v1).
    var _resumeHandlers = [];
    var _suspendHandlers = [];
    function _fire(arr) {
        for (var i = 0; i < arr.length; i++) {
            try { arr[i](); } catch (e) { console.warn('[PlatformWebOS] lifecycle handler threw:', e && e.message); }
        }
    }
    document.addEventListener('visibilitychange', function () {
        if (document.hidden) _fire(_suspendHandlers);
        else _fire(_resumeHandlers);
    });
    document.addEventListener('webOSRelaunch', function () {
        _fire(_resumeHandlers);
    });
    Platform.lifecycle.onResume = function (handler) {
        if (typeof handler === 'function') _resumeHandlers.push(handler);
    };
    Platform.lifecycle.onSuspend = function (handler) {
        if (typeof handler === 'function') _suspendHandlers.push(handler);
    };
    Platform.lifecycle.setLanguage = function(/* lang */) {
        // webOS exposes display language via webOSSystem.locale; the app's
        // language picker is a user-facing setting that toggles strings in
        // upstream's languages/*.js. Nothing OS-side to do.
    };

    // -- codec --
    // Probe with MediaSource.isTypeSupported. webOS Chromium can MSE-decode
    // H.264/AAC across all supported firmware; HEVC/AV1/VP9 depend on TV
    // model. Mirrors PlatformDesktop.codec.supports — keeps the shape
    // identical so upstream sees consistent answers.
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

    // -- http --
    // Promise-based fetch wrapper with abort-based timeout and an optional
    // validate predicate. Rejects with a typed error object:
    //   {kind: 'http_status'|'http_timeout'|'network'|'validation', detail, raw}
    // Headers are passed as [[key,val], ...] arrays (mirrors upstream's shape).
    // webOS 4.0+ Chromium supports fetch + AbortController natively.
    //
    // CORS: a real TV WebView ignores cross-origin restrictions, so direct
    // fetch to Twitch works. The LG webOS *Simulator* (a desktop Chromium
    // shell) enforces CORS just like a browser — Twitch requests get blocked.
    // Detect the Simulator via deviceInfo.modelName and route through the
    // dev server's /__proxy in that case. Override with
    // localStorage.setItem('__force_dev_proxy', '1') if detection misses.
    function _isSimulator() {
        try {
            if (window.localStorage && window.localStorage.getItem('__force_dev_proxy') === '1') {
                return true;
            }
        } catch (e) {}
        var info = _getDeviceInfo();
        var model = (info && info.modelName) || '';
        var biz = (info && info.platformBizType) || '';
        return /simulator|emulator/i.test(model) || /simulator|emulator/i.test(biz);
    }
    var DEV_PROXY_ORIGIN = 'http://localhost:5173';
    var TWITCH_HOSTS = /^https:\/\/(?:[^/]+\.)?(?:twitch\.tv|ttvnw\.net|jtvnw\.net|twitchcdn\.net|cloudfront\.net|akamaized\.net|llnwd\.net)\//i;

    // gql.twitch.tv rejects upstream's AddCode_clientId (the registered OAuth
    // app — only valid for Helix). Swap to AddCode_backup_client_id which is
    // the public-web Client-ID that GQL accepts. Mirrors PlatformDesktop.
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
        if (/^https:\/\/gql\.twitch\.tv\//.test(url)) {
            args = Object.assign({}, args, {headers: _patchGqlClientId(args.headers)});
        }
        var method = (args.method || 'GET').toUpperCase();
        var timeoutMs = typeof args.timeoutMs === 'number' ? args.timeoutMs : 8000;
        var validate = typeof args.validate === 'function' ? args.validate : null;

        var headers = {};
        if (args.headers && args.headers.length) {
            for (var i = 0; i < args.headers.length; i++) {
                headers[args.headers[i][0]] = args.headers[i][1];
            }
        }

        // Rewrite Twitch URLs through dev proxy when running in Simulator.
        // The /__proxy middleware reads `?url=` and `?headers=` (b64 JSON)
        // and forwards to Twitch with spoofed Origin: https://www.twitch.tv.
        // usher.ttvnw.net keeps a path-form (/__usher) for hls.js compat.
        var routedToProxy = false;
        if (_isSimulator()) {
            if (url.indexOf('https://usher.ttvnw.net/') === 0) {
                url = DEV_PROXY_ORIGIN + '/__usher' + url.slice('https://usher.ttvnw.net'.length);
            } else if (TWITCH_HOSTS.test(url)) {
                var hB64 = '';
                try { hB64 = btoa(JSON.stringify(headers)); } catch (e) { hB64 = ''; }
                url = DEV_PROXY_ORIGIN + '/__proxy?url=' + encodeURIComponent(url) +
                      (hB64 ? '&headers=' + encodeURIComponent(hB64) : '');
                // Headers are now in the URL; the proxy ignores request headers
                // (except Content-Type, which fetch must keep for POST bodies).
                var passThrough = {};
                if (headers['Content-Type']) passThrough['Content-Type'] = headers['Content-Type'];
                headers = passThrough;
                routedToProxy = true;
            }
        }
        void routedToProxy;

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

    // -- player --
    // hls.js + a single <video> element appended to body. Mirrors
    // PlatformDesktop's player. Differences vs desktop:
    //   - No /__usher proxy rewrite — webOS loads from IPK, not Vite, and
    //     uses webOS WebKit's native CORS (or Luna service if needed later).
    //   - No `muted = true` autoplay hack — TV apps expect audio on by default;
    //     Chrome's browser-only autoplay restriction doesn't apply on webOS.
    var _videoEl = null;
    var _hls = null;

    function _ensureVideo() {
        if (_videoEl) return _videoEl;
        _videoEl = document.createElement('video');
        _videoEl.id = 'platform-webos-player';
        _videoEl.setAttribute('playsinline', '');
        // z-index: -1 mirrors LG's webOS port. The video sits BEHIND
        // upstream's scene2 (fullscreen player UI, z=1) so info bars,
        // controls panel, chat overlay etc. all render above it. For tile
        // preview, upstream marks the focused tile's <img> with the
        // `opacity_zero` class — the video at z=-1 shows through.
        _videoEl.style.cssText = 'position:fixed;left:0;top:0;width:100%;height:100%;background:#000;z-index:-1;display:block';
        document.body.appendChild(_videoEl);
        return _videoEl;
    }

    // Apply a rect to the single <video>. z-index modes:
    //   fullscreen (default 0) — covers viewport, sits below upstream UI
    //     overlays at z>=1 but above the body root stacking context so
    //     chat translucency composites onto the actual video.
    //   tile (z=2) — small rect over the streams-grid thumbnails; needs
    //     to cover their black div bg.
    //   overlay (z=0) — large rect for side-by-side-with-chat mode; the
    //     bottom panel + info bar must render ABOVE the video.
    // Mirrors PlatformDesktop._applyRect exactly.
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

    // Simulator-only hls.js loader that proxies variant + segment URLs
    // through the dev /__proxy. VOD variants live on AWS CloudFront which
    // enforces CORS in the Simulator's Chromium (real TVs ignore CORS).
    // Mirrors PlatformDesktop's loader; rewrites both URL and m3u8 body
    // to make relative segment URLs absolute before hls.js parses.
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
                    context.url = DEV_PROXY_ORIGIN + '/__proxy?url=' + encodeURIComponent(origUrl);
                    var origOnSuccess = callbacks.onSuccess;
                    callbacks.onSuccess = function (response, stats, ctx, networkDetails) {
                        if (response && typeof response.data === 'string' &&
                            response.data.charCodeAt(0) === 35 &&
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

        // Direct media (e.g. clip .mp4): use native <video src>. In the
        // Simulator we route Twitch CDN hosts through /__proxy. On real
        // TV the URL stays as-is.
        if (_isDirectMedia(args.uri)) {
            var directUri = args.uri;
            if (_isSimulator() &&
                /^https:\/\/[^/]+\.(?:cloudfront|akamaized|llnwd|twitchcdn|jtvnw|ttvnw)\.[^/]+\//.test(directUri)) {
                directUri = DEV_PROXY_ORIGIN + '/__proxy?url=' + encodeURIComponent(directUri);
            }
            v.src = directUri;
            v.play();
            return;
        }

        // Simulator-only: rewrite usher.ttvnw.net to the dev /__usher proxy
        // so hls.js can fetch the multivariant playlist without CORS. Real
        // TV WebView has no CORS — uri stays as-is.
        var startUri = args.uri;
        if (_isSimulator() && startUri.indexOf('https://usher.ttvnw.net/') === 0) {
            startUri = DEV_PROXY_ORIGIN + '/__usher' + startUri.slice('https://usher.ttvnw.net'.length);
        }

        if (window.Hls && window.Hls.isSupported()) {
            // Only use the proxy loader in Simulator. On real TV no rewrite
            // needed (no CORS), so default loader fetches CloudFront directly.
            var hlsConfig = {};
            if (_isSimulator()) {
                var ProxyLoader = _getProxyLoader();
                if (ProxyLoader) hlsConfig.loader = ProxyLoader;
            }
            _hls = new window.Hls(hlsConfig);
            _hls.loadSource(startUri);
            _hls.attachMedia(v);
            _hls.on(window.Hls.Events.MANIFEST_PARSED, function() {
                v.play();
            });
        } else {
            // webOS without MSE support — shouldn't happen on webOS 4.0+,
            // but fall through to native <video> just in case.
            v.src = startUri;
            v.play();
        }
    };

    // setRect: reposition the same <video> without restarting playback.
    // Used by upstream's ScreenPlayerRestore / SetPlayerViewSidePanel /
    // mupdatesize so the same stream surface moves between full-screen,
    // side-panel, and feed-tile rects.
    Platform.player.setRect = function(rect) {
        if (!_videoEl) return;
        _applyRect(_videoEl, rect);
    };

    Platform.player.stop = function() {
        _destroyHls();
        if (_videoEl) {
            _videoEl.pause();
            _videoEl.removeAttribute('src');
            _videoEl.load();
            // Reset to fullscreen defaults so the next start() begins clean.
            _applyRect(_videoEl, {fullscreen: true});
            _videoEl.style.display = 'none';
        }
    };

    Platform.player.pause = function() {
        if (_videoEl) _videoEl.pause();
    };

    Platform.player.resume = function() {
        if (_videoEl) _videoEl.play();
    };

    Platform.player.seek = function(positionMs) {
        if (_videoEl) _videoEl.currentTime = positionMs / 1000;
    };

    Platform.player.setQuality = function(/* index */) {
        // hls.js auto-quality on by default; explicit selection v1.6.x+
    };

    Platform.player.getQualities = function() {
        // Shape matches upstream's expectation (see Play.js:999
        // `b.id.split('p')` — id must be a string like "1080p60"). First
        // element is "Auto" (position -1 in upstream's array), real
        // levels follow. Codec/band are decorations upstream renders in
        // the quality picker.
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
        if (!isFinite(d)) return 0;
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
        if (!_videoEl || typeof rate !== 'number' || rate <= 0) return;
        _videoEl.playbackRate = rate;
    };

    Platform.player.setVolume = function(level) {
        if (_videoEl) _videoEl.volume = Math.max(0, Math.min(1, level));
    };

    Platform.player.setMuted = function(muted) {
        if (_videoEl) _videoEl.muted = !!muted;
    };

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
        if (!_hls || !_hls.config) return;
        var liveSync, liveMax;
        if (mode === 0)      { liveSync = 1.5; liveMax = 4;  }
        else if (mode === 1) { liveSync = 2.5; liveMax = 6;  }
        else                 { liveSync = 5;   liveMax = 10; }
        _hls.config.liveSyncDuration = liveSync;
        _hls.config.liveMaxLatencyDuration = liveMax;
    };

    var _eventHandlers = {};
    var _errorWired = false;
    var _endedWired = false;
    Platform.player.on = function(event, handler) {
        if (!_eventHandlers[event]) _eventHandlers[event] = [];
        _eventHandlers[event].push(handler);
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
    };

    // -- input --
    // webOS TV remote keycodes (standard webOS-4+ key map).
    // BACK=461 is the dedicated Back button; on the Magic Remote this is
    // the curved-arrow key. Arrows are W3C standard (37-40). Enter=13 is
    // the wheel-click. Play=415 / Pause=19 / Stop=413 are the dedicated
    // media keys on remotes that have them (Magic Remote with playback
    // pad, otherwise emulated via app UI).
    Platform.input.keyCodes.BACK  = 461;
    Platform.input.keyCodes.UP    = 38;
    Platform.input.keyCodes.DOWN  = 40;
    Platform.input.keyCodes.LEFT  = 37;
    Platform.input.keyCodes.RIGHT = 39;
    Platform.input.keyCodes.ENTER = 13;
    Platform.input.keyCodes.PLAY  = 415;
    Platform.input.keyCodes.PAUSE = 19;
    Platform.input.registerKeys = function() {
        // The Back key (461) on the desktop Simulator's Chromium triggers
        // window.history.back() in addition to dispatching keydown — that
        // would unload the SPA. Pre-empt the default in capture phase so
        // the upstream KEY_RETURN switch-case handler is the only thing
        // that runs. On real TVs this is a no-op (webOSjs already
        // preventDefaults system-side).
        window.addEventListener('keydown', function (e) {
            if (e.keyCode === Platform.input.keyCodes.BACK) e.preventDefault();
        }, true);
    };

    // Wire input handlers (back-key preventDefault on this platform).
    Platform.input.registerKeys();

    // Viewport refit. Upstream's `calculateFontSize()` runs once at boot
    // and again on resize — but the resize handler bails when
    // Main_IsOn_OSInterface is true (it expects Android-native to drive
    // the layout). In the Simulator the window starts at 0×0 and resizes
    // to 1920×1080 a moment later; without our help, body stays 0×0 and
    // every child renders invisible. Re-run calculateFontSize once a
    // real viewport appears, then on every subsequent resize.
    function _refit() {
        if (typeof window.calculateFontSize === 'function' &&
            window.innerWidth > 0 && window.innerHeight > 0) {
            try { window.calculateFontSize(); } catch (e) {}
        }
    }
    function _waitForViewport() {
        if (window.innerWidth > 0 && window.innerHeight > 0 &&
            typeof window.calculateFontSize === 'function') {
            _refit();
        } else {
            // requestAnimationFrame falls back to setTimeout on environments
            // without rAF, but webOS Chromium always has it.
            (window.requestAnimationFrame || function (f) { setTimeout(f, 16); })(_waitForViewport);
        }
    }
    _waitForViewport();
    window.addEventListener('resize', _refit, false);

    // Screensaver guard. webOS 6.0+ removed the user-facing "screensaver off"
    // setting, and the docs' claim that fullscreen video suppresses the
    // screensaver only holds on OLED panels — on LED sets (and likely
    // whenever video is fed through MSE/hls.js rather than native fullscreen)
    // the fireworks saver fires every ~2 min mid-stream. navigator.wakeLock
    // is broken on webOS (the promise never resolves). The official escape
    // hatch is the tvpower Luna service: subscribe to screensaver requests,
    // then reply with ack:false to NACK them while a stream is playing.
    // We let the request through when nothing is playing so the panel still
    // gets to rest if the user wanders away on a menu screen.
    function _installScreensaverGuard() {
        if (typeof WebOSServiceBridge === 'undefined') return;
        var bridge = new WebOSServiceBridge();
        bridge.onservicecallback = function (msg) {
            try {
                var m = JSON.parse(msg);
                if (m && m.state === 'Active') {
                    var playing = _videoEl && !_videoEl.paused && !_videoEl.ended && _videoEl.readyState > 2;
                    bridge.call(
                        'luna://com.webos.service.tvpower/power/responseScreenSaverRequest',
                        JSON.stringify({
                            clientName: 'SmartTwitchTV',
                            ack: !playing,
                            timestamp: m.timestamp
                        })
                    );
                }
            } catch (e) {}
        };
        bridge.call(
            'luna://com.webos.service.tvpower/power/registerScreenSaverRequest',
            JSON.stringify({subscribe: true, clientName: 'SmartTwitchTV'})
        );
    }
    _installScreensaverGuard();

    // ============ Platform.preview — second video surface ============
    // Mirrors PlatformDesktop's Platform.preview; same Simulator-vs-TV
    // routing rules as the main player.
    var _previewVideoEl = null;
    var _previewHls = null;

    function _ensurePreviewVideo() {
        if (_previewVideoEl && document.body.contains(_previewVideoEl)) return _previewVideoEl;
        var v = document.createElement('video');
        v.id = 'platform-webos-preview';
        v.muted = true;
        v.autoplay = true;
        v.playsInline = true;
        var s = v.style;
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
            var directUri = args.uri;
            if (_isSimulator() &&
                /^https:\/\/[^/]+\.(?:cloudfront|akamaized|llnwd|twitchcdn|jtvnw|ttvnw)\.[^/]+\//.test(directUri)) {
                directUri = DEV_PROXY_ORIGIN + '/__proxy?url=' + encodeURIComponent(directUri);
            }
            v.src = directUri;
            v.style.display = 'block';
            v.play();
            return;
        }

        var startUri = args.uri;
        if (_isSimulator() && startUri.indexOf('https://usher.ttvnw.net/') === 0) {
            startUri = DEV_PROXY_ORIGIN + '/__usher' + startUri.slice('https://usher.ttvnw.net'.length);
        }

        if (window.Hls && window.Hls.isSupported()) {
            var hlsConfig = {};
            if (_isSimulator()) {
                var ProxyLoader = _getProxyLoader();
                if (ProxyLoader) hlsConfig.loader = ProxyLoader;
            }
            _previewHls = new window.Hls(hlsConfig);
            _previewHls.loadSource(startUri);
            _previewHls.attachMedia(v);
            _previewHls.on(window.Hls.Events.MANIFEST_PARSED, function() {
                v.style.display = 'block';
                v.muted = true;
                v.play();
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

    // -- Bootstrap marker (smoke tests / debugging) --
    window['PlatformWebOSLoaded'] = true;
})();
