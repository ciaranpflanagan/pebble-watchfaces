'use strict';

// Unit tests for src/pkjs/openf1.js
// Run with: npm test   (from f1-watchface/)
//
// OpenF1 shapes are awkward in two specific ways, and both are what these tests
// are really about: qualifying values arrive as per-segment arrays, and a car a
// lap down arrives as a string where every other row has a number.

const test = require('node:test');
const assert = require('node:assert');

const openf1 = require('../src/pkjs/openf1.js');
const board = require('../src/pkjs/board.js');

const SESSION_ROW = {
  session_key: 9999,
  session_name: 'Qualifying',
  session_type: 'Qualifying',
  date_start: '2026-09-05T14:00:00+00:00',
  date_end: '2026-09-05T15:00:00+00:00',
  circuit_short_name: 'Monza',
  country_name: 'Italy',
  location: 'Monza',
  year: 2026
};

const DRIVER_ROWS = [
  { driver_number: 4,  name_acronym: 'NOR', last_name: 'Norris' },
  { driver_number: 63, name_acronym: 'RUS', last_name: 'Russell' },
  { driver_number: 81, name_acronym: 'PIA', last_name: 'Piastri' }
];

const AT = Date.parse('2026-09-05T14:30:00Z');

// ---------------------------------------------------------------------------
// URLs and auth
// ---------------------------------------------------------------------------
test('the URLs point at the latest session and ask only for the podium', () => {
  assert.strictEqual(openf1.sessionsUrl(),
    'https://api.openf1.org/v1/sessions?session_key=latest');
  assert.strictEqual(openf1.resultsUrl(),
    'https://api.openf1.org/v1/session_result?session_key=latest&position<=3');
});

test('an API key becomes a bearer token, and no key becomes no header', () => {
  assert.deepStrictEqual(openf1.authHeaders('abc123'), { Authorization: 'Bearer abc123' });
  assert.deepStrictEqual(openf1.authHeaders(''), {});
  assert.deepStrictEqual(openf1.authHeaders(null), {});
  assert.deepStrictEqual(openf1.authHeaders(undefined), {});
  assert.deepStrictEqual(openf1.authHeaders('  abc  '), { Authorization: 'Bearer abc' });
});

// ---------------------------------------------------------------------------
// Sessions
// ---------------------------------------------------------------------------
test('a session inside its window is live, and says so', () => {
  const session = openf1.parseSession([SESSION_ROW], AT);

  assert.strictEqual(session.live, true);
  assert.strictEqual(session.event, 'MONZA');
  // OpenF1 stamps the session itself, so this is the day the board belongs on.
  assert.strictEqual(session.startsAt, Date.parse('2026-09-05T14:00:00Z'));
  assert.strictEqual(session.session, 'QUALI');
  assert.strictEqual(session.sessionKey, 9999);
});

test('a session running past its scheduled end is still live', () => {
  // Safety cars and red flags routinely push a session past its published end;
  // flipping the status line to a date mid-race would be wrong.
  const justOver = Date.parse('2026-09-05T15:20:00Z');
  assert.strictEqual(openf1.parseSession([SESSION_ROW], justOver).live, true);

  const wellOver = Date.parse('2026-09-05T16:30:00Z');
  const finished = openf1.parseSession([SESSION_ROW], wellOver);
  assert.strictEqual(finished.live, false);
  // Still stamped with when it ran: the board stays up for the rest of that day.
  assert.strictEqual(finished.startsAt, Date.parse('2026-09-05T14:00:00Z'));
});

test('a session that has not started yet is not live', () => {
  const before = Date.parse('2026-09-05T09:00:00Z');
  assert.strictEqual(openf1.parseSession([SESSION_ROW], before).live, false);
});

test('parseSession returns null when there is no session', () => {
  assert.strictEqual(openf1.parseSession([], AT), null);
  assert.strictEqual(openf1.parseSession(null, AT), null);
});

// ---------------------------------------------------------------------------
// Drivers
// ---------------------------------------------------------------------------
test('drivers are indexed by number, falling back to a surname', () => {
  const codes = openf1.parseDrivers(DRIVER_ROWS.concat([
    { driver_number: 44, last_name: 'Hamilton' },
    { driver_number: null, name_acronym: 'XXX' }
  ]));

  assert.strictEqual(codes[4], 'NOR');
  assert.strictEqual(codes[44], 'Ham');
  assert.deepStrictEqual(openf1.parseDrivers(null), {});
});

// ---------------------------------------------------------------------------
// Classified results
// ---------------------------------------------------------------------------
test('a qualifying result takes the last segment each driver reached', () => {
  // duration and gap_to_leader come through as [Q1, Q2, Q3], with nulls for
  // segments a driver never got to.
  const rows = [
    { position: 1, driver_number: 4,  duration: [72.695, 71.628, 71.163], gap_to_leader: [null, null, 0] },
    { position: 2, driver_number: 63, duration: [72.924, 71.959, 71.265], gap_to_leader: [null, null, 0.102] },
    { position: 3, driver_number: 81, duration: [72.610, 71.641, null],   gap_to_leader: [null, 0.013, null] }
  ];
  const entries = openf1.parseResults(rows, openf1.parseDrivers(DRIVER_ROWS));
  const built = board.buildBoard({ entries: entries, gapMode: 'gap' });

  assert.deepStrictEqual(built.rows[0], { pos: '1', code: 'NOR', time: '1:11.163' });
  assert.deepStrictEqual(built.rows[1], { pos: '2', code: 'RUS', time: '+0.102' });
  // Never set a Q3 time: their Q2 lap and Q2 gap are what stand.
  assert.deepStrictEqual(built.rows[2], { pos: '3', code: 'PIA', time: '+0.013' });
});

test('results outside the podium and without a position are ignored', () => {
  const entries = openf1.parseResults([
    { position: 2, driver_number: 63, duration: 71.265, gap_to_leader: 0.102 },
    { position: 1, driver_number: 4,  duration: 71.163, gap_to_leader: 0 },
    { position: 9, driver_number: 81, duration: 72.001, gap_to_leader: 0.838 },
    { position: null, driver_number: 44 }
  ], openf1.parseDrivers(DRIVER_ROWS));

  assert.strictEqual(entries.length, 2);
  // Sorted by position regardless of the order they arrived in.
  assert.strictEqual(entries[0].position, 1);
  assert.strictEqual(entries[1].position, 2);
});

test('a lapped car in the results reads as laps down', () => {
  const entries = openf1.parseResults([
    { position: 1, driver_number: 4,  duration: 5400.0, gap_to_leader: 0 },
    { position: 2, driver_number: 63, duration: null,   gap_to_leader: '+1 LAP' }
  ], openf1.parseDrivers(DRIVER_ROWS));

  assert.strictEqual(entries[1].lapsDown, 1);
  assert.strictEqual(entries[1].gapSeconds, null);
  assert.strictEqual(board.buildBoard({ entries: entries }).rows[1].time, '+1L');
});

test('parseResults returns nothing when the session has no classification', () => {
  assert.deepStrictEqual(openf1.parseResults([], {}), []);
  assert.deepStrictEqual(openf1.parseResults(null, {}), []);
});

// ---------------------------------------------------------------------------
// Live streams
// ---------------------------------------------------------------------------
test('latestByDriver keeps the newest row for each driver', () => {
  const rows = [
    { driver_number: 4,  position: 2, date: '2026-09-05T14:10:00Z' },
    { driver_number: 63, position: 1, date: '2026-09-05T14:10:00Z' },
    { driver_number: 4,  position: 1, date: '2026-09-05T14:20:00Z' },
    { driver_number: 63, position: 2, date: '2026-09-05T14:20:00Z' }
  ];
  const latest = openf1.latestByDriver(rows);

  assert.strictEqual(latest[4].position, 1);
  assert.strictEqual(latest[63].position, 2);
  assert.deepStrictEqual(openf1.latestByDriver(null), {});
});

test('the live board is the current order with gaps, and no leader time', () => {
  // The position and interval streams carry no absolute times, so the leader's
  // cell is honestly blank; the order and the gaps are the live story.
  const positions = [
    { driver_number: 81, position: 1, date: '2026-09-05T14:05:00Z' },
    { driver_number: 4,  position: 1, date: '2026-09-05T14:20:00Z' },
    { driver_number: 81, position: 2, date: '2026-09-05T14:20:00Z' },
    { driver_number: 63, position: 3, date: '2026-09-05T14:20:00Z' },
    { driver_number: 44, position: 7, date: '2026-09-05T14:20:00Z' }
  ];
  const intervals = [
    { driver_number: 4,  gap_to_leader: 0,     date: '2026-09-05T14:20:00Z' },
    { driver_number: 81, gap_to_leader: 1.204, date: '2026-09-05T14:20:00Z' },
    { driver_number: 63, gap_to_leader: 4.9,   date: '2026-09-05T14:20:00Z' }
  ];

  const entries = openf1.buildLiveEntries(positions, intervals, openf1.parseDrivers(DRIVER_ROWS));
  const built = board.buildBoard({ entries: entries, gapMode: 'gap' });

  assert.strictEqual(entries.length, 3);
  assert.deepStrictEqual(built.rows[0], { pos: '1', code: 'NOR', time: board.VALUE_UNAVAILABLE });
  assert.deepStrictEqual(built.rows[1], { pos: '2', code: 'PIA', time: '+1.204' });
  assert.deepStrictEqual(built.rows[2], { pos: '3', code: 'RUS', time: '+4.900' });
});

test('the live board copes with intervals that have not arrived yet', () => {
  const positions = [{ driver_number: 4, position: 1, date: '2026-09-05T14:20:00Z' },
                     { driver_number: 63, position: 2, date: '2026-09-05T14:20:00Z' }];
  const entries = openf1.buildLiveEntries(positions, [], openf1.parseDrivers(DRIVER_ROWS));

  assert.strictEqual(entries.length, 2);
  assert.strictEqual(entries[1].gapSeconds, null);
  assert.strictEqual(board.buildBoard({ entries: entries }).rows[1].time,
                     board.VALUE_UNAVAILABLE);
});

test('the live board is empty when nobody has a podium position', () => {
  assert.deepStrictEqual(openf1.buildLiveEntries([], [], {}), []);
  assert.deepStrictEqual(openf1.buildLiveEntries(null, null, null), []);
});
