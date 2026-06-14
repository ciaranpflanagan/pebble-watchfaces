'use strict';

var Clay  = require('pebble-clay');
var clay  = new Clay(require('./config.js'), null, { autoHandleEvents: false });

// ---------------------------------------------------------------------------
// Config page — Clay's own build served via unpkg (no hosting required).
// If this URL ever stops working, host the file at:
//   node_modules/pebble-clay/build/index.html
// on any static host (GitHub Pages etc.) and update the URI below.
// ---------------------------------------------------------------------------
var CLAY_URI = 'https://unpkg.com/pebble-clay@1.0.4/build/index.html';

// ---------------------------------------------------------------------------
// Default location (used when geolocation fails / in the emulator).
// Change to your actual coordinates for accurate local weather.
// ---------------------------------------------------------------------------
var DEFAULT_LAT =  47.6062;
var DEFAULT_LON = -122.3321;

var REFRESH_MS = 30 * 60 * 1000;

// ---------------------------------------------------------------------------
// Timezone lookup table + DST rules
// std/dst are UTC offsets in minutes.
// ---------------------------------------------------------------------------
var TIMEZONES = {
  DUB: { label: 'DUBLIN',  std:    0, dst:  60, rule: 'EU' },
  NYC: { label: 'NEW YK',  std: -300, dst: -240, rule: 'US' },
  LAX: { label: 'LA',      std: -480, dst: -420, rule: 'US' },
  CHI: { label: 'CHICAGO', std: -360, dst: -300, rule: 'US' },
  UTC: { label: 'UTC',     std:    0, dst:   0,  rule: 'NONE' },
  PAR: { label: 'PARIS',   std:   60, dst: 120,  rule: 'EU' },
  TYO: { label: 'TOKYO',   std:  540, dst: 540,  rule: 'NONE' },
  SYD: { label: 'SYDNEY',  std:  600, dst: 660,  rule: 'AU' },
  DXB: { label: 'DUBAI',   std:  240, dst: 240,  rule: 'NONE' },
  HKG: { label: 'HK',      std:  480, dst: 480,  rule: 'NONE' }
};

function lastSundayUtc(year, month0, hour) {
  var d = new Date(Date.UTC(year, month0 + 1, 0));   // last day of month
  d.setUTCDate(d.getUTCDate() - d.getUTCDay());       // rewind to Sunday
  d.setUTCHours(hour, 0, 0, 0);
  return d;
}

function nthSundayUtc(year, month0, n) {
  var d = new Date(Date.UTC(year, month0, 1));
  d.setUTCDate(1 + ((7 - d.getUTCDay()) % 7) + (n - 1) * 7);
  return d;
}

function isEuDst(now) {
  var y = now.getUTCFullYear();
  var start = lastSundayUtc(y, 2, 1);    // last Sun Mar @ 01:00 UTC
  var end   = lastSundayUtc(y, 9, 1);    // last Sun Oct @ 01:00 UTC
  return now >= start && now < end;
}

function isUsDst(now) {
  var y = now.getUTCFullYear();
  var m = now.getUTCMonth();
  if (m < 2 || m > 10) return false;
  if (m > 2  && m < 10) return true;
  if (m === 2) {
    var start = nthSundayUtc(y, 2, 2);   // 2nd Sun Mar
    start.setUTCHours(7);                 // 02:00 EST ≈ 07:00 UTC
    return now >= start;
  }
  // m === 10 (November)
  var end = nthSundayUtc(y, 10, 1);      // 1st Sun Nov
  end.setUTCHours(6);
  return now < end;
}

function isAuDst(now) {
  // Sydney: DST Oct→Apr (southern summer)
  var y = now.getUTCFullYear();
  var m = now.getUTCMonth();
  if (m > 3 && m < 9) return false;     // May–Sep: standard
  if (m === 3) {                          // April: ends 1st Sun Apr
    return now < nthSundayUtc(y, 3, 1);
  }
  if (m === 9) {                          // October: starts 1st Sun Oct
    return now >= nthSundayUtc(y, 9, 1);
  }
  return true;                            // Nov, Dec, Jan, Feb, Mar
}

function getTzOffset(key) {
  var tz  = TIMEZONES[key] || TIMEZONES.DUB;
  var now = new Date();
  var dst = false;
  if      (tz.rule === 'EU') dst = isEuDst(now);
  else if (tz.rule === 'US') dst = isUsDst(now);
  else if (tz.rule === 'AU') dst = isAuDst(now);
  return dst ? tz.dst : tz.std;
}

// ---------------------------------------------------------------------------
// Settings — saved in localStorage, applied on ready + after config save
// ---------------------------------------------------------------------------
var DEFAULT_SETTINGS = {
  tzKey:    'DUB',
  tempUnit: 'C',
  theme:    false
};

function loadSettings() {
  try {
    return JSON.parse(localStorage.getItem('consoleSettings')) || DEFAULT_SETTINGS;
  } catch (e) {
    return DEFAULT_SETTINGS;
  }
}

function saveSettings(s) {
  localStorage.setItem('consoleSettings', JSON.stringify(s));
}

function sendSettingsToWatch(s) {
  var tz = TIMEZONES[s.tzKey] || TIMEZONES.DUB;
  Pebble.sendAppMessage({
    SETTINGS_TZ_OFFSET: getTzOffset(s.tzKey),
    SETTINGS_TZ_LABEL:  tz.label,
    SETTINGS_TEMP_UNIT: s.tempUnit === 'F' ? 1 : 0,
    SETTINGS_THEME:     s.theme ? 1 : 0
  }, function() {
    console.log('Settings sent: ' + JSON.stringify(s));
  }, function(e) {
    console.log('Settings send failed: ' + JSON.stringify(e));
  });
}

// ---------------------------------------------------------------------------
// Weather
// ---------------------------------------------------------------------------
function fetchWeather(lat, lon, tempUnit) {
  var unit = tempUnit === 'F' ? 'fahrenheit' : 'celsius';
  var url  = 'https://api.open-meteo.com/v1/forecast' +
             '?latitude='  + lat +
             '&longitude=' + lon +
             '&current=temperature_2m,weather_code' +
             '&temperature_unit=' + unit;

  var xhr = new XMLHttpRequest();
  xhr.onload = function() {
    try {
      var data = JSON.parse(this.responseText);
      var temp = Math.round(data.current.temperature_2m);
      var icon = wmoToIcon(data.current.weather_code);
      Pebble.sendAppMessage(
        { WEATHER_TEMP: temp, WEATHER_ICON: icon },
        function() { console.log('Weather sent: ' + temp + unit[0].toUpperCase() + ' icon=' + icon); },
        function(e) { console.log('Weather send failed: ' + JSON.stringify(e)); }
      );
    } catch (e) {
      console.log('Weather parse error: ' + e);
    }
  };
  xhr.onerror = function() { console.log('Weather fetch failed'); };
  xhr.open('GET', url);
  xhr.send();
}

function refresh(settings) {
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
// Icon mapping
// ---------------------------------------------------------------------------
var ICON_CLEAR = 0, ICON_CLOUDY = 1, ICON_FOG = 2,
    ICON_RAIN  = 3, ICON_SNOW   = 4, ICON_STORM = 5;

function wmoToIcon(code) {
  if (code === 0)  return ICON_CLEAR;
  if (code <= 3)   return ICON_CLOUDY;
  if (code <= 48)  return ICON_FOG;
  if (code <= 67)  return ICON_RAIN;
  if (code <= 77)  return ICON_SNOW;
  if (code <= 82)  return ICON_RAIN;
  if (code <= 86)  return ICON_SNOW;
  return ICON_STORM;
}

// ---------------------------------------------------------------------------
// Pebble events
// ---------------------------------------------------------------------------
Pebble.addEventListener('ready', function() {
  var settings = loadSettings();
  sendSettingsToWatch(settings);
  refresh(settings);
  setInterval(function() { refresh(loadSettings()); }, REFRESH_MS);
});

Pebble.addEventListener('showConfiguration', function() {
  Pebble.openURL(clay.generateUrl(CLAY_URI));
});

Pebble.addEventListener('webviewclosed', function(e) {
  if (!e.response || e.response === 'CANCELLED') return;

  try {
    var claySettings = clay.getSettings(e.response);
    var settings = {
      tzKey:    claySettings.SETTINGS_TZ_KEY    || 'DUB',
      tempUnit: claySettings.SETTINGS_TEMP_UNIT || 'C',
      theme:    !!claySettings.SETTINGS_THEME
    };
    saveSettings(settings);
    sendSettingsToWatch(settings);
    refresh(settings);
  } catch (err) {
    console.log('webviewclosed error: ' + err);
  }
});
