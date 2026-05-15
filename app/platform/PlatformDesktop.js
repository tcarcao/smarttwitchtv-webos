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

    // Platform detection: no-op on webOS (PlatformWebOS.js, landing in v1.2,
    // owns those overrides). Loading both adapters would race on Platform.X
    // assignments and could leave an orphan <video> element from this
    // adapter's _ensureVideo() call.
    if (window['webOS']) return;

    if (!window['Platform']) {
        throw new Error('PlatformDesktop: Platform.js must load first');
    }

    var Platform = window['Platform'];

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
        return '0.0.1';
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
    Platform.http.request = function(args) {
        var url = args && args.url;
        if (!url) {
            return Promise.reject({kind: 'invalid_args', detail: 'url required'});
        }
        // Browser dev CORS bypass via universal /__proxy. Any Twitch-family
        // host gets routed server-side by Vite middleware which spoofs the
        // Origin/Referer headers to twitch.tv. Keep /__usher as a separate
        // path-based proxy because hls.js's internal XHRs (segments) need
        // a path-form URL to construct relative variant playlist URLs.
        var method = (args.method || 'GET').toUpperCase();
        if (url.indexOf('https://usher.ttvnw.net/') === 0) {
            url = url.replace('https://usher.ttvnw.net', '/__usher');
        } else if (/^https:\/\/(?:[^/]+\.)?(?:twitch\.tv|ttvnw\.net|jtvnw\.net)\//.test(url)) {
            // Universal proxy for other Twitch endpoints (gql, helix, etc.).
            // The middleware doesn't forward arbitrary client headers; we
            // encode them in the ?headers= b64-JSON param so Client-ID /
            // Authorization survive the round-trip.
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
        _videoEl.muted = true;  // Chrome blocks unmuted autoplay; users unmute via UI
        // No controls=true — upstream's overlay UI is the user-facing player
        // controls; native browser controls would compete and look wrong.
        _videoEl.style.cssText = 'position:fixed;left:0;top:0;width:100%;height:100%;background:#000;z-index:0;display:block';
        document.body.appendChild(_videoEl);
        return _videoEl;
    }

    // Apply a rect to the single <video>. Upstream's positioning calls
    // (StartScreensPlayer, SetPlayerViewFeedBottom, mupdatesize, etc.)
    // describe pixel offsets from edges. CSS handles them directly.
    function _applyRect(v, rect) {
        if (!rect) return;
        if (rect.fullscreen === true) {
            v.style.position = 'fixed';
            v.style.left = '0';
            v.style.top = '0';
            v.style.right = '0';
            v.style.bottom = '0';
            v.style.width = '100%';
            v.style.height = '100%';
            return;
        }
        v.style.position = 'fixed';
        if (typeof rect.left   === 'number') { v.style.left   = rect.left + 'px';   v.style.width = 'auto'; }
        if (typeof rect.right  === 'number') { v.style.right  = rect.right + 'px'; }
        if (typeof rect.top    === 'number') { v.style.top    = rect.top + 'px';    v.style.height = 'auto'; }
        if (typeof rect.bottom === 'number') { v.style.bottom = rect.bottom + 'px'; }
        if (typeof rect.height === 'number') { v.style.height = rect.height + 'px'; }
        if (typeof rect.width  === 'number') { v.style.width  = rect.width + 'px'; }
    }

    function _destroyHls() {
        if (_hls) {
            try { _hls.destroy(); } catch (e) { /* ignore */ }
            _hls = null;
        }
    }

    Platform.player.start = function(args) {
        if (!args || !args.uri) throw new Error('Platform.player.start: args.uri required');
        var v = _ensureVideo();
        v.style.display = 'block';
        _applyRect(v, args.rect);
        _destroyHls();

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
            _hls = new window.Hls();
            _hls.loadSource(startUri);
            _hls.attachMedia(v);
            _hls.on(window.Hls.Events.MANIFEST_PARSED, function() {
                v.play();
            });
        } else if (v.canPlayType('application/vnd.apple.mpegurl')) {
            // Safari fallback (we don't target Safari, but it costs nothing).
            v.src = args.uri;
            v.play();
        } else {
            throw new Error('Platform.player.start: HLS not supported in this browser');
        }
    };

    Platform.player.stop = function() {
        _destroyHls();
        if (_videoEl) {
            _videoEl.pause();
            _videoEl.removeAttribute('src');
            _videoEl.load();
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
        if (_videoEl) _videoEl.play();
    };

    Platform.player.seek = function(positionMs) {
        if (_videoEl) _videoEl.currentTime = positionMs / 1000;
    };

    Platform.player.setQuality = function(/* index */) {
        // hls.js auto-quality on by default; explicit selection deferred to v1.6
        // when getQualities() returns a real list.
    };

    Platform.player.getQualities = function() {
        if (!_hls || !_hls.levels) return [];
        var out = [];
        for (var i = 0; i < _hls.levels.length; i++) {
            var lvl = _hls.levels[i];
            out.push({
                index: i,
                label: (lvl.height || 0) + 'p',
                bitrate: lvl.bitrate || 0
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

    // -- Bootstrap marker (smoke tests check this) --
    window['PlatformDesktopLoaded'] = true;
})();
