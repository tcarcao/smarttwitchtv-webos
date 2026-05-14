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

    // -- Bootstrap marker (smoke tests / debugging) --
    window['PlatformWebOSLoaded'] = true;
})();
