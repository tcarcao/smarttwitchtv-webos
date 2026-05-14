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

    // -- Bootstrap marker (smoke tests / debugging) --
    window['PlatformWebOSLoaded'] = true;
})();
