'use strict';

// ---------------------------------------------------------------------------
// The calendar.
//
// Two jobs, both fed by Jolpica's schedule endpoints (same Ergast shape as the
// results):
//
//   1. The next race, for the countdown row — "MONZA  05-07 SEP".
//   2. When each session of a round actually starts.
//
// The second is not a nicety. A results response is keyed by the *race*: a
// qualifying result carries the race's date and time, not qualifying's own, so
// Saturday's pole position comes back stamped Sunday. Since the board is only
// shown on the day of its session, taking that date at face value would put
// qualifying on screen a day late. The schedule is the only place the real
// session time exists.
//
// This module is pure: it builds URLs and parses responses. index.js does the
// fetching.
// ---------------------------------------------------------------------------

var board = require('./board.js');

var BASE_URL = 'https://api.jolpi.ca/ergast/f1';

// The schedule entries a round can carry, mapped to the results categories in
// jolpica.js. Ergast has used two names for sprint qualifying over the years
// and both still appear in historical data.
var SESSION_KEYS = {
  race:        ['__race__'],          // the race's own date/time, on the round itself
  qualifying:  ['Qualifying'],
  sprint:      ['Sprint'],
  sprintQuali: ['SprintQualifying', 'SprintShootout'],
  practice1:   ['FirstPractice'],
  practice2:   ['SecondPractice'],
  practice3:   ['ThirdPractice']
};

/** The next race that has not run yet, with its full session schedule. */
function nextRaceUrl() {
  return BASE_URL + '/current/next.json';
}

/** One round's schedule, for a session whose results have already arrived. */
function roundUrl(round) {
  return BASE_URL + '/current/' + round + '.json';
}

function instantFromEntry(entry) {
  return entry ? board.instantOf(entry.date, entry.time) : null;
}

/**
 * Parse a schedule response into a round: its circuit, when each of its
 * sessions starts, and the window the weekend spans. Returns null for the
 * empty response Jolpica gives once the season is over.
 */
function parseRound(json) {
  var table = json && json.MRData && json.MRData.RaceTable;
  var race  = table && table.Races && table.Races[0];
  if (!race) return null;

  var sessions = {};
  for (var category in SESSION_KEYS) {
    if (!Object.prototype.hasOwnProperty.call(SESSION_KEYS, category)) continue;

    var names = SESSION_KEYS[category];
    for (var i = 0; i < names.length; i++) {
      var instant = (names[i] === '__race__')
        ? board.instantOf(race.date, race.time)
        : instantFromEntry(race[names[i]]);

      if (instant !== null) {
        sessions[category] = instant;
        break;
      }
    }
  }

  // The weekend runs from its earliest session to the race. A round with no
  // practice times published yet is just a one-day window on the race.
  var earliest = sessions.race === undefined ? null : sessions.race;
  for (var key in sessions) {
    if (!Object.prototype.hasOwnProperty.call(sessions, key)) continue;
    if (earliest === null || sessions[key] < earliest) earliest = sessions[key];
  }

  var location = (race.Circuit && race.Circuit.Location) || {};

  return {
    round:    parseInt(race.round, 10) || 0,
    label:    board.sanitiseLabel(board.eventLabel(location.locality, race.raceName),
                                  board.MAX_NEXT_LABEL_CHARS),
    sessions: sessions,
    startsAt: earliest,
    endsAt:   sessions.race === undefined ? earliest : sessions.race
  };
}

/**
 * When a round's session of a given results category starts, or null if the
 * schedule does not say. `category` is a jolpica.js key: race, qualifying or
 * sprint.
 */
function sessionInstant(round, category) {
  if (!round || !round.sessions) return null;

  var instant = round.sessions[category];
  return instant === undefined ? null : instant;
}

/**
 * The countdown row: the circuit on the left and the dates it runs on the
 * right. Both are blank when there is no next race, which is how the watch is
 * told the season is over rather than the fetch having failed.
 */
function nextRaceRow(round) {
  if (!round || round.startsAt === null) return { label: '', dates: '' };

  return {
    label: round.label,
    dates: board.sanitiseLabel(board.formatDateRange(round.startsAt, round.endsAt),
                               board.MAX_NEXT_DATES_CHARS)
  };
}

module.exports = {
  BASE_URL: BASE_URL,
  SESSION_KEYS: SESSION_KEYS,
  nextRaceUrl: nextRaceUrl,
  roundUrl: roundUrl,
  parseRound: parseRound,
  sessionInstant: sessionInstant,
  nextRaceRow: nextRaceRow
};
