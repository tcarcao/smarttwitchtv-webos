/**
 * PlatformShim — legacy compatibility layer.
 *
 * Upstream JS calls window.Android.X(...) directly. This shim defines
 * window.Android as a Proxy that translates those calls into Platform.X
 * equivalents. The mapping table grows slice by slice as upstream callers
 * are reviewed; see sync/upstream-mapping.md.
 *
 * Any Android.X access that isn't in the mapping throws loudly — that's
 * how we surface unmapped upstream calls instead of silently failing.
 *
 * This file is deleted once every specific/*.js file has been refactored
 * to call Platform.X directly. Until then, it is load-bearing.
 */
(function() {
    'use strict';

    if (typeof window.Proxy !== 'function') {
        throw new Error('PlatformShim requires Proxy support (webOS 4.0+ / any modern browser)');
    }

    // Local alias — Platform.js assigns to window['Platform'] (bracket access for TS friendliness).
    // The closures below capture this local binding, which points to the actual Platform object.
    var Platform = window['Platform'];

    var mapping = {
        // -- Boot / device info --
        getversion:        function() { return Platform.device.appVersion(); },
        getdebug:          function() { return false; },
        deviceIsTV:        function() { return Platform.device.isTV(); },
        getDevice:         function() { return Platform.device.name(); },
        getManufacturer:   function() { return Platform.device.manufacturer(); },
        getSDK:            function() { return Platform.device.systemVersion(); },
        getWebviewVersion: function() { return Platform.device.systemVersion(); }

        // Additional mappings will be added in subsequent slices as the
        // upstream callers are refactored. See sync/upstream-mapping.md.
    };

    window['Android'] = new Proxy(mapping, {
        get: function(target, prop) {
            if (prop in target) return target[prop];
            return function() {
                var msg = 'Android.' + String(prop) + ' not mapped in PlatformShim — see sync/upstream-mapping.md';
                console.error('[PlatformShim]', msg);
                throw new Error(msg);
            };
        }
    });
})();
