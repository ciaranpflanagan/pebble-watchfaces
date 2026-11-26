'use strict';

// ---------------------------------------------------------------------------
// Jolpica-F1 — the free, keyless data source, and the default.
//
// Jolpica (https://api.jolpi.ca) is the maintained successor to the Ergast API
// and speaks the same JSON. It publishes *classified results*, not live timing:
// a session appears some time after the chequered flag, occasionally not until
// the following day. The board therefore shows the most recent completed
// session, with its date in the status line so a stale result is never mistaken
// for a live one.
//
// It also only covers the sessions Ergast covered — race, qualifying and sprint.
// Practice never appears. For an actually-live board the user has to switch the
// source to OpenF1 and supply an API key; see openf1.js.
//
// This module is pure: it builds URLs and parses responses. index.js does the
// fetching.
// ---------------------------------------------------------------------------

var board = require('./board.js');

var BASE_URL = 'https://api.jolpi.ca/ergast/f1';

// Only the podium is ever drawn, so ask for three rows and nothing more. The
// responses are a couple of kilobytes each at this limit.
var RESULT_LIMIT = board.PODIUM_SIZE;

// The three session types Jolpica publishes, each with the response key its
// results hide behind and its running order within a weekend. `rank` breaks the
// tie when two categories report the same round: on a sprint weekend the order
// is sprint, then qualifying, then race, so the highest rank present is the
// session that happened most recently.
var CATEGORIES = [
  { key: 'race',       path: 'results',    resultsKey: 'Results',           session: 'Race',       rank: 3 },
  { key: 'qualifying', path: 'qualifying', resultsKey: 'QualifyingResults', session: 'Qualifying', rank: 2 },
  { key: 'sprint',     path: 'sprint',     resultsKey: 'SprintResults',     session: 'Sprint',     rank: 1 }
];

var BY_KEY = {};
for (var i = 0; i < CATEGORIES.length; i++) {
  BY_KEY[CATEGORIES[i].key] = CATEGORIES[i];
}

function category(key) {
  return Object.prototype.hasOwnProperty.call(BY_KEY, key) ? BY_KEY[key] : null;
}

/**
 * The URL for one category. With no round it asks for `current/last`, which
 * Jolpica resolves to the most recent round holding data of that kind; passing
 * a round explicitly is how the caller walks back a weekend when the newest
 * round has not been ingested yet.
 */
function sessionUrl(categoryKey, round) {
  var cat = category(categoryKey);
  if (!cat) return null;

  var where = (round === undefined || round === null || round === '')
    ? 'current/last'
    : 'current/' + round;

  return BASE_URL + '/' + where + '/' + cat.path + '.json?limit=' + RESULT_LIMIT;
}

/** The driver's three-letter code, falling back to their surname's first three. */
function driverCode(driver) {
  if (!driver) return '';
  if (driver.code) return driver.code;
  return String(driver.familyName || '').substring(0, board.MAX_CODE_CHARS);
}

/**
 * Qualifying gives up to three times — one per segment — and a driver's
 * relevant lap is the best one they set in the last segment they reached. Q3
 * for the front-runners, Q2 or Q1 for anyone knocked out earlier.
 */
function bestQualifyingTime(entry) {
  var segments = [entry.Q3, entry.Q2, entry.Q1];
  for (var s = 0; s < segments.length; s++) {
    var seconds = board.parseClock(segments[s]);
    if (seconds !== null) return seconds;
  }
  return null;
}

/**
 * A race or sprint entry's absolute total and gap to the winner.
 *
 * Ergast reports the winner's `Time.time` as their total ("2:04:44.859") and
 * everyone else's as a deficit ("+11.536"), while `Time.millis` is always the
 * absolute total. Drivers a lap or more down have no `Time` at all — their
 * deficit lives in `status` as "+1 Lap".
 */
function raceTiming(entry) {
  var time    = entry.Time || {};
  var millis  = parseInt(time.millis, 10);
  var text    = String(time.time || '');
  var isDeficit = text.charAt(0) === '+';

  return {
    seconds: isFinite(millis) ? millis / 1000
                              : (isDeficit ? null : board.parseClock(text)),
    gapSeconds: isDeficit ? board.parseClock(text) : null,
    lapsDown: board.parseLapsDown(entry.status)
  };
}

/**
 * Parse one category's response into a normalised session, or null when the
 * response holds no results — which is the ordinary state of a category whose
 * session has not run yet this weekend, not an error.
 */
function parseResponse(json, categoryKey) {
  var cat = category(categoryKey);
  if (!cat || !json) return null;

  var table = json.MRData && json.MRData.RaceTable;
  var race  = table && table.Races && table.Races[0];
  if (!race) return null;

  var results = race[cat.resultsKey];
  if (!results || !results.length) return null;

  var isQualifying = (cat.key === 'qualifying');
  var entries = [];

  for (var r = 0; r < results.length && r < board.PODIUM_SIZE; r++) {
    var result = results[r];
    var timing = isQualifying
      ? { seconds: bestQualifyingTime(result), gapSeconds: null, lapsDown: 0 }
      : raceTiming(result);

    entries.push({
      position:   result.position,
      code:       driverCode(result.Driver),
      seconds:    timing.seconds,
      gapSeconds: timing.gapSeconds,
      lapsDown:   timing.lapsDown
    });
  }

  // Qualifying is reported as absolute times only, so the deficits the board
  // shows in gap mode have to be derived from the leader's lap.
  if (isQualifying && entries.length && typeof entries[0].seconds === 'number') {
    for (var e = 1; e < entries.length; e++) {
      if (typeof entries[e].seconds === 'number') {
        entries[e].gapSeconds = entries[e].seconds - entries[0].seconds;
      }
    }
  }

  var location = (race.Circuit && race.Circuit.Location) || {};

  return {
    category: cat.key,
    rank:     cat.rank,
    round:    parseInt(race.round, 10) || 0,
    event:    board.eventLabel(location.locality, race.raceName),
    session:  board.sessionLabel(cat.session),
    // The race's date and time, which is all a results response carries — a
    // qualifying result is stamped with the race's Sunday, not with Saturday.
    // Deciding which day to show the board on therefore needs the round's
    // schedule; see schedule.js.
    raceDate: race.date,
    raceTime: race.time,
    entries:  entries
  };
}

/**
 * The round a response is talking about, even when it carried no results.
 * `current/last` can resolve to a round whose sessions have not been ingested
 * yet, in which case every category comes back empty and the only way back to
 * real data is to ask for the round before this one — which needs its number.
 * Returns 0 when the response does not say.
 */
function responseRound(json) {
  var table = json && json.MRData && json.MRData.RaceTable;
  if (!table) return 0;

  if (table.Races && table.Races[0]) {
    return parseInt(table.Races[0].round, 10) || 0;
  }
  return parseInt(table.round, 10) || 0;
}

/**
 * The most recent of however many parsed sessions came back: highest round
 * first, and within a round the session that runs latest in the weekend.
 * Returns null when every category was empty.
 */
function pickLatest(sessions) {
  var best = null;

  for (var i = 0; i < sessions.length; i++) {
    var candidate = sessions[i];
    if (!candidate) continue;

    if (!best ||
        candidate.round > best.round ||
        (candidate.round === best.round && candidate.rank > best.rank)) {
      best = candidate;
    }
  }

  return best;
}

module.exports = {
  BASE_URL: BASE_URL,
  CATEGORIES: CATEGORIES,
  RESULT_LIMIT: RESULT_LIMIT,
  sessionUrl: sessionUrl,
  parseResponse: parseResponse,
  responseRound: responseRound,
  pickLatest: pickLatest
};
