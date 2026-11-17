'use strict';

// Unit tests for src/pkjs/accent.js. Run with: npm test

const test = require('node:test');
const assert = require('node:assert');
const { readFileSync } = require('node:fs');

const accent = require('../src/pkjs/accent.js');

const WATCHFACE_C = readFileSync(__dirname + '/../src/c/whoop-watchface.c', 'utf8');

test('the default accent is a valid 24-bit RGB integer', () => {
  assert.ok(accent.DEFAULT_ACCENT >= 0 && accent.DEFAULT_ACCENT <= 0xFFFFFF);
  assert.strictEqual(accent.resolveAccent(accent.DEFAULT_ACCENT), accent.DEFAULT_ACCENT);
});

test('resolveAccent parses numbers and hex strings', () => {
  assert.strictEqual(accent.resolveAccent(0xFF5555), 0xFF5555);
  assert.strictEqual(accent.resolveAccent('0xFF5555'), 0xFF5555);
  assert.strictEqual(accent.resolveAccent('#ff5555'), 0xFF5555);
  assert.strictEqual(accent.resolveAccent('00AAFF'), 0x00AAFF);
});

test('resolveAccent falls back to the default for junk', () => {
  for (const bad of [undefined, null, '', 'nope', {}, NaN, -1, 0x1000000, 1.5, true]) {
    assert.strictEqual(accent.resolveAccent(bad), accent.DEFAULT_ACCENT,
                       'should fall back for ' + JSON.stringify(bad));
  }
});

test('the C default accent matches the JS default', () => {
  const m = WATCHFACE_C.match(/#define\s+ACCENT_DEFAULT_HEX\s+(0x[0-9A-Fa-f]+)/);
  assert.ok(m, 'ACCENT_DEFAULT_HEX not found in the C');
  assert.strictEqual(parseInt(m[1], 16), accent.DEFAULT_ACCENT);
});
