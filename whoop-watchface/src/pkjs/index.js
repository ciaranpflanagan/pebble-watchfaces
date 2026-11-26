'use strict';

var Clay      = require('pebble-clay');
var accent    = require('./accent.js');
var config    = require('./config.js');
var emulatorConfig = require('./emulator-config.js');
var weather   = require('./weather.js');
var whoop     = require('./whoop.js');
var whoopAuth = require('./whoop-auth.js');
var clay      = new Clay(config.items, config.customFn, { autoHandleEvents: false });

// ---------------------------------------------------------------------------
// Config page in the emulator: the emulator serves the page itself from a
// data: URI (see emulator-config.js). `build.sh --prod` flips this off.
// ---------------------------------------------------------------------------
var IS_EMULATOR = true;

// Phase 1: the face shows a fixed sample snapshot until the Whoop API is wired
// up. Set to false once real data is available.
var USE_MOCK_WHOOP = true;

// Where Whoop's login sends the user back to. It must exactly match a redirect
// URL registered on the Whoop developer app.
//   - Emulator: served by `python3 -m http.server 8888` (see the README).
//   - Phone: needs whoop-callback.html hosted on https. Not set up yet, so
//     Connect is unavailable on a real phone until this is filled in.
var WHOOP_REDIRECT_URI_EMULATOR = 'http://localhost:8888/whoop-callback.html';
var WHOOP_REDIRECT_URI_PHONE    = null;

// Used when geolocation fails or is unavailable.
var DEFAULT_LAT =  47.6062;
var DEFAULT_LON = -122.3321;

var WEATHER_REFRESH_MS = 30 * 60 * 1000;
var WHOOP_REFRESH_MS   = 15 * 60 * 1000;

// ---------------------------------------------------------------------------
// Settings — saved in localStorage, applied on ready and after config save
// ---------------------------------------------------------------------------
var SETTINGS_STORAGE_KEY = 'triadSettings';

var DEFAULT_SETTINGS = {
  tempUnit: 'C',
  theme:    false,
  accent:   accent.DEFAULT_ACCENT
};

function normaliseSettings(raw) {
  if (!raw) return DEFAULT_SETTINGS;
  return {
    tempUnit: raw.tempUnit === 'F' ? 'F' : 'C',
    theme:    !!raw.theme,
    accent:   accent.resolveAccent(raw.accent)
  };
}

function loadSettings() {
  try {
    return normaliseSettings(JSON.parse(localStorage.getItem(SETTINGS_STORAGE_KEY)));
  } catch (e) {
    console.log('Could not read stored settings (' + e + '), using defaults');
    return DEFAULT_SETTINGS;
  }
}

function saveSettings(settings) {
  try {
    localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(settings));
  } catch (e) {
    console.log('Could not persist settings: ' + e);
  }
}

// ---------------------------------------------------------------------------
// AppMessage. Pebble drops a message sent while another is in flight, so
// everything goes through one queue.
// ---------------------------------------------------------------------------
var outbox = [];
var sending = false;

function send(payload, label) {
  outbox.push({ payload: payload, label: label });
  drain();
}

function drain() {
  if (sending || !outbox.length) return;
  var next = outbox.shift();
  sending = true;
  Pebble.sendAppMessage(next.payload, function() {
    console.log(next.label + ' sent');
    sending = false;
    drain();
  }, function(e) {
    console.log(next.label + ' send failed: ' + JSON.stringify(e));
    sending = false;
    drain();
  });
}

function sendSettings(settings) {
  send({
    SETTINGS_TEMP_UNIT: settings.tempUnit === 'F' ? 1 : 0,
    SETTINGS_THEME:     settings.theme ? 1 : 0,
    SETTINGS_ACCENT:    accent.resolveAccent(settings.accent)
  }, 'Settings');
}

// ---------------------------------------------------------------------------
// Weather
// ---------------------------------------------------------------------------
function fetchWeather(lat, lon, tempUnit) {
  var xhr = new XMLHttpRequest();
  xhr.onload = function() {
    try {
      var payload = weather.toWatchPayload(JSON.parse(this.responseText));
      if (payload) send(payload, 'Weather');
      else console.log('Weather response had no current temperature');
    } catch (e) {
      console.log('Weather parse error: ' + e);
    }
  };
  xhr.onerror = function() { console.log('Weather fetch failed'); };
  xhr.open('GET', weather.buildUrl(lat, lon, tempUnit));
  xhr.send();
}

function refreshWeather(settings) {
  var unit = (settings || loadSettings()).tempUnit;
  navigator.geolocation.getCurrentPosition(
    function(pos) { fetchWeather(pos.coords.latitude, pos.coords.longitude, unit); },
    function(e)   {
      console.log('Geolocation failed (' + e.message + '), using default location');
      fetchWeather(DEFAULT_LAT, DEFAULT_LON, unit);
    },
    { timeout: 10000, maximumAge: 300000 }
  );
}

// ---------------------------------------------------------------------------
// Whoop connection (OAuth). The pure parts live in whoop-auth.js.
//
// Stored on the phone under WHOOP_AUTH_STORAGE_KEY:
//   {
//     clientId, clientSecret      from the config page
//     accessToken, expiresAt      current access token, expiry in epoch ms
//     refreshToken                rotates on every refresh
//     pendingState                state of the login in progress, if any
//     pendingRedirectUri          redirect URI that login used
//     lastError                   short reason shown on the config page
//   }
// ---------------------------------------------------------------------------
var WHOOP_AUTH_STORAGE_KEY = 'triadWhoopAuth';
var TOKEN_REQUEST_TIMEOUT_MS = 15000;

function loadWhoopAuth() {
  try {
    var stored = JSON.parse(localStorage.getItem(WHOOP_AUTH_STORAGE_KEY));
    return stored && typeof stored === 'object' ? stored : {};
  } catch (e) {
    // Only the error's name: V8's JSON.parse messages quote the start of the
    // bad input, which here would be the stored client secret or tokens.
    console.log('Could not read stored Whoop connection (' + (e && e.name) + '), treating as not connected');
    return {};
  }
}

function saveWhoopAuth(auth) {
  try {
    localStorage.setItem(WHOOP_AUTH_STORAGE_KEY, JSON.stringify(auth));
  } catch (e) {
    // Losing a rotated refresh token means reconnecting, so make it loud.
    console.log('ERROR: could not save the Whoop connection, a reconnect may be needed: ' + e);
  }
}

function clearWhoopTokens(auth) {
  delete auth.accessToken;
  delete auth.refreshToken;
  delete auth.expiresAt;
}

function whoopRedirectUri() {
  return IS_EMULATOR ? WHOOP_REDIRECT_URI_EMULATOR : WHOOP_REDIRECT_URI_PHONE;
}

/** POSTs a form body to Whoop's token endpoint; done gets parseTokenResponse's result. */
function requestWhoopToken(body, label, done) {
  var finished = false;
  function finish(status, text) {
    if (finished) return;   // onerror and ontimeout can both fire
    finished = true;
    done(whoopAuth.parseTokenResponse(status, text, new Date()));
  }

  var xhr = new XMLHttpRequest();
  xhr.onload    = function() { finish(this.status, this.responseText); };
  xhr.onerror   = function() { console.log('Whoop ' + label + ': network error'); finish(0, ''); };
  xhr.ontimeout = function() { console.log('Whoop ' + label + ': timed out'); finish(0, ''); };
  xhr.open('POST', whoopAuth.TOKEN_URL);
  xhr.setRequestHeader('Content-Type', 'application/x-www-form-urlencoded');
  try {
    xhr.timeout = TOKEN_REQUEST_TIMEOUT_MS;
  } catch (e) {
    console.log('XHR timeout not supported here; relying on the platform default');
  }
  xhr.send(body);
}

/**
 * Stores a token result. Returns true if we now hold a working token.
 * On 'rejected' the grant is dead, so the tokens are dropped and the config
 * page asks the user to reconnect.
 */
function applyWhoopTokenResult(result, label) {
  var auth = loadWhoopAuth();
  if (result.ok) {
    auth.accessToken  = result.tokens.accessToken;
    // Rotation: always prefer the new refresh token. Keep the old one only if
    // Whoop sent none, which shouldn't happen with the offline scope.
    auth.refreshToken = result.tokens.refreshToken || auth.refreshToken;
    auth.expiresAt    = result.tokens.expiresAt;
    delete auth.lastError;
    saveWhoopAuth(auth);
    console.log('Whoop ' + label + ' OK; access token valid until ' +
                new Date(auth.expiresAt).toISOString() +
                (auth.refreshToken ? '' : ' (WARNING: no refresh token)'));
    return true;
  }

  console.log('Whoop ' + label + ' failed [' + result.kind + ']: ' + result.message);
  if (result.kind === 'rejected') {
    clearWhoopTokens(auth);
    auth.lastError = 'Whoop rejected the connection. Check your client ID and secret, then reconnect.';
    saveWhoopAuth(auth);
  } else if (!auth.refreshToken) {
    // A failed first connection: tell the user. A failed refresh with a
    // refresh token still in hand just retries on the next poll.
    auth.lastError = 'Could not reach Whoop. Try connecting again.';
    saveWhoopAuth(auth);
  }
  return false;
}

/** Handles whoop-callback.html's response: checks state, swaps code for tokens. */
function handleWhoopCallback(callback) {
  var auth = loadWhoopAuth();
  var expectedState = auth.pendingState;
  var redirectUri = auth.pendingRedirectUri;
  // A state is good for one attempt only, whatever happens next.
  delete auth.pendingState;
  delete auth.pendingRedirectUri;

  var check = whoopAuth.validateCallback(callback, expectedState);
  if (!check.ok) {
    console.log('Whoop callback ignored: ' + check.message);
    if (callback.error) auth.lastError = 'Whoop login was cancelled or failed.';
    saveWhoopAuth(auth);
    return;
  }
  saveWhoopAuth(auth);

  var body;
  try {
    body = whoopAuth.buildCodeExchangeBody({
      code: check.code, clientId: auth.clientId,
      clientSecret: auth.clientSecret, redirectUri: redirectUri
    });
  } catch (e) {
    console.log('Whoop code exchange not sent: ' + e.message);
    auth.lastError = 'Client ID or secret missing. Save them, then reconnect.';
    saveWhoopAuth(auth);
    return;
  }

  requestWhoopToken(body, 'code exchange', function(result) {
    if (applyWhoopTokenResult(result, 'code exchange')) refreshWhoop();
  });
}

/**
 * Saves the client ID and secret from a config save. Changing either means a
 * different (or fixed) Whoop app, whose tokens the old ones aren't, so the
 * connection is dropped and the user reconnects.
 */
function saveWhoopCredentials(clientId, clientSecret) {
  var auth = loadWhoopAuth();
  var id = typeof clientId === 'string' ? clientId.trim() : '';
  var secret = typeof clientSecret === 'string' ? clientSecret.trim() : '';
  if (id === (auth.clientId || '') && secret === (auth.clientSecret || '')) return;

  auth.clientId = id;
  auth.clientSecret = secret;
  if (auth.refreshToken) console.log('Whoop credentials changed; disconnecting');
  clearWhoopTokens(auth);
  delete auth.lastError;
  saveWhoopAuth(auth);
}

// Callbacks waiting on a refresh. Refresh tokens rotate, so two refreshes at
// once would leave one holding a dead token: the first caller starts the
// refresh and the rest queue behind it.
var refreshWaiters = [];

/** done(error, accessToken): a valid access token, refreshing it first if needed. */
function withWhoopAccessToken(done) {
  var auth = loadWhoopAuth();
  if (!auth.refreshToken) {
    done(new Error('Not connected to Whoop'));
    return;
  }
  if (!whoopAuth.needsRefresh(auth, new Date())) {
    done(null, auth.accessToken);
    return;
  }

  refreshWaiters.push(done);
  if (refreshWaiters.length > 1) return;

  var body;
  try {
    body = whoopAuth.buildRefreshBody({
      refreshToken: auth.refreshToken, clientId: auth.clientId, clientSecret: auth.clientSecret
    });
  } catch (e) {
    console.log('Whoop refresh not sent: ' + e.message);
    flushRefreshWaiters(new Error('Whoop refresh not sent: ' + e.message));
    return;
  }

  requestWhoopToken(body, 'token refresh', function(result) {
    if (applyWhoopTokenResult(result, 'token refresh')) {
      flushRefreshWaiters(null, loadWhoopAuth().accessToken);
    } else {
      flushRefreshWaiters(new Error('Whoop token refresh failed: ' + result.message));
    }
  });
}

function flushRefreshWaiters(error, accessToken) {
  var waiters = refreshWaiters;
  refreshWaiters = [];
  waiters.forEach(function(waiter) { waiter(error, accessToken); });
}

/** What the config page needs to show the Whoop section (see config.js). */
function whoopConfigPageData() {
  var auth = loadWhoopAuth();
  var redirectUri = whoopRedirectUri();
  var data = {
    status: whoopAuth.statusText(auth),
    authorizeUrl: null,
    connected: !!auth.refreshToken
  };

  if (!auth.clientId || !auth.clientSecret) return data;
  if (!redirectUri) {
    data.status = 'Connecting on a phone needs the hosted callback page, which is not set up yet.';
    return data;
  }

  // A fresh state for every opening of the config page.
  auth.pendingState = whoopAuth.generateState();
  auth.pendingRedirectUri = redirectUri;
  saveWhoopAuth(auth);
  data.authorizeUrl = whoopAuth.buildAuthorizeUrl({
    clientId: auth.clientId, redirectUri: redirectUri, state: auth.pendingState
  });
  return data;
}

// ---------------------------------------------------------------------------
// Whoop data
// ---------------------------------------------------------------------------
function refreshWhoop() {
  // Phase 2: keep the connection alive (refreshing the token when due) so it
  // can be tested before phase 3 fetches real data with it.
  withWhoopAccessToken(function(error) {
    if (error) console.log('Whoop: ' + error.message);
    else console.log('Whoop: access token ready');
  });

  if (USE_MOCK_WHOOP) {
    send(whoop.toWatchPayload(whoop.mockSnapshot(new Date())), 'Whoop (mock)');
  }
  // Phase 3: fetch the latest cycle, recovery and sleep with the access token.
}

// ---------------------------------------------------------------------------
// Pebble events
// ---------------------------------------------------------------------------
Pebble.addEventListener('ready', function() {
  var settings = loadSettings();
  sendSettings(settings);
  refreshWeather(settings);
  refreshWhoop();

  setInterval(function() { refreshWeather(); }, WEATHER_REFRESH_MS);
  setInterval(refreshWhoop, WHOOP_REFRESH_MS);
});

Pebble.addEventListener('showConfiguration', function() {
  // autoHandleEvents is off, so Clay's meta is ours to fill. The page reads it
  // as clayConfig.meta.userData (see config.js).
  try {
    clay.meta.userData = { whoop: whoopConfigPageData() };
  } catch (e) {
    console.log('Could not prepare the Whoop section of the config page: ' + e);
    clay.meta.userData = { whoop: { status: 'Whoop connection unavailable: ' + e.message } };
  }

  var generated = clay.generateUrl();
  if (IS_EMULATOR) {
    try {
      Pebble.openURL(emulatorConfig.toDataUri(generated));
    } catch (err) {
      console.log('Could not open the config page in the emulator: ' + err.message);
    }
  } else {
    Pebble.openURL(generated);
  }
});

Pebble.addEventListener('webviewclosed', function(e) {
  if (!e.response || e.response === 'CANCELLED') return;

  // whoop-callback.html returns here too, after a Whoop login.
  var callback = whoopAuth.parseCallbackResponse(e.response);
  if (callback) {
    handleWhoopCallback(callback);
    return;
  }

  try {
    // false: string-keyed objects with .value, not the AppMessage format.
    var c = clay.getSettings(e.response, false);
    var settings = normaliseSettings({
      tempUnit: c.SETTINGS_TEMP_UNIT && c.SETTINGS_TEMP_UNIT.value,
      theme:    c.SETTINGS_THEME && c.SETTINGS_THEME.value,
      accent:   c.SETTINGS_ACCENT && c.SETTINGS_ACCENT.value
    });
    saveSettings(settings);
    sendSettings(settings);
    refreshWeather(settings);
    saveWhoopCredentials(c.WHOOP_CLIENT_ID && c.WHOOP_CLIENT_ID.value,
                         c.WHOOP_CLIENT_SECRET && c.WHOOP_CLIENT_SECRET.value);
  } catch (err) {
    console.log('webviewclosed error: ' + err);
  }
});
