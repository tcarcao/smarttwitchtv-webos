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

    if (!window['webOS']) return;

    if (!window['Platform']) {
        throw new Error('PlatformWebOS: Platform.js must load first');
    }

    var Platform = window['Platform'];

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
        return '0.0.1';
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

    // -- http --
    // Promise-based fetch wrapper with abort-based timeout and an optional
    // validate predicate. Rejects with a typed error object:
    //   {kind: 'http_status'|'http_timeout'|'network'|'validation', detail, raw}
    // Headers are passed as [[key,val], ...] arrays (mirrors upstream's shape).
    // webOS 4.0+ Chromium supports fetch + AbortController natively.
    Platform.http.request = function(args) {
        var url = args && args.url;
        if (!url) {
            return Promise.reject({kind: 'invalid_args', detail: 'url required'});
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
        // webOS delivers all standard remote keys natively as keydown events;
        // explicit registration (Tizen-style) is not required. If a future
        // firmware exposes a key that needs webOSDev.registerKey, add the
        // call here gated on capability detection.
    };

    // -- Bootstrap marker (smoke tests / debugging) --
    window['PlatformWebOSLoaded'] = true;
})();
