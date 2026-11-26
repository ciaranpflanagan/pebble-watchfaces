'use strict';

// ---------------------------------------------------------------------------
// The board.
//
// Everything the watch draws is a string, and every one of those strings is
// built here. The C side owns no formatting at all: it receives nine short
// strings over AppMessage (event, session, status, and a position / driver code
// / time triple per podium row) and blits them into fixed boxes.
//
// That split exists for two reasons. The watch has no floating point worth
// using and no room for date arithmetic, and — more importantly — the fonts on
// the watch are character-subsetted (see `resources` in package.json). A glyph
// outside the declared subset renders as a blank box, so any text bound for the
// watch has to be forced into that subset before it is sent. sanitiseLabel is
// what does that, and it is why providers hand their raw strings through here
// rather than to Pebble.sendAppMessage directly.
// ---------------------------------------------------------------------------

var PODIUM_SIZE = 3;

// Field widths, in characters, measured against the boxes in src/c/f1-watchface.c.
var MAX_EVENT_CHARS   = 12;   // EVENT_W  at SPACE_MONO_14
var MAX_SESSION_CHARS = 6;    // SESSION_W at SPACE_MONO_14
var MAX_CODE_CHARS    = 3;    // CODE_W   at SPACE_MONO_20 — driver TLAs are 3
var MAX_TIME_CHARS    = 9;    // TIME_W   at SPACE_GROTESK_26

// The next-race row on the countdown layout: circuit on the left, the dates it
// runs on the right.
var MAX_NEXT_LABEL_CHARS = 10;  // NEXT_LABEL_W at SPACE_MONO_14
var MAX_NEXT_DATES_CHARS = 10;  // NEXT_DATES_W at SPACE_MONO_14

// Printed when a value is missing: a driver who set no time, a session with
// fewer than three classified drivers, or a fetch that came back empty.
var VALUE_UNAVAILABLE = '--';
var CODE_UNAVAILABLE  = '---';

// The characters the subsetted watch fonts actually contain. Anything else has
// to be stripped or transliterated before it is sent.
var ALLOWED_LABEL_CHARS = /[^A-Z0-9 :/.+-]/g;

// Accented Latin letters that turn up in F1 place names — São Paulo, Spielberg,
// Montréal, Nürburgring. The watch fonts carry ASCII only, so fold them first;
// stripping them instead would give "SO PAULO".
var DIACRITICS = [
  ['ÁÀÂÄÃÅĀ', 'A'], ['Æ', 'AE'], ['Ç Č Ć'.replace(/ /g, ''), 'C'],
  ['ÉÈÊËĒĖĘ', 'E'], ['ÍÌÎÏĪĮ', 'I'], ['Ñ Ń'.replace(/ /g, ''), 'N'],
  ['ÓÒÔÖÕØŌ', 'O'], ['ŚŠ', 'S'], ['ÚÙÛÜŪŮ', 'U'], ['ÝŸ', 'Y'], ['ŹŽŻ', 'Z']
];

// ---------------------------------------------------------------------------
// Gap mode — what the second and third rows show
// ---------------------------------------------------------------------------
// 'gap'      — the leader's time, then each following driver's deficit to them
//              (+0.102). This is how a real timing screen reads.
// 'absolute' — every row shows its own time, gap only where no absolute time
//              is known.
var GAP_MODES = ['gap', 'absolute'];
var DEFAULT_GAP_MODE = 'gap';

function resolveGapMode(value) {
  return GAP_MODES.indexOf(value) === -1 ? DEFAULT_GAP_MODE : value;
}

// ---------------------------------------------------------------------------
// Text
// ---------------------------------------------------------------------------
function pad(number, width) {
  var s = String(number);
  while (s.length < width) s = '0' + s;
  return s;
}

function foldDiacritics(text) {
  var out = text;
  for (var i = 0; i < DIACRITICS.length; i++) {
    var from = DIACRITICS[i][0];
    var to   = DIACRITICS[i][1];
    for (var j = 0; j < from.length; j++) {
      out = out.split(from.charAt(j)).join(to);
    }
  }
  return out;
}

/**
 * Force arbitrary API text into something the watch can actually render:
 * upper case, diacritics folded, anything outside the font subset dropped,
 * runs of whitespace collapsed, then truncated to fit its box.
 */
function sanitiseLabel(text, maxChars) {
  if (text === null || text === undefined) return '';

  var out = foldDiacritics(String(text).toUpperCase())
    .replace(ALLOWED_LABEL_CHARS, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^ | $/g, '');

  var limit = maxChars === undefined ? MAX_EVENT_CHARS : maxChars;
  return out.length > limit ? out.substring(0, limit).replace(/ $/, '') : out;
}

/**
 * The event name shown on the left of the session line. Circuit localities
 * ("Zandvoort", "Monza", "Las Vegas") are used in preference to race names
 * because "Emilia Romagna Grand Prix" cannot survive a 12-character box,
 * whereas "Imola" reads perfectly. Falls back to the race name with the
 * inevitable "Grand Prix" shortened to "GP".
 */
function eventLabel(locality, raceName) {
  var fromLocality = sanitiseLabel(locality, MAX_EVENT_CHARS);
  if (fromLocality) return fromLocality;

  var name = String(raceName === null || raceName === undefined ? '' : raceName)
    .replace(/Grand Prix/i, 'GP');
  return sanitiseLabel(name, MAX_EVENT_CHARS);
}

/**
 * The session name shown on the right of the session line, squeezed into the
 * abbreviations a timing screen would use. Accepts either an Ergast-style
 * category ('qualifying') or an OpenF1 session name ('Sprint Qualifying').
 */
function sessionLabel(name) {
  var raw = sanitiseLabel(name, 40);

  if (/^SPRINT (QUALIFYING|SHOOTOUT)/.test(raw)) return 'SQ';
  if (/^SPRINT/.test(raw))                       return 'SPRINT';
  if (/^QUALIFYING/.test(raw))                   return 'QUALI';
  if (/^RACE/.test(raw))                         return 'RACE';

  // "Practice 3" (OpenF1) and "FP3" both become FP3.
  var practice = raw.match(/^(?:PRACTICE|FP)\s*([1-3])/);
  if (practice) return 'FP' + practice[1];

  return sanitiseLabel(raw, MAX_SESSION_CHARS);
}

var MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN',
              'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

// ---------------------------------------------------------------------------
// Dates
//
// The board is only shown on the day of its session, and "the day" is the
// wearer's local one: the watch compares its own calendar date against a
// YYYYMMDD number sent from here. That number therefore has to be worked out in
// local time from the session's actual instant, not sliced out of the API's
// date string, which is UTC — the Las Vegas race starts on a Saturday night
// locally and a Sunday morning in UTC, and the wrong one would light the board
// up on the wrong day.
// ---------------------------------------------------------------------------

/**
 * The instant a session starts, in millis, from an API date and time
 * ("2026-08-23", "13:00:00Z"). Returns null when the date is unusable. A
 * missing time is treated as midday UTC — close enough to keep the local date
 * right everywhere except the last hour or two of the extreme offsets, and only
 * schedule entries ever lack one.
 */
function instantOf(isoDate, isoTime) {
  var date = String(isoDate === null || isoDate === undefined ? '' : isoDate);
  if (!/^\d{4}-\d{2}-\d{2}/.test(date)) return null;

  var time = String(isoTime === null || isoTime === undefined ? '' : isoTime);
  var instant = Date.parse(date.substring(0, 10) + 'T' + (time || '12:00:00Z'));

  return isFinite(instant) ? instant : null;
}

/**
 * A local calendar date as the YYYYMMDD integer the watch compares against.
 * Uses the plain Date getters rather than any locale method: pkjs has no ICU
 * data, and `toLocaleDateString` (like `Intl`) aborts the process uncatchably.
 */
function localDateNumber(millis) {
  if (typeof millis !== 'number' || !isFinite(millis)) return 0;

  var when = new Date(millis);
  return when.getFullYear() * 10000 + (when.getMonth() + 1) * 100 + when.getDate();
}

/** "05-07 SEP" for a race weekend, "31OCT-2NOV" for one that straddles a month. */
function formatDateRange(startMillis, endMillis) {
  var start = new Date(startMillis);
  var end   = new Date(endMillis);

  if (!isFinite(start.getTime()) || !isFinite(end.getTime())) return '';

  if (start.getMonth() === end.getMonth()) {
    return pad(start.getDate(), 2) + '-' + pad(end.getDate(), 2) + ' ' +
           MONTHS[start.getMonth()];
  }

  // A month boundary costs the space and the zero padding — this is the widest
  // string the row can hold.
  return start.getDate() + MONTHS[start.getMonth()] + '-' +
         end.getDate() + MONTHS[end.getMonth()];
}

// ---------------------------------------------------------------------------
// Times
// ---------------------------------------------------------------------------

/**
 * Parse the clock strings Ergast/Jolpica hand back — "1:11.163", "2:04:44.859",
 * "+11.536", "58.412" — into seconds. Returns null for anything unparseable,
 * including the "+1 Lap" style strings, which are handled as laps down.
 */
function parseClock(text) {
  var raw = String(text === null || text === undefined ? '' : text).trim();
  if (!raw) return null;

  var m = /^\+?(?:(\d+):)?(?:(\d{1,2}):)?(\d{1,2})(?:\.(\d{1,3}))?$/.exec(raw);
  if (!m) return null;

  // With two colons the groups are H:M:S; with one they are M:S, which lands in
  // groups 1 and 3 and leaves group 2 undefined.
  var hours   = m[2] === undefined ? 0 : parseInt(m[1], 10);
  var minutes = m[2] === undefined ? (m[1] === undefined ? 0 : parseInt(m[1], 10))
                                   : parseInt(m[2], 10);
  var seconds = parseInt(m[3], 10);
  var millis  = m[4] === undefined ? 0 : parseInt((m[4] + '00').substring(0, 3), 10);

  return hours * 3600 + minutes * 60 + seconds + millis / 1000;
}

/** "+1 Lap" / "+2 Laps" → 1 / 2. Returns 0 when the string is not laps down. */
function parseLapsDown(text) {
  var m = /^\+?\s*(\d+)\s*LAPS?\b/.exec(String(text === null || text === undefined ? '' : text).toUpperCase());
  return m ? parseInt(m[1], 10) : 0;
}

function isUsableSeconds(seconds) {
  return typeof seconds === 'number' && isFinite(seconds) && seconds >= 0;
}

/**
 * An absolute time: "58.412" for a sub-minute lap, "1:11.163" for a normal one,
 * "2:04:44" for a race total (the milliseconds are dropped there — nine
 * characters is all the time column holds).
 */
function formatLapTime(seconds) {
  if (!isUsableSeconds(seconds)) return VALUE_UNAVAILABLE;

  var totalMillis = Math.round(seconds * 1000);
  var whole   = Math.floor(totalMillis / 1000);
  var millis  = totalMillis % 1000;
  var hours   = Math.floor(whole / 3600);
  var minutes = Math.floor((whole % 3600) / 60);
  var secs    = whole % 60;

  if (hours > 0)   return hours + ':' + pad(minutes, 2) + ':' + pad(secs, 2);
  if (minutes > 0) return minutes + ':' + pad(secs, 2) + '.' + pad(millis, 3);
  return secs + '.' + pad(millis, 3);
}

/**
 * A deficit to the driver above: "+0.102", "+11.536". Past a minute the
 * milliseconds go — "+1:05" — because the column has no room for them, and a
 * minute-plus gap inside the top three is not a race anyone is reading closely.
 */
function formatGap(seconds) {
  if (!isUsableSeconds(seconds)) return VALUE_UNAVAILABLE;

  var totalMillis = Math.round(seconds * 1000);
  var whole   = Math.floor(totalMillis / 1000);
  var millis  = totalMillis % 1000;
  var minutes = Math.floor(whole / 60);
  var secs    = whole % 60;

  if (minutes > 0) return '+' + minutes + ':' + pad(secs, 2);
  return '+' + secs + '.' + pad(millis, 3);
}

/** Laps down, in the space available: "+1L". */
function formatLapsDown(laps) {
  if (typeof laps !== 'number' || !isFinite(laps) || laps < 1) return VALUE_UNAVAILABLE;
  return '+' + Math.floor(laps) + 'L';
}

// ---------------------------------------------------------------------------
// Board assembly
// ---------------------------------------------------------------------------

/**
 * A blank board. Sent when no session's results could be built, along with a
 * session date of 0 — which is what keeps the watch on the countdown layout
 * rather than showing three rows of dashes.
 */
function emptyBoard() {
  var rows = [];
  for (var i = 0; i < PODIUM_SIZE; i++) {
    rows.push({ pos: String(i + 1), code: CODE_UNAVAILABLE, time: VALUE_UNAVAILABLE });
  }
  return { event: '', session: '', rows: rows };
}

/** The time string for one entry, honouring the gap mode. */
function entryTime(entry, isLeader, gapMode) {
  // The leader has nobody to be behind, so their row is always an absolute
  // time — their best lap in a qualifying or practice session, their total
  // race time in a race.
  if (isLeader) return formatLapTime(entry.seconds);

  var preferAbsolute = (resolveGapMode(gapMode) === 'absolute');
  if (preferAbsolute && isUsableSeconds(entry.seconds)) {
    return formatLapTime(entry.seconds);
  }

  // A driver a lap or more down has no meaningful gap in seconds.
  if (entry.lapsDown > 0) return formatLapsDown(entry.lapsDown);
  if (isUsableSeconds(entry.gapSeconds)) return formatGap(entry.gapSeconds);

  // Absolute mode already tried this; gap mode has not.
  return formatLapTime(entry.seconds);
}

/**
 * Turn a provider's normalised entries into the nine strings the watch draws.
 *
 * `entries` are objects of { position, code, seconds, gapSeconds, lapsDown },
 * already ordered by position. Fewer than three is fine — a red-flagged
 * practice session may have nobody classified at all — and the short rows fill
 * with placeholders rather than disappearing, so the layout never reflows.
 */
function buildBoard(session) {
  var input   = session || {};
  var entries = input.entries || [];
  var board   = emptyBoard();

  board.event = sanitiseLabel(input.event, MAX_EVENT_CHARS);
  // sessionLabel rather than a plain truncation, and it is idempotent: the
  // providers have abbreviated this already, but a raw "Qualifying" arriving
  // here should become QUALI rather than the truncated QUALIF.
  board.session = sessionLabel(input.session);

  for (var i = 0; i < PODIUM_SIZE && i < entries.length; i++) {
    var entry = entries[i] || {};
    var code  = sanitiseLabel(entry.code, MAX_CODE_CHARS);

    board.rows[i] = {
      // The displayed position comes from the result, not from the row index:
      // when a driver is excluded the top three can genuinely read 1, 2, 4.
      pos:  entry.position ? sanitiseLabel(entry.position, 2) : String(i + 1),
      code: code || CODE_UNAVAILABLE,
      time: sanitiseLabel(entryTime(entry, i === 0, input.gapMode), MAX_TIME_CHARS)
    };
  }

  return board;
}

module.exports = {
  PODIUM_SIZE: PODIUM_SIZE,
  MAX_EVENT_CHARS: MAX_EVENT_CHARS,
  MAX_SESSION_CHARS: MAX_SESSION_CHARS,
  MAX_CODE_CHARS: MAX_CODE_CHARS,
  MAX_TIME_CHARS: MAX_TIME_CHARS,
  MAX_NEXT_LABEL_CHARS: MAX_NEXT_LABEL_CHARS,
  MAX_NEXT_DATES_CHARS: MAX_NEXT_DATES_CHARS,
  VALUE_UNAVAILABLE: VALUE_UNAVAILABLE,
  CODE_UNAVAILABLE: CODE_UNAVAILABLE,
  GAP_MODES: GAP_MODES,
  DEFAULT_GAP_MODE: DEFAULT_GAP_MODE,
  resolveGapMode: resolveGapMode,
  sanitiseLabel: sanitiseLabel,
  eventLabel: eventLabel,
  sessionLabel: sessionLabel,
  instantOf: instantOf,
  localDateNumber: localDateNumber,
  formatDateRange: formatDateRange,
  parseClock: parseClock,
  parseLapsDown: parseLapsDown,
  formatLapTime: formatLapTime,
  formatGap: formatGap,
  formatLapsDown: formatLapsDown,
  emptyBoard: emptyBoard,
  buildBoard: buildBoard
};
