'use strict';

// Unit tests for src/pkjs/schedule.js
// Run with: npm test   (from f1-watchface/)
//
// The fixture is a trimmed copy of a real api.jolpi.ca current/next response.
// The thing these tests are really guarding is the reason the module exists: a
// qualifying *result* is stamped with the race's date, so only the schedule
// knows that qualifying ran on the Saturday.

const test = require('node:test');
const assert = require('node:assert');

const schedule = require('../src/pkjs/schedule.js');
const board = require('../src/pkjs/board.js');

const NEXT_RESPONSE = {
  MRData: {
    RaceTable: {
      season: '2026', round: '13',
      Races: [{
        season: '2026', round: '13', raceName: 'Italian Grand Prix',
        Circuit: {
          circuitId: 'monza',
          circuitName: 'Autodromo Nazionale di Monza',
          Location: { lat: '45.6156', long: '9.28111', locality: 'Monza', country: 'Italy' }
        },
        date: '2026-09-06', time: '13:00:00Z',
        FirstPractice:  { date: '2026-09-04', time: '10:30:00Z' },
        SecondPractice: { date: '2026-09-04', time: '14:00:00Z' },
        ThirdPractice:  { date: '2026-09-05', time: '10:30:00Z' },
        Qualifying:     { date: '2026-09-05', time: '14:00:00Z' }
      }]
    }
  }
};

const EMPTY_RESPONSE = { MRData: { RaceTable: { season: '2026', Races: [] } } };

test('the URLs point at the next race and at a given round', () => {
  assert.strictEqual(schedule.nextRaceUrl(),
    'https://api.jolpi.ca/ergast/f1/current/next.json');
  assert.strictEqual(schedule.roundUrl(13),
    'https://api.jolpi.ca/ergast/f1/current/13.json');
});

test('a round parses into its circuit, its sessions and its window', () => {
  const round = schedule.parseRound(NEXT_RESPONSE);

  assert.strictEqual(round.round, 13);
  assert.strictEqual(round.label, 'MONZA');
  assert.strictEqual(round.startsAt, Date.parse('2026-09-04T10:30:00Z'));
  assert.strictEqual(round.endsAt, Date.parse('2026-09-06T13:00:00Z'));
});

test('qualifying is dated by the schedule, not by the race it belongs to', () => {
  // This is the bug the module exists to avoid: the qualifying *result* carries
  // Sunday's date, and taking that at face value would put Saturday's pole
  // position on screen a day late.
  const round = schedule.parseRound(NEXT_RESPONSE);

  assert.strictEqual(schedule.sessionInstant(round, 'qualifying'),
                     Date.parse('2026-09-05T14:00:00Z'));
  assert.strictEqual(schedule.sessionInstant(round, 'race'),
                     Date.parse('2026-09-06T13:00:00Z'));
  assert.notStrictEqual(schedule.sessionInstant(round, 'qualifying'),
                        schedule.sessionInstant(round, 'race'));
});

test('a session the round does not hold has no instant', () => {
  const round = schedule.parseRound(NEXT_RESPONSE);

  // Monza is not a sprint weekend.
  assert.strictEqual(schedule.sessionInstant(round, 'sprint'), null);
  assert.strictEqual(schedule.sessionInstant(null, 'race'), null);
});

test('sprint qualifying is found under either name Ergast has used', () => {
  function sprintRound(key) {
    return {
      MRData: { RaceTable: { Races: [{
        round: '21', raceName: 'São Paulo Grand Prix',
        Circuit: { Location: { locality: 'São Paulo' } },
        date: '2026-11-08', time: '17:00:00Z',
        Sprint: { date: '2026-11-07', time: '14:00:00Z' },
        [key]: { date: '2026-11-07', time: '10:30:00Z' }
      }] } }
    };
  }

  for (const key of ['SprintQualifying', 'SprintShootout']) {
    const round = schedule.parseRound(sprintRound(key));
    assert.strictEqual(round.sessions.sprintQuali, Date.parse('2026-11-07T10:30:00Z'),
                       key + ' was not recognised');
    assert.strictEqual(schedule.sessionInstant(round, 'sprint'),
                       Date.parse('2026-11-07T14:00:00Z'));
    // The weekend still starts at its earliest session.
    assert.strictEqual(round.startsAt, Date.parse('2026-11-07T10:30:00Z'));
    assert.strictEqual(round.label, 'SAO PAULO');
  }
});

test('a round with only a race date is a one-day window', () => {
  const bare = { MRData: { RaceTable: { Races: [{
    round: '1', raceName: 'Bahrain Grand Prix',
    Circuit: { Location: { locality: 'Sakhir' } },
    date: '2026-03-08', time: '15:00:00Z'
  }] } } };
  const round = schedule.parseRound(bare);

  assert.strictEqual(round.startsAt, round.endsAt);
  // The same day at both ends, whatever timezone the tests run in.
  const dates = schedule.nextRaceRow(round).dates;
  const sameDay = /^(\d{2})-(\d{2}) MAR$/.exec(dates);
  assert.ok(sameDay, dates + ' is not a date range');
  assert.strictEqual(sameDay[1], sameDay[2]);
});

test('parseRound returns null once the season is over', () => {
  assert.strictEqual(schedule.parseRound(EMPTY_RESPONSE), null);
  assert.strictEqual(schedule.parseRound(null), null);
  assert.strictEqual(schedule.parseRound({}), null);
});

test('the countdown row names the circuit and the days it runs', () => {
  const row = schedule.nextRaceRow(schedule.parseRound(NEXT_RESPONSE));

  assert.strictEqual(row.label, 'MONZA');
  // Not pinned to exact days: the range is rendered in the wearer's local time,
  // so a UTC+13 reader sees the weekend a day later than a UTC-7 one.
  assert.match(row.dates, /^\d{2}-\d{2} SEP$/);
  assert.ok(row.label.length <= board.MAX_NEXT_LABEL_CHARS);
  assert.ok(row.dates.length <= board.MAX_NEXT_DATES_CHARS);
});

test('the countdown row is blank when there is no next race', () => {
  // Blank is how the watch is told the season is over, rather than the fetch
  // having failed — there is nothing truthful to put there.
  assert.deepStrictEqual(schedule.nextRaceRow(null), { label: '', dates: '' });
  assert.deepStrictEqual(schedule.nextRaceRow(schedule.parseRound(EMPTY_RESPONSE)),
                         { label: '', dates: '' });
});
