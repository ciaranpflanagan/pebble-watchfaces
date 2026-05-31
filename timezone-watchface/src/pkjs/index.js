'use strict';

// ---------------------------------------------------------------------------
// Weather fetch via Open-Meteo (no API key required)
// Refreshes on app ready and every 30 minutes whilst connected.
// ---------------------------------------------------------------------------

var REFRESH_INTERVAL_MS = 30 * 60 * 1000;

// Icon codes must match the WeatherIconType enum in timezone-watchface.c
var ICON_CLEAR   = 0;
var ICON_CLOUDY  = 1;
var ICON_FOG     = 2;
var ICON_RAIN    = 3;
var ICON_SNOW    = 4;
var ICON_STORM   = 5;

function wmoCodeToIcon(code) {
  if (code === 0)  return ICON_CLEAR;
  if (code <= 3)   return ICON_CLOUDY;
  if (code <= 48)  return ICON_FOG;
  if (code <= 67)  return ICON_RAIN;
  if (code <= 77)  return ICON_SNOW;
  if (code <= 82)  return ICON_RAIN;   // rain showers
  if (code <= 86)  return ICON_SNOW;   // snow showers
  return ICON_STORM;                   // 95-99: thunderstorms
}

function fetchWeather(position) {
  var lat = position.coords.latitude;
  var lon = position.coords.longitude;
  var url = 'https://api.open-meteo.com/v1/forecast' +
            '?latitude=' + lat +
            '&longitude=' + lon +
            '&current=temperature_2m,weather_code' +
            '&temperature_unit=celsius';

  var xhr = new XMLHttpRequest();
  xhr.onload = function() {
    try {
      var data = JSON.parse(this.responseText);
      var temp = Math.round(data.current.temperature_2m);
      var icon = wmoCodeToIcon(data.current.weather_code);

      Pebble.sendAppMessage(
        { 'WEATHER_TEMP': temp, 'WEATHER_ICON': icon },
        function() { console.log('Weather sent: icon=' + icon + ' temp=' + temp + 'C'); },
        function(e) { console.log('Failed to send weather: ' + JSON.stringify(e)); }
      );
    } catch (e) {
      console.log('Failed to parse weather response: ' + e);
    }
  };
  xhr.onerror = function() {
    console.log('Weather fetch failed');
  };
  xhr.open('GET', url);
  xhr.send();
}

function requestLocation() {
  navigator.geolocation.getCurrentPosition(
    fetchWeather,
    function(err) { console.log('Location error: ' + err.message); },
    { timeout: 15000, maximumAge: 300000 }
  );
}

Pebble.addEventListener('ready', function() {
  requestLocation();
  setInterval(requestLocation, REFRESH_INTERVAL_MS);
});
