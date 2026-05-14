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

    // -- Bootstrap marker (smoke tests check this) --
    window['PlatformDesktopLoaded'] = true;
})();
