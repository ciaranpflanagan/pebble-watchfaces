'use strict';

// ---------------------------------------------------------------------------
// Console watchface — companion JS
//
// Geolocation is intentionally NOT used. navigator.geolocation in the Pebble
// SDK emulator tries to hit Pebble's defunct location servers and throws
// [Errno 61] Connection refused, killing the JS process before any weather
// fetch can happen.
//
// Set DEFAULT_LAT / DEFAULT_LON to your actual coordinates.
// ---------------------------------------------------------------------------

var DEFAULT_LAT =  47.6062;   // Seattle, WA
var DEFAULT_LON = -122.3321;

var REFRESH_MS = 30 * 60 * 1000;

// Icon codes must match WeatherIconType enum in console-watchface.c
var ICON_CLEAR   = 0;
var ICON_CLOUDY  = 1;
var ICON_FOG     = 2;
var ICON_RAIN    = 3;
var ICON_SNOW    = 4;
var ICON_STORM   = 5;

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

// Europe/Dublin DST rule — no Intl.DateTimeFormat needed (crashes old V8).
// UTC+1 (IST) from last Sunday in March @ 01:00 UTC
// to   last Sunday in October @ 01:00 UTC. UTC+0 (GMT) otherwise.
function getDublinOffsetMinutes() {
  var now  = new Date();
  var year = now.getUTCFullYear();

  function lastSundayUtc(yr, month0, hour) {
    var d = new Date(Date.UTC(yr, month0 + 1, 0)); // last day of month
    d.setUTCDate(d.getUTCDate() - d.getUTCDay()); // rewind to last Sunday
    d.setUTCHours(hour, 0, 0, 0);
    return d;
  }

  var dstStart = lastSundayUtc(year, 2, 1);   // last Sun Mar @ 01:00 UTC
  var dstEnd   = lastSundayUtc(year, 9, 1);   // last Sun Oct @ 01:00 UTC
  return (now >= dstStart && now < dstEnd) ? 60 : 0;
}

function fetchWeather(lat, lon) {
  var url = 'https://api.open-meteo.com/v1/forecast' +
            '?latitude='  + lat +
            '&longitude=' + lon +
            '&current=temperature_2m,weather_code' +
            '&temperature_unit=celsius';

  var xhr = new XMLHttpRequest();
  xhr.onload = function() {
    try {
      var data  = JSON.parse(this.responseText);
      var temp  = Math.round(data.current.temperature_2m);
      var icon  = wmoToIcon(data.current.weather_code);
      var dublinOffset = getDublinOffsetMinutes();

      Pebble.sendAppMessage(
        { WEATHER_TEMP: temp, WEATHER_ICON: icon, DUBLIN_OFFSET: dublinOffset },
        function() {
          console.log('Sent: temp=' + temp + 'C icon=' + icon + ' dublin=' + dublinOffset + 'min');
        },
        function(e) {
          console.log('AppMessage failed: ' + JSON.stringify(e));
        }
      );
    } catch (e) {
      console.log('Weather parse error: ' + e);
    }
  };
  xhr.onerror = function() {
    console.log('Weather fetch failed');
  };
  xhr.open('GET', url);
  xhr.send();
}

function refresh() {
  fetchWeather(DEFAULT_LAT, DEFAULT_LON);
}

Pebble.addEventListener('ready', function() {
  refresh();
  setInterval(refresh, REFRESH_MS);
});
