'use strict';

// Unit tests for src/pkjs/weather.js. Run with: npm test

const test = require('node:test');
const assert = require('node:assert');
const { readFileSync } = require('node:fs');

const weather = require('../src/pkjs/weather.js');

const WATCHFACE_C = readFileSync(__dirname + '/../src/c/whoop-watchface.c', 'utf8');

test('WMO codes map to the expected glyphs', () => {
  const I = weather.ICONS;
  assert.strictEqual(weather.wmoToIcon(0),  I.CLEAR);
  assert.strictEqual(weather.wmoToIcon(2),  I.CLOUDY);
  assert.strictEqual(weather.wmoToIcon(45), I.FOG);
  assert.strictEqual(weather.wmoToIcon(61), I.RAIN);
  assert.strictEqual(weather.wmoToIcon(73), I.SNOW);
  assert.strictEqual(weather.wmoToIcon(81), I.RAIN);
  assert.strictEqual(weather.wmoToIcon(85), I.SNOW);
  assert.strictEqual(weather.wmoToIcon(95), I.STORM);
  assert.strictEqual(weather.wmoToIcon(undefined), I.UNKNOWN);
});

test('the icon values match the C WeatherIconType enum', () => {
  for (const [name, value] of Object.entries(weather.ICONS)) {
    const m = WATCHFACE_C.match(new RegExp('ICON_' + name + '\\s*=\\s*(\\d+)'));
    assert.ok(m, 'ICON_' + name + ' missing from the C enum');
    assert.strictEqual(Number(m[1]), value, 'ICON_' + name);
  }
});

test('toWatchPayload rounds the temperature and rejects empty bodies', () => {
  assert.deepStrictEqual(
    weather.toWatchPayload({ current: { temperature_2m: 8.6, weather_code: 3 } }),
    { WEATHER_TEMP: 9, WEATHER_ICON: weather.ICONS.CLOUDY });
  assert.deepStrictEqual(
    weather.toWatchPayload({ current: { temperature_2m: -0.4, weather_code: 0 } }),
    { WEATHER_TEMP: 0, WEATHER_ICON: weather.ICONS.CLEAR });
  assert.strictEqual(weather.toWatchPayload({}), null);
  assert.strictEqual(weather.toWatchPayload(null), null);
});

test('buildUrl requests the chosen unit', () => {
  assert.match(weather.buildUrl(1, 2, 'F'), /temperature_unit=fahrenheit/);
  assert.match(weather.buildUrl(1, 2, 'C'), /temperature_unit=celsius/);
});
