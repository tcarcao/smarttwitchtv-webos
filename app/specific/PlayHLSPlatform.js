/**
 * PlayHLSPlatform — Twitch live stream playback via Platform.http + Platform.player.
 *
 * This module is the v1.6 reference implementation. It is NOT a refactor
 * of upstream's app/specific/PlayHLS.js — that file is left untouched for
 * now (the seeded upstream still works via shim+fallback). When the
 * upstream-sync workflow later refactors PlayHLS.js to use Platform.X
 * directly, this module's logic moves into it.
 *
 * Twitch flow:
 *   1. GQL PlaybackAccessToken (anonymous, public web Client-ID) for the channel.
 *   2. Build usher.ttvnw.net URL with sig+token+params.
 *   3. Fetch the HLS multivariant manifest from usher.
 *   4. Optionally preprocess (drop variants, reorder); v1.6 skips that — pass through.
 *   5. player.start({uri, manifestString, kind:'live'}) via Platform.
 */
(function() {
    'use strict';

    if (!window['Platform']) {
        throw new Error('PlayHLSPlatform: Platform must load first');
    }
    var Platform = window['Platform'];

    var TWITCH_CLIENT_ID = 'kimne78kx3ncx6brgo4mv6wki5h1ko';
    var GQL_URL = 'https://gql.twitch.tv/gql';

    function _fetchPlaybackAccessToken(channelLogin) {
        var persistedPayload = {
            operationName: 'PlaybackAccessToken_Template',
            query: 'query PlaybackAccessToken_Template($login: String!, $isLive: Boolean!, $vodID: ID!, $isVod: Boolean!, $playerType: String!) {  streamPlaybackAccessToken(channelName: $login, params: {platform: "web", playerBackend: "mediaplayer", playerType: $playerType}) @include(if: $isLive) {value signature __typename}  videoPlaybackAccessToken(id: $vodID, params: {platform: "web", playerBackend: "mediaplayer", playerType: $playerType}) @include(if: $isVod) {value signature __typename}}',
            variables: {
                login: channelLogin,
                isLive: true,
                vodID: '',
                isVod: false,
                playerType: 'site'
            }
        };

        return Platform.http.request({
            url: GQL_URL,
            method: 'POST',
            headers: [['Client-ID', TWITCH_CLIENT_ID], ['Content-Type', 'application/json']],
            body: JSON.stringify(persistedPayload),
            timeoutMs: 8000,
            validate: function(body) {
                return body && body.data && body.data.streamPlaybackAccessToken
                    && body.data.streamPlaybackAccessToken.value
                    && body.data.streamPlaybackAccessToken.signature;
            }
        }).then(function(res) {
            return res.body.data.streamPlaybackAccessToken;
        });
    }

    function _supportedCodecsParam() {
        var codecs = [];
        try {
            var ms = window.MediaSource;
            if (ms && ms.isTypeSupported('video/mp4; codecs="av01.0.08M.08"')) codecs.push('av1');
            if (ms && ms.isTypeSupported('video/mp4; codecs="hvc1.1.6.L153.B0"')) codecs.push('h265');
        } catch (e) { /* a probe failure must never block playback */ }
        codecs.push('h264');
        return codecs.join(',');
    }

    function _buildUsherUrl(channelLogin, token) {
        var sessionId = Math.floor(Math.random() * 1e16);
        // Parameter set mirrors upstream Play_base_live_links
        // (app/specific/PlayHLS.js): mediaplayer backend + framerate info
        // in variant names + fast_bread=false (Twitch's low-latency
        // prefetch tags are proprietary; hls.js ignores them anyway).
        var params = [
            'client_id=' + encodeURIComponent(TWITCH_CLIENT_ID),
            'token=' + encodeURIComponent(token.value),
            'sig=' + encodeURIComponent(token.signature),
            'player_backend=mediaplayer',
            'reassignments_supported=true',
            'playlist_include_framerate=true',
            'allow_source=true',
            'fast_bread=false',
            'supported_codecs=' + _supportedCodecsParam(),
            'p=' + Math.floor(Math.random() * 999999),
            'play_session_id=' + sessionId + '' + sessionId
        ].join('&');
        return 'https://usher.ttvnw.net/api/channel/hls/' + encodeURIComponent(channelLogin.toLowerCase()) + '.m3u8?' + params;
    }

    function _fetchManifest(usherUrl) {
        return Platform.http.request({
            url: usherUrl,
            method: 'GET',
            timeoutMs: 8000,
            validate: function(body) {
                return typeof body === 'string' && body.indexOf('#EXTM3U') === 0;
            }
        }).then(function(res) {
            return res.body;
        });
    }

    /**
     * Play a live Twitch channel by login name (e.g. 'zackrawrr').
     * @param {string} channelLogin
     * @returns {Promise<void>}
     */
    function playLiveChannel(channelLogin) {
        if (!channelLogin || typeof channelLogin !== 'string') {
            return Promise.reject({kind: 'invalid_args', detail: 'channelLogin required (string)'});
        }
        var login = channelLogin.toLowerCase();

        return _fetchPlaybackAccessToken(login)
            .then(function(token) {
                var usherUrl = _buildUsherUrl(login, token);
                return _fetchManifest(usherUrl).then(function(manifestString) {
                    Platform.player.start({
                        uri: usherUrl,
                        manifestString: manifestString,
                        kind: 'live',
                        rect: {fullscreen: false}
                    });
                });
            });
    }

    function stop() {
        Platform.player.stop();
    }

    window['PlayHLSPlatform'] = {
        playLiveChannel: playLiveChannel,
        stop: stop,
        // Test seam (app/tests/player-hls.html asserts the parameter set).
        _buildUsherUrl: _buildUsherUrl
    };
})();
