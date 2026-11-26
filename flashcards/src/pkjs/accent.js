'use strict';

// ---------------------------------------------------------------------------
// Accent colour.
//
// The accent marks the front of a card (so a glance tells you which side you
// are looking at), the progress bar along the foot of the card window, and the
// selected row of the deck list. The user picks it from Clay's colour
// component, which yields a 24-bit RGB integer (0xRRGGBB) drawn from the Pebble
// palette. That integer travels over AppMessage as SETTINGS_ACCENT and the
// watch turns it into a GColor with GColorFromHEX.
//
// The default is 0x00AAFF — the exact RGB of GColorVividCerulean — which reads
// as calm rather than as a correction. Keep DEFAULT_ACCENT in step with
// ACCENT_DEFAULT_HEX in src/c/flashcards.c.
// ---------------------------------------------------------------------------

var DEFAULT_ACCENT = 0x00AAFF;

// The colour picker only ever yields values in this range; anything outside it
// is corrupt storage or a hostile config response.
var MAX_RGB = 0xFFFFFF;

/**
 * Coerce anything stored or posted back by Clay into a valid 24-bit RGB
 * integer, falling back to the default rather than sending junk to the watch.
 * Accepts a number or a '0xRRGGBB' / '#RRGGBB' / 'RRGGBB' string.
 */
function resolveAccent(value) {
  var n;

  if (typeof value === 'number') {
    n = value;
  } else if (typeof value === 'string' && value) {
    n = parseInt(value.replace(/^#|^0x/i, ''), 16);
  } else {
    return DEFAULT_ACCENT;
  }

  if (!isFinite(n) || Math.floor(n) !== n || n < 0 || n > MAX_RGB) {
    return DEFAULT_ACCENT;
  }
  return n;
}

/** Render an RGB integer as a '0xRRGGBB' string, e.g. for the Clay default. */
function toHexString(value) {
  var hex = resolveAccent(value).toString(16).toUpperCase();
  while (hex.length < 6) hex = '0' + hex;
  return '0x' + hex;
}

module.exports = {
  DEFAULT_ACCENT: DEFAULT_ACCENT,
  resolveAccent: resolveAccent,
  toHexString: toHexString
};
