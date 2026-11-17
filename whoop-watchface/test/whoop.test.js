'use strict';

// Unit tests for src/pkjs/whoop.js, plus the contracts between the phone code,
// the C and package.json. Run with: npm test

const test = require('node:test');
const assert = require('node:assert');
const { readFileSync } = require('node:fs');

const whoop = require('../src/pkjs/whoop.js');

const WATCHFACE_C = readFileSync(__dirname + '/../src/c/whoop-watchface.c', 'utf8');
const MANIFEST = JSON.parse(readFileSync(__dirname + '/../package.json', 'utf8'));

function cDefine(name) {
  const m = WATCHFACE_C.match(new RegExp('#define\\s+' + name + '\\s+(\\d+)'));
  assert.ok(m, name + ' not found in the C');
  return Number(m[1]);
}

/** The characters a Pebble font resource was subsetted to. */
function fontRegex(name) {
  const font = MANIFEST.pebble.resources.media.find((r) => r.name === name);
  assert.ok(font, name + ' missing from package.json');
  return new RegExp('^' + font.characterRegex + '*$');
}

test('toWatchPayload sends integers, with strain in tenths', () => {
  const synced = new Date('2026-11-17T14:05:00Z');
  assert.deepStrictEqual(whoop.toWatchPayload(whoop.mockSnapshot(synced)), {
    WHOOP_RECOVERY:   78,
    WHOOP_SLEEP_PERF: 91,
    WHOOP_SLEEP_MINS: 462,
    WHOOP_STRAIN:     124,
    WHOOP_SYNC_TIME:  Math.floor(synced.getTime() / 1000)
  });
});

test('unscored fields become -1, a missing sync time 0', () => {
  assert.deepStrictEqual(whoop.toWatchPayload({
    recovery: null, sleepPerf: undefined, sleepMins: NaN, strain: null
  }), {
    WHOOP_RECOVERY: -1, WHOOP_SLEEP_PERF: -1, WHOOP_SLEEP_MINS: -1,
    WHOOP_STRAIN: -1, WHOOP_SYNC_TIME: 0
  });
  assert.strictEqual(whoop.toWatchPayload(null).WHOOP_RECOVERY, -1);
});

test('values are clamped to their scales', () => {
  const p = whoop.toWatchPayload({ recovery: 140, sleepPerf: -5, strain: 25.3, sleepMins: 9999 });
  assert.strictEqual(p.WHOOP_RECOVERY, 100);
  assert.strictEqual(p.WHOOP_SLEEP_PERF, 0);
  assert.strictEqual(p.WHOOP_STRAIN, 210);
  assert.strictEqual(p.WHOOP_SLEEP_MINS, 1440);
});

test('strain rounds to the nearest tenth', () => {
  assert.strictEqual(whoop.toWatchPayload({ strain: 8.06 }).WHOOP_STRAIN, 81);
  assert.strictEqual(whoop.toWatchPayload({ strain: 0 }).WHOOP_STRAIN, 0);
});

test('recovery zones use Whoop thresholds', () => {
  assert.strictEqual(whoop.recoveryZone(100), 'green');
  assert.strictEqual(whoop.recoveryZone(67), 'green');
  assert.strictEqual(whoop.recoveryZone(66), 'yellow');
  assert.strictEqual(whoop.recoveryZone(34), 'yellow');
  assert.strictEqual(whoop.recoveryZone(33), 'red');
  assert.strictEqual(whoop.recoveryZone(0), 'red');
  assert.strictEqual(whoop.recoveryZone(null), null);
});

test('the C recovery thresholds and strain scale match the JS', () => {
  assert.strictEqual(cDefine('RECOVERY_GREEN_MIN'), whoop.RECOVERY_GREEN_MIN);
  assert.strictEqual(cDefine('RECOVERY_YELLOW_MIN'), whoop.RECOVERY_YELLOW_MIN);
  assert.strictEqual(cDefine('STRAIN_MAX_TENTHS'), whoop.STRAIN_MAX * 10);
});

test('every payload key is a declared messageKey that the C reads', () => {
  const keys = Object.keys(whoop.toWatchPayload(whoop.mockSnapshot()));
  for (const key of keys) {
    assert.ok(MANIFEST.pebble.messageKeys.includes(key), key + ' not in messageKeys');
    assert.ok(WATCHFACE_C.includes('MESSAGE_KEY_' + key), key + ' never read by the C');
  }
});

test('every declared messageKey is read by the C', () => {
  for (const key of MANIFEST.pebble.messageKeys) {
    assert.ok(WATCHFACE_C.includes('MESSAGE_KEY_' + key), key + ' never read by the C');
  }
});

test('the subsetted fonts cover every string the face draws', () => {
  // Ring values and the temperature use SPACE_GROTESK_18.
  const grotesk20 = fontRegex('SPACE_GROTESK_18');
  for (const s of ['--', '0', '100', '12.4', '21.0', '-12°C', '104°F']) {
    assert.match(s, grotesk20, JSON.stringify(s));
  }
  // Ring labels and footer use SPACE_MONO_11.
  const mono11 = fontRegex('SPACE_MONO_11');
  for (const s of ['RECOVERY', 'SLEEP', 'STRAIN', 'SLEPT 7H 42M', 'SLEPT --',
                   'SYNC 08:12', 'NOT SYNCED']) {
    assert.match(s, mono11, JSON.stringify(s));
  }
  assert.match('21:44', fontRegex('SPACE_GROTESK_56'));
});

test('the C draws the labels the font test checks', () => {
  for (const s of ['"RECOVERY"', '"SLEEP"', '"STRAIN"', '"SLEPT %dH %02dM"',
                   '"SYNC %s"', '"NOT SYNCED"']) {
    assert.ok(WATCHFACE_C.includes(s), s + ' not in the C');
  }
});
