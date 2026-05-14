/**
 * Platform — the seam between business code and the host environment.
 *
 * Every host (webOS, browser-for-dev, possibly future Tizen) provides one
 * adapter that overwrites these stubs at load time. Until a stub is
 * overwritten, calling it throws PlatformNotImplementedError loudly so we
 * never silently no-op.
 *
 * Contract authority: docs/superpowers/specs/2026-05-14-webos-port-design.md
 * (section "The Platform interface").
 *
 * @typedef {Object} PlayerStartArgs
 * @property {string} uri
 * @property {string} [manifestString]   - pre-cleaned HLS manifest (JS preprocesses upstream of the bridge)
 * @property {number} [resumePosition]   - ms
 * @property {'live'|'vod'|'clip'} kind
 * @property {{bottom?:number,right?:number,left?:number,height?:number,fullscreen?:boolean}} rect
 *
 * @typedef {Object} HttpRequestArgs
 * @property {string} url
 * @property {'GET'|'POST'|'PUT'|'DELETE'} [method='GET']
 * @property {Array<[string,string]>} [headers]
 * @property {string} [body]
 * @property {number} [timeoutMs=8000]
 * @property {(body:any)=>boolean} [validate]
 *
 * @typedef {Object} HttpResponse
 * @property {number} status
 * @property {Object<string,string>} headers
 * @property {any} body
 */
(function() {
    'use strict';

    function PlatformNotImplementedError(method) {
        var e = new Error('Platform.' + method + ' not implemented');
        e.name = 'PlatformNotImplementedError';
        e.method = method;
        return e;
    }

    function stub(method) {
        return function() {
            console.error('[Platform]', 'Platform.' + method + ' not implemented');
            throw PlatformNotImplementedError(method);
        };
    }

    window.PlatformNotImplementedError = PlatformNotImplementedError;

    window.Platform = {
        capabilities: {
            multiPlayer: false,
            pictureInPicture: false,
            nativeNotifications: false,
            deepLinks: true,
            hardwareHLS: false,
            surfaceBehindWebView: false
        },

        player: {
            start: stub('player.start'),
            stop: stub('player.stop'),
            pause: stub('player.pause'),
            resume: stub('player.resume'),
            seek: stub('player.seek'),
            setQuality: stub('player.setQuality'),
            getQualities: stub('player.getQualities'),
            getCurrentTime: stub('player.getCurrentTime'),
            getDuration: stub('player.getDuration'),
            getState: stub('player.getState'),
            setPlaybackSpeed: stub('player.setPlaybackSpeed'),
            setVolume: stub('player.setVolume'),
            on: stub('player.on')
        },

        multiPlayer: null,

        http: {
            request: stub('http.request')
        },

        input: {
            registerKeys: stub('input.registerKeys'),
            keyCodes: {}
        },

        device: {
            name: stub('device.name'),
            manufacturer: stub('device.manufacturer'),
            systemVersion: stub('device.systemVersion'),
            isTV: stub('device.isTV'),
            appVersion: stub('device.appVersion')
        },

        codec: {
            supports: stub('codec.supports'),
            setBlacklist: stub('codec.setBlacklist')
        },

        notifications: null,

        lifecycle: {
            exit: stub('lifecycle.exit'),
            loadUrl: stub('lifecycle.loadUrl'),
            getLaunchParams: stub('lifecycle.getLaunchParams'),
            onResume: stub('lifecycle.onResume'),
            onSuspend: stub('lifecycle.onSuspend'),
            setLanguage: stub('lifecycle.setLanguage')
        },

        storage: {
            get: stub('storage.get'),
            set: stub('storage.set'),
            remove: stub('storage.remove')
        },

        log: {
            info: stub('log.info'),
            warn: stub('log.warn'),
            error: stub('log.error')
        }
    };
})();
