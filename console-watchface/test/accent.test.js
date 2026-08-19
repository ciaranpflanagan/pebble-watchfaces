'use strict';

// Unit tests for src/pkjs/accent.js
// Run with: npm test   (from console-watchface/)
//
// The accent colour is a 24-bit RGB integer that the phone sends and the watch
// turns into a GColor. The risks are letting a junk value through to the watch,
// and the JS default drifting away from the C default so a fresh install and a
// saved-then-reset install show different oranges.

const test = require('node:test');
const assert = require('node:assert');
const { readFileSync } = require('node:fs');

const accent = require('../src/pkjs/accent.js');

const WATCHFACE_C = readFileSync(__dirname + '/../src/c/console-watchface.c', 'utf8');
const MANIFEST = JSON.parse(readFileSync(__dirname + '/../package.json', 'utf8'));

test('the default accent is a valid 24-bit RGB integer', () => {
  assert.strictEqual(typeof accent.DEFAULT_ACCENT, 'number');
  assert.ok(accent.DEFAULT_ACCENT >= 0 && accent.DEFAULT_ACCENT <= 0xFFFFFF);
  assert.strictEqual(accent.resolveAccent(accent.DEFAULT_ACCENT), accent.DEFAULT_ACCENT);
});

test('resolveAccent passes through valid palette integers', () => {
  for (const value of [0x000000, 0xFFFFFF, 0xFF5555, 0x55AAFF, 0xAAFF00]) {
    assert.strictEqual(accent.resolveAccent(value), value);
  }
});

test('resolveAccent parses hex strings in any common spelling', () => {
  assert.strictEqual(accent.resolveAccent('0xFF5555'), 0xFF5555);
  assert.strictEqual(accent.resolveAccent('#ff5555'), 0xFF5555);
  assert.strictEqual(accent.resolveAccent('ff5555'), 0xFF5555);
  assert.strictEqual(accent.resolveAccent('00AAFF'), 0x00AAFF);
});

test('resolveAccent falls back to the default for junk, out-of-range and hostile input', () => {
  for (const bad of [undefined, null, '', 'nope', {}, [], NaN, Infinity,
                     -1, 0x1000000, 1.5, '0xGGGGGG', true]) {
    assert.strictEqual(accent.resolveAccent(bad), accent.DEFAULT_ACCENT,
                       'should fall back for ' + JSON.stringify(bad));
  }
});

test('toHexString renders a zero-padded 0xRRGGBB string', () => {
  assert.strictEqual(accent.toHexString(0xFF5555), '0xFF5555');
  assert.strictEqual(accent.toHexString(0x0000FF), '0x0000FF');
  assert.strictEqual(accent.toHexString(0x000000), '0x000000');
  // Junk resolves to the default before formatting.
  assert.strictEqual(accent.toHexString('nope'), accent.toHexString(accent.DEFAULT_ACCENT));
});

test('the C default accent matches the JS default', () => {
  // Both must be 0xFF5555 (the RGB of GColorSunsetOrange) or a fresh install
  // and a reset install would show different colours.
  const m = WATCHFACE_C.match(/#define\s+ACCENT_DEFAULT_HEX\s+(0x[0-9A-Fa-f]+)/);
  assert.ok(m, 'ACCENT_DEFAULT_HEX not found in the C');
  assert.strictEqual(parseInt(m[1], 16), accent.DEFAULT_ACCENT);
});

test('the manifest declares the accent message key', () => {
  assert.ok(MANIFEST.pebble.messageKeys.includes('SETTINGS_ACCENT'));
});
