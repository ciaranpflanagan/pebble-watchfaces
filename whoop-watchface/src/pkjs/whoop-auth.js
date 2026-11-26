'use strict';

// ---------------------------------------------------------------------------
// Whoop OAuth: connecting the watchface to a Whoop account.
//
// Everything here is pure (no network, no storage) so it can be unit tested.
// index.js does the XHRs and keeps the state in localStorage.
//
// The flow (authorisation code grant, client secret sent in the body):
//
//   1. The config page sends the user to AUTHORIZE_URL with our client ID,
//      redirect URI, scopes and a random `state`.
//   2. Whoop redirects to whoop-callback.html with ?code=…&state=…, and that
//      page hands both back to the watchface as the webviewclosed response
//      (see parseCallbackResponse).
//   3. The phone swaps the code for tokens at TOKEN_URL.
//   4. Access tokens last about an hour. The `offline` scope gives a refresh
//      token, and every refresh ROTATES it: the old refresh token stops
//      working, so the new one must be saved before anything else happens.
//
// Docs: https://developer.whoop.com/docs/developing/oauth
// ---------------------------------------------------------------------------

var AUTHORIZE_URL = 'https://api.prod.whoop.com/oauth/oauth2/auth';
var TOKEN_URL     = 'https://api.prod.whoop.com/oauth/oauth2/token';

// read:* cover the three rings (cycles carry strain); offline gives us a
// refresh token so the user only logs in once.
var SCOPES = ['read:recovery', 'read:sleep', 'read:cycles', 'offline'];

// Whoop requires a self-generated state to be eight characters long.
var STATE_LENGTH = 8;
var STATE_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

// Refresh this long before the access token actually expires, so a request
// never goes out with a token that dies mid-flight.
var REFRESH_MARGIN_MS = 5 * 60 * 1000;

// Marks the webviewclosed response from whoop-callback.html, so index.js can
// tell it apart from a Clay settings save. Keep in step with the callback page.
var CALLBACK_MARKER = 'whoopAuth';

/**
 * A random state value for one connection attempt.
 *
 * The state guards against a forged callback: the phone only accepts a code
 * whose state matches the one it generated. PebbleKit JS has no guaranteed
 * crypto.getRandomValues, so this falls back to Math.random. That is weak
 * randomness, but the state only has to be unguessable for the few minutes a
 * login takes, and the code is useless without our client secret anyway.
 *
 * @param {function(): number} [random] - returns [0, 1); injectable for tests
 * @return {string}
 */
function generateState(random) {
  var next = random || Math.random;
  var state = '';
  for (var i = 0; i < STATE_LENGTH; i++) {
    state += STATE_ALPHABET.charAt(Math.floor(next() * STATE_ALPHABET.length));
  }
  return state;
}

/** application/x-www-form-urlencoded, the standard body for OAuth token calls. */
function formEncode(fields) {
  return Object.keys(fields).map(function(key) {
    return encodeURIComponent(key) + '=' + encodeURIComponent(fields[key]);
  }).join('&');
}

function requireString(value, name, where) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(where + ': ' + name + ' is missing or empty');
  }
  return value.trim();
}

/**
 * The Whoop login URL for one connection attempt.
 *
 * @param {{clientId: string, redirectUri: string, state: string}} options
 * @return {string}
 */
function buildAuthorizeUrl(options) {
  var where = 'buildAuthorizeUrl';
  return AUTHORIZE_URL + '?' + formEncode({
    response_type: 'code',
    client_id:     requireString(options.clientId, 'clientId', where),
    redirect_uri:  requireString(options.redirectUri, 'redirectUri', where),
    scope:         SCOPES.join(' '),
    state:         requireString(options.state, 'state', where)
  });
}

/**
 * The token request body that swaps a login code for tokens. redirectUri
 * must be exactly the one the login used, or Whoop rejects the code.
 */
function buildCodeExchangeBody(options) {
  var where = 'buildCodeExchangeBody';
  return formEncode({
    grant_type:    'authorization_code',
    code:          requireString(options.code, 'code', where),
    client_id:     requireString(options.clientId, 'clientId', where),
    client_secret: requireString(options.clientSecret, 'clientSecret', where),
    redirect_uri:  requireString(options.redirectUri, 'redirectUri', where)
  });
}

/** The token request body that trades a refresh token for new tokens. */
function buildRefreshBody(options) {
  var where = 'buildRefreshBody';
  return formEncode({
    grant_type:    'refresh_token',
    refresh_token: requireString(options.refreshToken, 'refreshToken', where),
    client_id:     requireString(options.clientId, 'clientId', where),
    client_secret: requireString(options.clientSecret, 'clientSecret', where),
    scope:         'offline'
  });
}

/**
 * Interprets a token endpoint reply.
 *
 * Returns a discriminated result:
 *   { ok: true,  tokens: { accessToken, refreshToken, expiresAt } }
 *   { ok: false, kind: 'rejected',  message }  the grant is dead: reconnect
 *   { ok: false, kind: 'temporary', message }  network/server trouble: retry
 *   { ok: false, kind: 'malformed', message }  a 2xx we could not understand
 *
 * refreshToken is null when Whoop sent none; the caller decides whether to
 * keep the previous one.
 *
 * @param {number} status - HTTP status (0 when the request never completed)
 * @param {string} bodyText
 * @param {Date} now
 */
function parseTokenResponse(status, bodyText, now) {
  var body = null;
  try {
    body = bodyText ? JSON.parse(bodyText) : null;
  } catch (e) {
    body = null;
  }

  if (status >= 200 && status < 300) {
    if (!body || typeof body.access_token !== 'string' || !body.access_token) {
      return { ok: false, kind: 'malformed',
               message: 'Token response (HTTP ' + status + ') had no access_token' };
    }
    var lifetimeSeconds = typeof body.expires_in === 'number' && body.expires_in > 0
      ? body.expires_in : 3600;   // Whoop documents 3600; assume it if absent
    return {
      ok: true,
      tokens: {
        accessToken:  body.access_token,
        refreshToken: typeof body.refresh_token === 'string' && body.refresh_token
                        ? body.refresh_token : null,
        expiresAt:    now.getTime() + lifetimeSeconds * 1000
      }
    };
  }

  var detail = body && (body.error_description || body.error)
    ? ' (' + (body.error_description || body.error) + ')' : '';

  // 400/401 mean Whoop understood us and said no: a used, expired or revoked
  // grant, or wrong client credentials. Retrying will not help.
  if (status === 400 || status === 401) {
    return { ok: false, kind: 'rejected',
             message: 'Whoop rejected the token request: HTTP ' + status + detail };
  }
  return { ok: false, kind: 'temporary',
           message: status === 0
             ? 'Token request failed: no response (offline?)'
             : 'Token request failed: HTTP ' + status + detail };
}

/** True when the access token is missing or within REFRESH_MARGIN_MS of expiry. */
function needsRefresh(tokens, now) {
  if (!tokens || !tokens.accessToken || typeof tokens.expiresAt !== 'number') return true;
  return now.getTime() >= tokens.expiresAt - REFRESH_MARGIN_MS;
}

/**
 * Reads a webviewclosed response and, if it came from whoop-callback.html,
 * returns { code, state, error }. Returns null for anything else (e.g. a Clay
 * settings save), so the caller can fall through to Clay.
 *
 * Like Clay, the response may arrive URI-encoded or as raw JSON.
 */
function parseCallbackResponse(response) {
  if (typeof response !== 'string' || !response) return null;
  var parsed;
  try {
    parsed = JSON.parse(/^\{/.test(response) ? response : decodeURIComponent(response));
  } catch (e) {
    return null;
  }
  var payload = parsed && parsed[CALLBACK_MARKER];
  if (!payload || typeof payload !== 'object') return null;
  return {
    code:  typeof payload.code === 'string' ? payload.code : '',
    state: typeof payload.state === 'string' ? payload.state : '',
    error: typeof payload.error === 'string' ? payload.error : ''
  };
}

/**
 * Checks a callback against the state we sent. Returns
 *   { ok: true, code }  or  { ok: false, message }.
 */
function validateCallback(callback, expectedState) {
  if (!callback) {
    return { ok: false, message: 'No Whoop callback data' };
  }
  if (callback.error) {
    // e.g. access_denied when the user taps Cancel on Whoop's consent screen
    return { ok: false, message: 'Whoop login did not complete: ' + callback.error };
  }
  if (!expectedState) {
    return { ok: false, message: 'Got a Whoop callback with no connection in progress' };
  }
  if (callback.state !== expectedState) {
    return { ok: false, message: 'Whoop callback state did not match; ignoring it' };
  }
  if (!callback.code) {
    return { ok: false, message: 'Whoop callback had no code' };
  }
  return { ok: true, code: callback.code };
}

/**
 * The one-line connection status shown on the config page.
 *
 * @param {{clientId?: string, clientSecret?: string, refreshToken?: string,
 *          lastError?: string}} auth
 */
function statusText(auth) {
  var a = auth || {};
  if (a.refreshToken) return 'Connected to Whoop.';
  if (a.lastError) return 'Not connected: ' + a.lastError;
  if (!a.clientId || !a.clientSecret) {
    return 'Enter your client ID and secret, then Save.';
  }
  return 'Not connected yet. Tap Connect to log in to Whoop.';
}

module.exports = {
  AUTHORIZE_URL: AUTHORIZE_URL,
  TOKEN_URL: TOKEN_URL,
  SCOPES: SCOPES,
  STATE_LENGTH: STATE_LENGTH,
  REFRESH_MARGIN_MS: REFRESH_MARGIN_MS,
  CALLBACK_MARKER: CALLBACK_MARKER,
  generateState: generateState,
  buildAuthorizeUrl: buildAuthorizeUrl,
  buildCodeExchangeBody: buildCodeExchangeBody,
  buildRefreshBody: buildRefreshBody,
  parseTokenResponse: parseTokenResponse,
  needsRefresh: needsRefresh,
  parseCallbackResponse: parseCallbackResponse,
  validateCallback: validateCallback,
  statusText: statusText
};
