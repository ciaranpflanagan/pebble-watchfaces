'use strict';

// ---------------------------------------------------------------------------
// Data sources.
//
// Two, and the difference matters enough to be a config choice rather than
// something decided behind the user's back:
//
//   results — Jolpica, free and keyless, but published after a session ends.
//             Race, qualifying and sprint only. See jolpica.js.
//   live    — OpenF1, real timing including practice, but its free tier is
//             switched off while a session is actually running, so a live board
//             needs a paid API key. See openf1.js. Falls back to `results`
//             whenever OpenF1 gives nothing.
//
// The choice never reaches the watch; it only decides which fetch index.js runs.
// ---------------------------------------------------------------------------

var SOURCES = [
  { key: 'results', name: 'Results (free)',            live: false },
  { key: 'live',    name: 'Live timing (OpenF1 key)',  live: true  }
];

var DEFAULT_SOURCE = 'results';

// Long enough for any token OpenF1 issues, short enough that a pasted essay
// never reaches an Authorization header.
var MAX_API_KEY_CHARS = 128;

var BY_KEY = {};
for (var i = 0; i < SOURCES.length; i++) {
  BY_KEY[SOURCES[i].key] = SOURCES[i];
}

/** Coerce anything stored or posted back by Clay into a known source key. */
function resolveSource(key) {
  return Object.prototype.hasOwnProperty.call(BY_KEY, key) ? key : DEFAULT_SOURCE;
}

function isLive(key) {
  return BY_KEY[resolveSource(key)].live;
}

/**
 * Tidy a pasted API key. Whitespace is stripped wholesale rather than trimmed,
 * because a key copied out of a browser or an email routinely arrives with a
 * line break through the middle of it, and that would be sent as a header value
 * and rejected with no clue as to why.
 */
function normaliseApiKey(value) {
  if (value === null || value === undefined) return '';
  return String(value).replace(/\s+/g, '').substring(0, MAX_API_KEY_CHARS);
}

/** Options for the Clay select, in declaration order. */
function configOptions() {
  return SOURCES.map(function(source) {
    return { label: source.name, value: source.key };
  });
}

module.exports = {
  SOURCES: SOURCES,
  DEFAULT_SOURCE: DEFAULT_SOURCE,
  MAX_API_KEY_CHARS: MAX_API_KEY_CHARS,
  resolveSource: resolveSource,
  isLive: isLive,
  normaliseApiKey: normaliseApiKey,
  configOptions: configOptions
};
