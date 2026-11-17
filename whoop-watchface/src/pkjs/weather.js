'use strict';

// ---------------------------------------------------------------------------
// Weather, from Open-Meteo (no API key). The icon values mirror the
// WeatherIconType enum in src/c/whoop-watchface.c.
// ---------------------------------------------------------------------------

var ICONS = {
  CLEAR:   0,
  CLOUDY:  1,
  FOG:     2,
  RAIN:    3,
  SNOW:    4,
  STORM:   5,
  UNKNOWN: 6
};

/** Map a WMO weather code to one of the watch's glyphs. */
function wmoToIcon(code) {
  if (typeof code !== 'number' || !isFinite(code)) return ICONS.UNKNOWN;
  if (code === 0)  return ICONS.CLEAR;
  if (code <= 3)   return ICONS.CLOUDY;
  if (code <= 48)  return ICONS.FOG;
  if (code <= 67)  return ICONS.RAIN;
  if (code <= 77)  return ICONS.SNOW;
  if (code <= 82)  return ICONS.RAIN;
  if (code <= 86)  return ICONS.SNOW;
  return ICONS.STORM;
}

function buildUrl(lat, lon, tempUnit) {
  return 'https://api.open-meteo.com/v1/forecast' +
         '?latitude='  + lat +
         '&longitude=' + lon +
         '&current=temperature_2m,weather_code' +
         '&temperature_unit=' + (tempUnit === 'F' ? 'fahrenheit' : 'celsius');
}

/** Turn an Open-Meteo response body into the AppMessage fields, or null. */
function toWatchPayload(body) {
  var current = body && body.current;
  if (!current || typeof current.temperature_2m !== 'number') return null;
  return {
    WEATHER_TEMP: Math.round(current.temperature_2m) || 0,   // no "-0"
    WEATHER_ICON: wmoToIcon(current.weather_code)
  };
}

module.exports = {
  ICONS: ICONS,
  wmoToIcon: wmoToIcon,
  buildUrl: buildUrl,
  toWatchPayload: toWatchPayload
};
