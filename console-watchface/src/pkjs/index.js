'use strict';

var Clay          = require('pebble-clay');
var timezones     = require('./timezones.js');
var complications = require('./complications.js');
var clayCustomFn  = require('./clay-custom.js');
var clay          = new Clay(require('./config.js'), clayCustomFn, { autoHandleEvents: false });

// ---------------------------------------------------------------------------
// Config page.
// Clay 1.0.4 always generates a clay.pebble.com S3 base URL and ignores any
// URI passed to generateUrl(). In the emulator, Chrome then blocks the save
// redirect (public page → localhost) under Private Network Access rules.
//
// Fix: let Clay generate its URL, strip the S3 base, and prepend a local
// server instead. Both the page origin and return_to become localhost, which
// Chrome permits (local → local is fine).
//
// Before running `pebble emu-app-config`, serve the project root in a separate
// terminal so clay-proxy.html is reachable:
//   python3 -m http.server 8888 --directory .
//
// clay-proxy.html rebuilds the config page from the URL hash and needs no other
// files served alongside it.
//
// On a real phone this proxy is unused entirely — see IS_EMULATOR below.
// ---------------------------------------------------------------------------
var LOCAL_CLAY_URI = 'http://localhost:8888/clay-proxy.html';

// Set to false before publishing to the Rebble store.
// On a real phone the Pebble app's WebView handles pebblejs:// natively so
// the S3 URL Clay generates works fine. The proxy is only needed in the
// emulator where Chrome blocks public-page → localhost redirects (PNA).
var IS_EMULATOR = true;

// ---------------------------------------------------------------------------
// Default location (used when geolocation fails / in the emulator).
// Change to your actual coordinates for accurate local weather.
// ---------------------------------------------------------------------------
var DEFAULT_LAT =  47.6062;
var DEFAULT_LON = -122.3321;

var REFRESH_MS = 30 * 60 * 1000;

// ---------------------------------------------------------------------------
// Settings — saved in localStorage, applied on ready + after config save
// ---------------------------------------------------------------------------
var SETTINGS_STORAGE_KEY = 'consoleSettings';

var DEFAULT_SETTINGS = {
  complication: complications.DEFAULT_COMPLICATION,
  zone:         timezones.DEFAULT_ZONE,
  tzLabel:      '',                    // blank means "use the built-in label"
  tempUnit:     'C',
  theme:        false
};

/**
 * Bring a settings object read from storage up to the current shape. Older
 * builds stored a three-letter `tzKey`, had no custom label, and had no
 * complication picker — those upgrade to the second timezone, so an existing
 * install looks unchanged after the update.
 */
function migrateSettings(stored) {
  if (!stored) return DEFAULT_SETTINGS;

  return {
    complication: complications.resolveComplication(stored.complication),
    zone:         timezones.resolveZone(stored.zone || stored.tzKey),
    tzLabel:      timezones.normaliseLabel(stored.tzLabel),
    tempUnit:     stored.tempUnit === 'F' ? 'F' : 'C',
    theme:        !!stored.theme
  };
}

/**
 * The label the watch should print on the bottom row. A custom label always
 * wins; otherwise the second timezone uses its city name and every other
 * complication its built-in label.
 */
function resolveFooterLabel(settings) {
  var custom = timezones.normaliseLabel(settings.tzLabel);
  if (custom) return custom;

  return complications.isTimezone(settings.complication)
    ? timezones.labelForZone(settings.zone)
    : complications.defaultLabel(settings.complication);
}

function loadSettings() {
  try {
    return migrateSettings(JSON.parse(localStorage.getItem(SETTINGS_STORAGE_KEY)));
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

function sendSettingsToWatch(settings) {
  // The timezone offset goes over even when the bottom row is showing
  // something else, so switching back to it is instant rather than waiting on
  // the next config save.
  Pebble.sendAppMessage({
    SETTINGS_COMPLICATION: complications.toValue(settings.complication),
    SETTINGS_TZ_OFFSET:    timezones.getOffsetMinutes(settings.zone),
    SETTINGS_TZ_LABEL:     resolveFooterLabel(settings),
    SETTINGS_TEMP_UNIT:    settings.tempUnit === 'F' ? 1 : 0,
    SETTINGS_THEME:        settings.theme ? 1 : 0
  }, function() {
    console.log('Settings sent: ' + JSON.stringify(settings));
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

  // The watch stores a fixed UTC offset, so it cannot notice a DST changeover
  // on its own. Re-sending the settings on every refresh keeps the second
  // timezone correct within REFRESH_MS of the changeover.
  setInterval(function() {
    var current = loadSettings();
    sendSettingsToWatch(current);
    refresh(current);
  }, REFRESH_MS);
});

Pebble.addEventListener('showConfiguration', function() {
  var generated = clay.generateUrl();
  if (IS_EMULATOR) {
    var fragment = generated.substring(generated.indexOf('#'));
    Pebble.openURL(LOCAL_CLAY_URI + fragment);
  } else {
    Pebble.openURL(generated);
  }
});

Pebble.addEventListener('webviewclosed', function(e) {
  if (!e.response || e.response === 'CANCELLED') return;

  try {
    // Pass false so getSettings returns raw string-keyed objects with .value
    // properties, instead of the numeric-keyed AppMessage-ready format.
    var claySettings = clay.getSettings(e.response, false);
    var settings = {
      complication: complications.resolveComplication(
                      claySettings.SETTINGS_COMPLICATION &&
                      claySettings.SETTINGS_COMPLICATION.value),
      zone:         timezones.resolveZone(
                      claySettings.SETTINGS_TZ_KEY && claySettings.SETTINGS_TZ_KEY.value),
      tzLabel:      timezones.normaliseLabel(
                      claySettings.SETTINGS_TZ_LABEL && claySettings.SETTINGS_TZ_LABEL.value),
      tempUnit:     (claySettings.SETTINGS_TEMP_UNIT && claySettings.SETTINGS_TEMP_UNIT.value) || 'C',
      theme:        !!(claySettings.SETTINGS_THEME && claySettings.SETTINGS_THEME.value)
    };
    saveSettings(settings);
    sendSettingsToWatch(settings);
    refresh(settings);
  } catch (err) {
    console.log('webviewclosed error: ' + err);
  }
});
