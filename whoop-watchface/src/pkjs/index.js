'use strict';

var Clay    = require('pebble-clay');
var accent  = require('./accent.js');
var weather = require('./weather.js');
var whoop   = require('./whoop.js');
var clay    = new Clay(require('./config.js'), null, { autoHandleEvents: false });

// ---------------------------------------------------------------------------
// Config page in the emulator: see the README. Chrome blocks Clay's public
// page from redirecting to localhost, so in the emulator the page is served
// from localhost by clay-proxy.html instead. `build.sh --prod` flips this off.
// ---------------------------------------------------------------------------
var LOCAL_CLAY_URI = 'http://localhost:8888/clay-proxy.html';
var IS_EMULATOR = true;

// Phase 1: the face shows a fixed sample snapshot until the Whoop API is wired
// up. Set to false once real data is available.
var USE_MOCK_WHOOP = true;

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
// Whoop
// ---------------------------------------------------------------------------
function refreshWhoop() {
  if (USE_MOCK_WHOOP) {
    send(whoop.toWatchPayload(whoop.mockSnapshot(new Date())), 'Whoop (mock)');
  }
  // Phases 2–3: fetch the latest cycle, recovery and sleep from the Whoop API.
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
  var generated = clay.generateUrl();
  if (IS_EMULATOR) {
    Pebble.openURL(LOCAL_CLAY_URI + generated.substring(generated.indexOf('#')));
  } else {
    Pebble.openURL(generated);
  }
});

Pebble.addEventListener('webviewclosed', function(e) {
  if (!e.response || e.response === 'CANCELLED') return;

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
  } catch (err) {
    console.log('webviewclosed error: ' + err);
  }
});
