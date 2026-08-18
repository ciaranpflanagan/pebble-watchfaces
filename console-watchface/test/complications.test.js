'use strict';

// Unit tests for src/pkjs/complications.js
// Run with: npm test   (from console-watchface/)
//
// The interesting risk here is drift: the complication list lives in JS but
// the watch decodes it as an integer enum, and the labels have to survive both
// the footer's width limit and the font subset declared in package.json. Most
// of these tests read the C and the manifest back and check they still agree.

const test = require('node:test');
const assert = require('node:assert');
const { readFileSync } = require('node:fs');

const complications = require('../src/pkjs/complications.js');
const tz = require('../src/pkjs/timezones.js');

const WATCHFACE_C = readFileSync(__dirname + '/../src/c/console-watchface.c', 'utf8');

test('complication keys are unique', () => {
  const keys = complications.COMPLICATIONS.map((c) => c.key);
  assert.strictEqual(new Set(keys).size, keys.length);
});

test('AppMessage values are contiguous from zero', () => {
  const values = complications.COMPLICATIONS.map((c) => c.value);
  assert.deepStrictEqual(values, values.map((_, i) => i));
});

test('the default complication is a real one', () => {
  assert.strictEqual(
    complications.resolveComplication(complications.DEFAULT_COMPLICATION),
    complications.DEFAULT_COMPLICATION);
});

test('unknown, missing and hostile keys fall back to the default', () => {
  for (const bad of [undefined, null, '', 'nope', 42, {}, 'toString', 'constructor']) {
    assert.strictEqual(complications.resolveComplication(bad),
                       complications.DEFAULT_COMPLICATION,
                       'should fall back for ' + JSON.stringify(bad));
  }
});

test('toValue round-trips every key', () => {
  for (const c of complications.COMPLICATIONS) {
    assert.strictEqual(complications.toValue(c.key), c.value);
  }
});

test('only the timezone complication is a timezone', () => {
  for (const c of complications.COMPLICATIONS) {
    assert.strictEqual(complications.isTimezone(c.key), c.key === 'timezone');
  }
});

test('the timezone takes its label from the city, the rest have their own', () => {
  assert.strictEqual(complications.defaultLabel('timezone'), '');
  for (const c of complications.COMPLICATIONS.filter((c) => c.key !== 'timezone')) {
    assert.ok(complications.defaultLabel(c.key).length > 0, c.key + ' needs a label');
  }
});

test('default labels survive normalisation unchanged', () => {
  // normaliseLabel strips anything the SPACE_MONO_14 subset cannot render and
  // truncates to the footer width, so a label that comes back altered would
  // render wrong on the watch.
  for (const c of complications.COMPLICATIONS) {
    const label = complications.defaultLabel(c.key);
    if (!label) continue;
    assert.strictEqual(tz.normaliseLabel(label), label, c.key + ' label is not watch-safe');
    assert.ok(label.length <= tz.MAX_LABEL_CHARS, c.key + ' label is too long');
  }
});

test('config options cover every complication in order', () => {
  assert.deepStrictEqual(
    complications.configOptions(),
    complications.COMPLICATIONS.map((c) => ({ label: c.name, value: c.key })));
});

test('the C enum agrees with the JS values', () => {
  // e.g. "  COMP_STEPS     = 1,"
  const enumBody = WATCHFACE_C.match(/typedef enum \{([^}]*)\} ComplicationType;/)[1];
  const cValues = {};
  for (const line of enumBody.split('\n')) {
    const m = line.match(/COMP_([A-Z_]+)\s*=\s*(\d+)/);
    if (m) cValues[m[1]] = Number(m[2]);
  }

  const expected = {
    TIMEZONE: complications.toValue('timezone'),
    STEPS:    complications.toValue('steps'),
    BATTERY:  complications.toValue('battery'),
    HEART:    complications.toValue('heart'),
    CALORIES: complications.toValue('calories')
  };
  assert.deepStrictEqual(cValues, expected);
});

test('the C fallback labels match the JS ones', () => {
  // COMPLICATION_LABELS is only used before the phone has ever sent a label,
  // but a mismatch there would show a different word than the config page
  // promises.
  const list = WATCHFACE_C
    .match(/COMPLICATION_LABELS\[COMP_COUNT\] = \{([^}]*)\}/)[1]
    .match(/"([^"]*)"/g)
    .map((s) => s.slice(1, -1));

  assert.strictEqual(list.length, complications.COMPLICATIONS.length);
  list.forEach((label, i) => {
    const c = complications.COMPLICATIONS[i];
    if (c.key === 'timezone') {
      // No JS default: the timezone labels itself from the chosen city, and
      // the C fallback just mirrors the default zone.
      assert.strictEqual(label, tz.labelForZone(tz.DEFAULT_ZONE));
    } else {
      assert.strictEqual(label, c.label, c.key + ' label differs between C and JS');
    }
  });
});

test('the manifest declares health for the health-backed complications', () => {
  const manifest = JSON.parse(readFileSync(__dirname + '/../package.json', 'utf8'));
  const needsHealth = complications.COMPLICATIONS.some((c) => c.health);
  assert.strictEqual(manifest.pebble.capabilities.includes('health'), needsHealth);
  assert.ok(manifest.pebble.messageKeys.includes('SETTINGS_COMPLICATION'));
});

test('the footer value font can render every value shape', () => {
  // The value font is character-subsetted in package.json. A character outside
  // the subset renders as a blank box on the watch, silently.
  const manifest = JSON.parse(readFileSync(__dirname + '/../package.json', 'utf8'));
  const font = manifest.pebble.resources.media.find((m) => m.name === 'SPACE_GROTESK_22');
  const allowed = new RegExp(font.characterRegex, 'g');

  // One sample per branch of render_footer() in the C.
  const samples = ['20:34', '8,421', '12.4K', '90%', '100%', '72', '320', '--'];
  for (const sample of samples) {
    assert.strictEqual(sample.replace(allowed, ''), '',
                       'SPACE_GROTESK_22 cannot render "' + sample + '"');
  }
});
