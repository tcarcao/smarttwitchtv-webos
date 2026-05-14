/**
 * UsersPlatform — Twitch OAuth Implicit grant flow.
 *
 * USER MUST PROVIDE: A Twitch Client-ID. Replace TWITCH_APP_CLIENT_ID
 * below with the value Twitch assigns when you register an app at
 * https://dev.twitch.tv/console/apps. Configure two OAuth Redirect URIs
 * at the same place:
 *   - http://localhost:5173/auth-callback.html  (browser dev)
 *   - <webOS deployment URL>                     (production)
 *
 * Without a Client-ID, the URL construction logic still works and is
 * unit-testable, but the real OAuth handshake will fail at Twitch's end.
 */
(function() {
    'use strict';

    if (!window['Platform']) {
        throw new Error('UsersPlatform: Platform must load first');
    }
    var Platform = window['Platform'];

    // === USER CONFIG ===
    var TWITCH_APP_CLIENT_ID = '<REPLACE_ME>';
    var AUTH_STORAGE_KEY = 'auth.user';
    var SCOPES = ['user:read:follows', 'user:read:subscriptions', 'chat:read'];
    // ===================

    var AUTH_BASE = 'https://id.twitch.tv/oauth2/authorize';

    function _redirectUri() {
        var loc = window.location;
        var origin = loc.protocol + '//' + loc.host;
        return origin + '/auth-callback.html';
    }

    function buildAuthUrl() {
        var params = [
            'client_id=' + encodeURIComponent(TWITCH_APP_CLIENT_ID),
            'redirect_uri=' + encodeURIComponent(_redirectUri()),
            'response_type=token',
            'scope=' + encodeURIComponent(SCOPES.join(' ')),
            'force_verify=false'
        ].join('&');
        return AUTH_BASE + '?' + params;
    }

    function startLogin() {
        if (TWITCH_APP_CLIENT_ID === '<REPLACE_ME>') {
            throw new Error('UsersPlatform: TWITCH_APP_CLIENT_ID is unconfigured. See file header.');
        }
        Platform.lifecycle.loadUrl(buildAuthUrl());
    }

    function parseRedirectHash(hash) {
        if (!hash || hash.charAt(0) !== '#') return null;
        var parts = hash.substring(1).split('&');
        var kv = {};
        for (var i = 0; i < parts.length; i++) {
            var eq = parts[i].indexOf('=');
            if (eq > 0) {
                kv[decodeURIComponent(parts[i].substring(0, eq))] = decodeURIComponent(parts[i].substring(eq + 1));
            }
        }
        if (!kv.access_token) return null;
        return {
            token: kv.access_token,
            scopes: kv.scope ? kv.scope.split(' ') : [],
            tokenType: kv.token_type || 'bearer'
        };
    }

    function handleRedirect() {
        var parsed = parseRedirectHash(window.location.hash);
        if (!parsed) {
            return Promise.reject({kind: 'no_token', detail: 'No access_token in URL hash'});
        }
        return Platform.http.request({
            url: 'https://api.twitch.tv/helix/users',
            method: 'GET',
            headers: [
                ['Client-ID', TWITCH_APP_CLIENT_ID],
                ['Authorization', 'Bearer ' + parsed.token]
            ],
            timeoutMs: 8000,
            validate: function(body) {
                return body && body.data && body.data.length;
            }
        }).then(function(res) {
            var user = res.body.data[0];
            var record = {
                token: parsed.token,
                login: user.login,
                displayName: user.display_name,
                userId: user.id,
                scopes: parsed.scopes,
                tokenType: parsed.tokenType,
                obtainedAt: Date.now()
            };
            Platform.storage.set(AUTH_STORAGE_KEY, record);
            return record;
        });
    }

    function getCurrent() {
        return Platform.storage.get(AUTH_STORAGE_KEY);
    }

    function logout() {
        Platform.storage.remove(AUTH_STORAGE_KEY);
    }

    window['UsersPlatform'] = {
        buildAuthUrl: buildAuthUrl,
        startLogin: startLogin,
        parseRedirectHash: parseRedirectHash,
        handleRedirect: handleRedirect,
        getCurrent: getCurrent,
        logout: logout,
        CLIENT_ID: TWITCH_APP_CLIENT_ID
    };
})();
