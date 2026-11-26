'use strict';

// ---------------------------------------------------------------------------
// OpenF1 — the live source, opt-in.
//
// OpenF1 (https://openf1.org) carries real timing data, including practice,
// which Jolpica does not. The catch, and the reason this is not the default:
// while a session is actually running, the free tier is switched off. An
// unauthenticated request during a live session returns
//
//   401 {"detail":"Live F1 session in progress. Global API access (including
//        past sessions) is restricted to authenticated users until the session
//        ends."}
//
// so a live board needs a paid API key, entered on the config page and sent as
// a bearer token. Without one this source still works between sessions — it
// picks up a finished practice or qualifying session within minutes, well ahead
// of Jolpica — but goes quiet exactly when a session is on, and index.js falls
// back to Jolpica for that window.
//
// This module is pure: it builds URLs and parses responses. index.js does the
// fetching.
// ---------------------------------------------------------------------------

var board = require('./board.js');

var BASE_URL = 'https://api.openf1.org/v1';

// `session_key=latest` is OpenF1's own pointer at the session in progress, or
// the most recent one if none is.
var LATEST = 'latest';

// A session's published end time is the scheduled one; a race running long
// under safety cars is still live past it. Treat the window as open a little
// longer rather than flipping the status line to a date mid-race.
var LIVE_GRACE_MS = 30 * 60 * 1000;

function sessionsUrl()  { return BASE_URL + '/sessions?session_key=' + LATEST; }
function driversUrl()   { return BASE_URL + '/drivers?session_key=' + LATEST; }
function positionsUrl() { return BASE_URL + '/position?session_key=' + LATEST; }
function intervalsUrl() { return BASE_URL + '/intervals?session_key=' + LATEST; }

/** Results are filtered server-side to the podium — the full field is 20 rows. */
function resultsUrl() {
  return BASE_URL + '/session_result?session_key=' + LATEST +
         '&position<=' + board.PODIUM_SIZE;
}

/**
 * The Authorization header for a request, or an empty object when the user has
 * no key. An empty object rather than a null header keeps index.js from having
 * to branch around it.
 */
function authHeaders(apiKey) {
  var key = String(apiKey === null || apiKey === undefined ? '' : apiKey).trim();
  return key ? { Authorization: 'Bearer ' + key } : {};
}

/**
 * OpenF1 reports per-segment values as arrays: a qualifying `duration` is
 * [Q1, Q2, Q3] with nulls for segments the driver never reached. The value that
 * matters is the last one they actually set.
 */
function lastPresent(value) {
  if (!value || Object.prototype.toString.call(value) !== '[object Array]') {
    return value === undefined ? null : value;
  }
  for (var i = value.length - 1; i >= 0; i--) {
    if (value[i] !== null && value[i] !== undefined) return value[i];
  }
  return null;
}

function toSeconds(value) {
  var picked = lastPresent(value);
  if (typeof picked === 'number' && isFinite(picked) && picked >= 0) return picked;
  if (typeof picked === 'string') return board.parseClock(picked);
  return null;
}

/** A time value in millis, tolerating both ISO strings and epoch numbers. */
function toMillis(value) {
  if (typeof value === 'number' && isFinite(value)) return value;
  var parsed = Date.parse(String(value || ''));
  return isFinite(parsed) ? parsed : null;
}

/**
 * Parse the sessions response into the session the board is about. `nowMillis`
 * decides whether it is live, and so whether the status line reads LIVE or
 * carries the session's date.
 */
function parseSession(rows, nowMillis) {
  if (!rows || !rows.length) return null;

  var row   = rows[rows.length - 1];
  var start = toMillis(row.date_start);
  var end   = toMillis(row.date_end);
  var now   = typeof nowMillis === 'number' ? nowMillis : Date.now();

  var live = (start !== null && now >= start) &&
             (end === null || now <= end + LIVE_GRACE_MS);

  return {
    sessionKey: row.session_key,
    live:       live,
    event:      board.eventLabel(row.circuit_short_name || row.location,
                                 row.country_name),
    session:    board.sessionLabel(row.session_name || row.session_type),
    // OpenF1 stamps the session itself rather than the race, so this is the
    // real start instant and the day the board should appear on.
    startsAt:   start
  };
}

/** driver_number → three-letter code, for joining onto timing rows. */
function parseDrivers(rows) {
  var byNumber = {};
  if (!rows) return byNumber;

  for (var i = 0; i < rows.length; i++) {
    var row = rows[i];
    if (!row || row.driver_number === undefined || row.driver_number === null) continue;

    var code = row.name_acronym ||
               String(row.last_name || row.broadcast_name || '')
                 .substring(0, board.MAX_CODE_CHARS);
    if (code) byNumber[row.driver_number] = code;
  }
  return byNumber;
}

/**
 * The gap a timing row describes. OpenF1 gives seconds as a number, but a car
 * a lap down comes through as the string "+1 LAP", so both shapes have to be
 * unpicked before the board can format them.
 */
function parseGap(value) {
  var picked = lastPresent(value);

  if (typeof picked === 'number' && isFinite(picked)) {
    return { gapSeconds: picked, lapsDown: 0 };
  }
  if (typeof picked === 'string') {
    var laps = board.parseLapsDown(picked);
    if (laps) return { gapSeconds: null, lapsDown: laps };
    return { gapSeconds: board.parseClock(picked), lapsDown: 0 };
  }
  return { gapSeconds: null, lapsDown: 0 };
}

function byPosition(a, b) {
  return a.position - b.position;
}

/**
 * Parse the session_result response — the classified order with times — into
 * board entries. Returns an empty array when the session has produced no
 * classification yet, which is normal mid-session and is what sends index.js
 * to the live position/interval endpoints instead.
 */
function parseResults(rows, driverCodes) {
  var codes   = driverCodes || {};
  var entries = [];
  if (!rows) return entries;

  for (var i = 0; i < rows.length; i++) {
    var row = rows[i];
    var position = parseInt(row && row.position, 10);
    if (!isFinite(position) || position < 1 || position > board.PODIUM_SIZE) continue;

    var gap = parseGap(row.gap_to_leader);

    entries.push({
      position:   position,
      code:       codes[row.driver_number] || '',
      seconds:    toSeconds(row.duration),
      gapSeconds: gap.gapSeconds,
      lapsDown:   gap.lapsDown
    });
  }

  entries.sort(byPosition);
  return entries;
}

/**
 * OpenF1's live endpoints are append-only streams — one row per change, oldest
 * first — so the current state of the session is the newest row for each
 * driver. Rows without a usable date fall back to document order, which is
 * already chronological.
 */
function latestByDriver(rows) {
  var latest = {};
  if (!rows) return latest;

  for (var i = 0; i < rows.length; i++) {
    var row = rows[i];
    if (!row || row.driver_number === undefined || row.driver_number === null) continue;

    var previous = latest[row.driver_number];
    if (!previous) {
      latest[row.driver_number] = row;
      continue;
    }

    var rowAt      = toMillis(row.date);
    var previousAt = toMillis(previous.date);
    if (rowAt === null || previousAt === null || rowAt >= previousAt) {
      latest[row.driver_number] = row;
    }
  }
  return latest;
}

/**
 * The live board: the current top three from the position stream, with their
 * gaps from the interval stream.
 *
 * Nobody's absolute time comes over these endpoints, so the leader's cell is
 * blank here — during a live race the useful reading is the order and the gaps,
 * and the status line says LIVE. Once the session is classified, session_result
 * takes over and the times arrive with it.
 */
function buildLiveEntries(positionRows, intervalRows, driverCodes) {
  var codes     = driverCodes || {};
  var positions = latestByDriver(positionRows);
  var intervals = latestByDriver(intervalRows);
  var entries   = [];

  for (var number in positions) {
    if (!Object.prototype.hasOwnProperty.call(positions, number)) continue;

    var position = parseInt(positions[number].position, 10);
    if (!isFinite(position) || position < 1 || position > board.PODIUM_SIZE) continue;

    var interval = intervals[number];
    var gap = parseGap(interval && interval.gap_to_leader);

    entries.push({
      position:   position,
      code:       codes[number] || '',
      seconds:    null,
      gapSeconds: position === 1 ? null : gap.gapSeconds,
      lapsDown:   position === 1 ? 0    : gap.lapsDown
    });
  }

  entries.sort(byPosition);
  return entries;
}

module.exports = {
  BASE_URL: BASE_URL,
  LIVE_GRACE_MS: LIVE_GRACE_MS,
  sessionsUrl: sessionsUrl,
  driversUrl: driversUrl,
  resultsUrl: resultsUrl,
  positionsUrl: positionsUrl,
  intervalsUrl: intervalsUrl,
  authHeaders: authHeaders,
  parseSession: parseSession,
  parseDrivers: parseDrivers,
  parseResults: parseResults,
  latestByDriver: latestByDriver,
  buildLiveEntries: buildLiveEntries
};
