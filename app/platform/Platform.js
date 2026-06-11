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
 * @property {{top?:number,right?:number,bottom?:number,left?:number,width?:number,height?:number,fullscreen?:boolean}} rect
 *
 * @typedef {Object} HttpRequestArgs
 * @property {string} url
 * @property {'GET'|'POST'|'PUT'|'DELETE'} [method='GET']
 * @property {Array<[string,string]>} [headers]
 * @property {string} [body]
 * @property {number} [timeoutMs=8000]
 * @property {(body:string|Object)=>boolean} [validate]   - called with parsed body; return false to reject (Promise rejects with kind:'validation')
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

    window['PlatformNotImplementedError'] = PlatformNotImplementedError;

    window['Platform'] = {
        capabilities: {
            multiPlayer: false,
            pictureInPicture: false,
            nativeNotifications: false,
            deepLinks: true,
            hardwareHLS: false,
            surfaceBehindWebView: false,
            // Whether the platform's media pipeline honours
            // HTMLMediaElement.playbackRate. Chromium does; the webOS TV
            // WebView's HW decoder clamps rate > 1.0 to 1.0 and slows
            // rates < 1.0 imperfectly. Adapter overrides as needed.
            controlsPlaybackRate: true
        },

        player: {
            start: stub('player.start'),                     // (PlayerStartArgs) => void
            stop: stub('player.stop'),                       // () => void
            pause: stub('player.pause'),                     // () => void
            resume: stub('player.resume'),                   // () => void
            seek: stub('player.seek'),                       // (positionMs:number) => void
            setQuality: stub('player.setQuality'),           // (index:number) => void
            getQualities: stub('player.getQualities'),       // => Array<{index:number,label:string,bitrate?:number}>
            getCurrentTime: stub('player.getCurrentTime'),   // => number (ms)
            getDuration: stub('player.getDuration'),         // => number (ms)
            getState: stub('player.getState'),               // => 'idle'|'loading'|'playing'|'paused'|'ended'|'error'
            setPlaybackSpeed: stub('player.setPlaybackSpeed'), // (rate:number) => void
            setVolume: stub('player.setVolume'),             // (level:number) => void
            on: stub('player.on')                            // (event:string, handler:Function) => void
        },

        multiPlayer: null,

        http: {
            request: stub('http.request')   // (HttpRequestArgs) => Promise<HttpResponse>
        },

        input: {
            registerKeys: stub('input.registerKeys'), // () => void; adapter calls platform-specific key registration
            keyCodes: {}                              // adapter must populate with {BACK, UP, DOWN, LEFT, RIGHT, ENTER, PLAY, PAUSE, ...}
        },

        device: {
            name: stub('device.name'),                       // => string
            manufacturer: stub('device.manufacturer'),       // => string
            systemVersion: stub('device.systemVersion'),     // => string
            isTV: stub('device.isTV'),                       // => boolean
            appVersion: stub('device.appVersion')            // => string
        },

        codec: {
            supports: stub('codec.supports'),         // ({codec:string,profile?:string,level?:string}) => boolean|'unknown'
            setBlacklist: stub('codec.setBlacklist') // (codecs:string[]) => void
        },

        notifications: null,

        lifecycle: {
            exit: stub('lifecycle.exit'),                       // ({background?:boolean}) => void
            loadUrl: stub('lifecycle.loadUrl'),                 // (url:string) => void
            getLaunchParams: stub('lifecycle.getLaunchParams'), // => Object|null
            onResume: stub('lifecycle.onResume'),               // (handler:Function) => void
            onSuspend: stub('lifecycle.onSuspend'),             // (handler:Function) => void
            setLanguage: stub('lifecycle.setLanguage')          // (lang:string) => void
        },

        storage: {
            get: stub('storage.get'),       // (key:string) => any
            set: stub('storage.set'),       // (key:string, value:any) => void
            remove: stub('storage.remove')  // (key:string) => void
        },

        log: {
            info: stub('log.info'),     // (msg:string, ...args:any[]) => void
            warn: stub('log.warn'),     // (msg:string, ...args:any[]) => void
            error: stub('log.error')   // (msg:string, err?:Error) => void
        }
    };
})();
