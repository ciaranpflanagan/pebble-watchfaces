'use strict';

// Unit tests for src/pkjs/jolpica.js
// Run with: npm test   (from f1-watchface/)
//
// The fixtures below are trimmed copies of real api.jolpi.ca responses, kept
// verbatim in shape — including the qualifying result whose third row is
// position 4, which is exactly the kind of thing a hand-written fixture would
// have tidied away.

const test = require('node:test');
const assert = require('node:assert');

const jolpica = require('../src/pkjs/jolpica.js');
const board = require('../src/pkjs/board.js');

const CIRCUIT = {
  circuitId: 'zandvoort',
  circuitName: 'Circuit Park Zandvoort',
  Location: { lat: '52.3888', long: '4.54092', locality: 'Zandvoort', country: 'Netherlands' }
};

function race(fields) {
  return Object.assign({
    season: '2026', round: '12', raceName: 'Dutch Grand Prix',
    Circuit: CIRCUIT, date: '2026-08-23', time: '13:00:00Z'
  }, fields);
}

function response(fields) {
  return { MRData: { RaceTable: { season: '2026', round: '12', Races: [race(fields)] } } };
}

const RACE_RESPONSE = response({
  Results: [
    {
      number: '1', position: '1', points: '25',
      Driver: { driverId: 'norris', code: 'NOR', familyName: 'Norris' },
      Constructor: { constructorId: 'mclaren' },
      grid: '1', laps: '72', status: 'Finished',
      Time: { millis: '7484859', time: '2:04:44.859' }
    },
    {
      number: '12', position: '2', points: '18',
      Driver: { driverId: 'antonelli', code: 'ANT', familyName: 'Antonelli' },
      Constructor: { constructorId: 'mercedes' },
      grid: '3', laps: '72', status: 'Finished',
      Time: { millis: '7496395', time: '+11.536' }
    },
    {
      number: '63', position: '3', points: '15',
      Driver: { driverId: 'russell', code: 'RUS', familyName: 'Russell' },
      Constructor: { constructorId: 'mercedes' },
      grid: '2', laps: '72', status: 'Finished',
      Time: { millis: '7500765', time: '+15.906' }
    }
  ]
});

const QUALIFYING_RESPONSE = response({
  QualifyingResults: [
    {
      number: '1', position: '1',
      Driver: { driverId: 'norris', code: 'NOR', familyName: 'Norris' },
      Q1: '1:12.695', Q2: '1:11.628', Q3: '1:11.163'
    },
    {
      number: '63', position: '2',
      Driver: { driverId: 'russell', code: 'RUS', familyName: 'Russell' },
      Q1: '1:12.924', Q2: '1:11.959', Q3: '1:11.265'
    },
    {
      // Really is position 4 in the source data — position 3 was excluded.
      number: '81', position: '4',
      Driver: { driverId: 'piastri', code: 'PIA', familyName: 'Piastri' },
      Q1: '1:12.610', Q2: '1:11.641', Q3: '1:11.305'
    }
  ]
});

const EMPTY_RESPONSE = {
  MRData: { RaceTable: { season: '2026', round: '13', Races: [] } }
};

// ---------------------------------------------------------------------------
// URLs
// ---------------------------------------------------------------------------
test('sessionUrl asks for the last round of each category, three rows deep', () => {
  assert.strictEqual(jolpica.sessionUrl('race'),
    'https://api.jolpi.ca/ergast/f1/current/last/results.json?limit=3');
  assert.strictEqual(jolpica.sessionUrl('qualifying'),
    'https://api.jolpi.ca/ergast/f1/current/last/qualifying.json?limit=3');
  assert.strictEqual(jolpica.sessionUrl('sprint'),
    'https://api.jolpi.ca/ergast/f1/current/last/sprint.json?limit=3');
});

test('sessionUrl takes an explicit round, for walking back a weekend', () => {
  assert.strictEqual(jolpica.sessionUrl('race', 12),
    'https://api.jolpi.ca/ergast/f1/current/12/results.json?limit=3');
});

test('sessionUrl refuses a category it does not know', () => {
  assert.strictEqual(jolpica.sessionUrl('practice'), null);
  assert.strictEqual(jolpica.sessionUrl(undefined), null);
});

test('the request limit matches the number of rows the board draws', () => {
  assert.strictEqual(jolpica.RESULT_LIMIT, board.PODIUM_SIZE);
});

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------
test('a race parses into a winner with a total time and gaps behind', () => {
  const session = jolpica.parseResponse(RACE_RESPONSE, 'race');

  assert.strictEqual(session.event, 'ZANDVOORT');
  assert.strictEqual(session.session, 'RACE');
  assert.strictEqual(session.round, 12);
  // The race's own stamp, which for a race is the session's too.
  assert.strictEqual(session.raceDate, '2026-08-23');
  assert.strictEqual(session.raceTime, '13:00:00Z');

  const built = board.buildBoard(Object.assign({ gapMode: 'gap' }, session));
  assert.deepStrictEqual(built.rows[0], { pos: '1', code: 'NOR', time: '2:04:44' });
  assert.deepStrictEqual(built.rows[1], { pos: '2', code: 'ANT', time: '+11.536' });
  assert.deepStrictEqual(built.rows[2], { pos: '3', code: 'RUS', time: '+15.906' });
});

test('a race in absolute mode uses the millis Ergast gives for every finisher', () => {
  const session = jolpica.parseResponse(RACE_RESPONSE, 'race');
  const built = board.buildBoard(Object.assign({ gapMode: 'absolute' }, session));

  assert.strictEqual(built.rows[1].time, '2:04:56');
  assert.strictEqual(built.rows[2].time, '2:05:00');
});

test('qualifying carries the race\'s date, which is why schedule.js exists', () => {
  // Saturday's qualifying comes back stamped with Sunday's race date. Nothing
  // here can fix that; the round's schedule is the only source of the real
  // session time, and index.js goes and gets it.
  const session = jolpica.parseResponse(QUALIFYING_RESPONSE, 'qualifying');

  assert.strictEqual(session.category, 'qualifying');
  assert.strictEqual(session.raceDate, '2026-08-23');
});

test('qualifying takes each driver\'s best segment and derives the gaps', () => {
  const session = jolpica.parseResponse(QUALIFYING_RESPONSE, 'qualifying');
  const built = board.buildBoard(Object.assign({ gapMode: 'gap' }, session));

  assert.strictEqual(session.session, 'QUALI');
  assert.deepStrictEqual(built.rows[0], { pos: '1', code: 'NOR', time: '1:11.163' });
  assert.deepStrictEqual(built.rows[1], { pos: '2', code: 'RUS', time: '+0.102' });
  // Position 4, reported as such rather than renumbered to 3.
  assert.deepStrictEqual(built.rows[2], { pos: '4', code: 'PIA', time: '+0.142' });
});

test('qualifying falls back to Q2 then Q1 for a driver knocked out early', () => {
  const knockedOut = response({
    QualifyingResults: [
      { position: '1', Driver: { code: 'VER' }, Q1: '1:12.695', Q2: '1:11.628', Q3: '1:11.163' },
      { position: '2', Driver: { code: 'HAM' }, Q1: '1:12.924', Q2: '1:11.959' },
      { position: '3', Driver: { code: 'ALO' }, Q1: '1:13.100' }
    ]
  });
  const session = jolpica.parseResponse(knockedOut, 'qualifying');

  assert.strictEqual(Math.round(session.entries[1].seconds * 1000), 71959);
  assert.strictEqual(Math.round(session.entries[2].seconds * 1000), 73100);
});

test('a driver a lap down is reported as laps, not as a nonsense gap', () => {
  const lapped = response({
    Results: [
      {
        position: '1', Driver: { code: 'VER' }, status: 'Finished',
        Time: { millis: '5400000', time: '1:30:00.000' }
      },
      { position: '2', Driver: { code: 'STR' }, status: '+1 Lap' },
      { position: '3', Driver: { code: 'OCO' }, status: '+2 Laps' }
    ]
  });
  const built = board.buildBoard(
    Object.assign({ gapMode: 'gap' }, jolpica.parseResponse(lapped, 'race')));

  assert.strictEqual(built.rows[1].time, '+1L');
  assert.strictEqual(built.rows[2].time, '+2L');
});

test('a driver with no code falls back to the first three of their surname', () => {
  const noCode = response({
    Results: [{ position: '1', Driver: { familyName: 'Bortoleto' }, status: 'Finished',
                Time: { millis: '5400000', time: '1:30:00.000' } }]
  });
  assert.strictEqual(jolpica.parseResponse(noCode, 'race').entries[0].code, 'Bor');
});

test('parseResponse returns null rather than an empty board', () => {
  assert.strictEqual(jolpica.parseResponse(EMPTY_RESPONSE, 'race'), null);
  assert.strictEqual(jolpica.parseResponse(response({}), 'race'), null);
  assert.strictEqual(jolpica.parseResponse(null, 'race'), null);
  assert.strictEqual(jolpica.parseResponse({}, 'race'), null);
  assert.strictEqual(jolpica.parseResponse(RACE_RESPONSE, 'practice'), null);
  // A race response holds no qualifying results, and vice versa.
  assert.strictEqual(jolpica.parseResponse(RACE_RESPONSE, 'qualifying'), null);
});

// ---------------------------------------------------------------------------
// Choosing between sessions
// ---------------------------------------------------------------------------
test('pickLatest prefers the newest round', () => {
  const older = jolpica.parseResponse(RACE_RESPONSE, 'race');
  const newer = Object.assign({}, jolpica.parseResponse(QUALIFYING_RESPONSE, 'qualifying'),
                              { round: 13 });

  assert.strictEqual(jolpica.pickLatest([older, newer]), newer);
  assert.strictEqual(jolpica.pickLatest([newer, older]), newer);
});

test('within a round, pickLatest follows the running order of the weekend', () => {
  // Sprint, then qualifying, then the race — so whichever is furthest down that
  // list is the session that has just happened.
  const raceSession  = jolpica.parseResponse(RACE_RESPONSE, 'race');
  const qualiSession = jolpica.parseResponse(QUALIFYING_RESPONSE, 'qualifying');
  const sprintSession = jolpica.parseResponse(
    response({ SprintResults: [{ position: '1', Driver: { code: 'RUS' }, status: 'Finished',
                                 Time: { millis: '1800000', time: '30:00.000' } }] }), 'sprint');

  assert.strictEqual(jolpica.pickLatest([sprintSession, qualiSession, raceSession]), raceSession);
  assert.strictEqual(jolpica.pickLatest([sprintSession, qualiSession]), qualiSession);
  assert.strictEqual(jolpica.pickLatest([sprintSession]), sprintSession);
});

test('pickLatest returns null when every category was empty', () => {
  assert.strictEqual(jolpica.pickLatest([]), null);
  assert.strictEqual(jolpica.pickLatest([null, null]), null);
});

test('responseRound finds the round even in an empty response', () => {
  // This is what makes the walk back to the previous round possible when
  // current/last has resolved to a weekend that has not run yet.
  assert.strictEqual(jolpica.responseRound(EMPTY_RESPONSE), 13);
  assert.strictEqual(jolpica.responseRound(RACE_RESPONSE), 12);
  assert.strictEqual(jolpica.responseRound(null), 0);
  assert.strictEqual(jolpica.responseRound({}), 0);
});
