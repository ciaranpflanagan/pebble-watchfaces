'use strict';

// Unit tests for src/pkjs/board.js
// Run with: npm test   (from f1-watchface/)
//
// board.js is the only thing standing between arbitrary API text and a watch
// whose fonts contain a hand-picked subset of characters, so the tests care
// about two things above all: that the strings it emits fit their boxes, and
// that every character in them exists in the font that draws it.

const test = require('node:test');
const assert = require('node:assert');
const { readFileSync } = require('node:fs');

const board = require('../src/pkjs/board.js');

const WATCHFACE_C = readFileSync(__dirname + '/../src/c/f1-watchface.c', 'utf8');
const MANIFEST = JSON.parse(readFileSync(__dirname + '/../package.json', 'utf8'));

/** The characterRegex a font resource was subsetted with, as a RegExp. */
function fontSubset(name) {
  const font = MANIFEST.pebble.resources.media.find((m) => m.name === name);
  assert.ok(font, name + ' is not declared in package.json');
  return new RegExp('^' + font.characterRegex + '+$');
}

// ---------------------------------------------------------------------------
// Text
// ---------------------------------------------------------------------------
test('sanitiseLabel upper-cases, folds accents and drops what the fonts lack', () => {
  assert.strictEqual(board.sanitiseLabel('Zandvoort', 12), 'ZANDVOORT');
  assert.strictEqual(board.sanitiseLabel('São Paulo', 12), 'SAO PAULO');
  assert.strictEqual(board.sanitiseLabel('Montréal', 12), 'MONTREAL');
  assert.strictEqual(board.sanitiseLabel('Nürburgring', 12), 'NURBURGRING');
  // Emoji, punctuation and control characters collapse to a single space.
  assert.strictEqual(board.sanitiseLabel('Monza\t\t(Italy)', 12), 'MONZA ITALY');
});

test('sanitiseLabel truncates to the width of its box, without a trailing space', () => {
  assert.strictEqual(board.sanitiseLabel('Yas Marina Circuit', 12).length <= 12, true);
  assert.strictEqual(board.sanitiseLabel('ABCDE FGHIJKL', 6), 'ABCDE');
  assert.strictEqual(board.sanitiseLabel('', 12), '');
  assert.strictEqual(board.sanitiseLabel(null, 12), '');
  assert.strictEqual(board.sanitiseLabel(undefined, 12), '');
});

test('eventLabel prefers the circuit locality and shortens race names', () => {
  assert.strictEqual(board.eventLabel('Zandvoort', 'Dutch Grand Prix'), 'ZANDVOORT');
  // No locality: the race name has to do, with "Grand Prix" abbreviated.
  assert.strictEqual(board.eventLabel('', 'Dutch Grand Prix'), 'DUTCH GP');
  assert.strictEqual(board.eventLabel(null, 'Miami Grand Prix'), 'MIAMI GP');
  assert.strictEqual(board.eventLabel(null, null), '');
});

test('sessionLabel abbreviates every session a weekend can hold', () => {
  assert.strictEqual(board.sessionLabel('Race'), 'RACE');
  assert.strictEqual(board.sessionLabel('race'), 'RACE');
  assert.strictEqual(board.sessionLabel('Qualifying'), 'QUALI');
  assert.strictEqual(board.sessionLabel('Sprint'), 'SPRINT');
  assert.strictEqual(board.sessionLabel('Sprint Qualifying'), 'SQ');
  assert.strictEqual(board.sessionLabel('Sprint Shootout'), 'SQ');
  assert.strictEqual(board.sessionLabel('Practice 1'), 'FP1');
  assert.strictEqual(board.sessionLabel('Practice 3'), 'FP3');
  assert.strictEqual(board.sessionLabel('FP2'), 'FP2');
});

test('every session label fits the session box', () => {
  for (const name of ['Race', 'Qualifying', 'Sprint', 'Sprint Qualifying',
                      'Practice 1', 'Practice 2', 'Practice 3', 'Something Else']) {
    assert.ok(board.sessionLabel(name).length <= board.MAX_SESSION_CHARS,
              name + ' does not fit the session box');
  }
});

// ---------------------------------------------------------------------------
// Dates
//
// These assertions are built from local Date objects rather than hard-coded
// numbers, so they hold whatever timezone the tests run in — which is the whole
// point of the code under test.
// ---------------------------------------------------------------------------
test('instantOf combines an API date and time into an instant', () => {
  assert.strictEqual(board.instantOf('2026-08-23', '13:00:00Z'),
                     Date.parse('2026-08-23T13:00:00Z'));
  // Schedule entries occasionally arrive without a time; midday UTC keeps the
  // local date right for every offset that matters.
  assert.strictEqual(board.instantOf('2026-08-23', ''),
                     Date.parse('2026-08-23T12:00:00Z'));
  assert.strictEqual(board.instantOf('', '13:00:00Z'), null);
  assert.strictEqual(board.instantOf(null, null), null);
  assert.strictEqual(board.instantOf('not a date', ''), null);
});

test('localDateNumber gives the local calendar date, not the UTC one', () => {
  const local = new Date(2026, 7, 23, 15, 30, 0);
  assert.strictEqual(board.localDateNumber(local.getTime()), 20260823);

  // Just before local midnight and just after it are different days.
  const lateNight  = new Date(2026, 0, 5, 23, 59, 0);
  const afterMidnight = new Date(2026, 0, 6, 0, 1, 0);
  assert.strictEqual(board.localDateNumber(lateNight.getTime()), 20260105);
  assert.strictEqual(board.localDateNumber(afterMidnight.getTime()), 20260106);

  assert.strictEqual(board.localDateNumber(null), 0);
  assert.strictEqual(board.localDateNumber(NaN), 0);
});

test('formatDateRange renders a race weekend, and one that changes month', () => {
  const start = new Date(2026, 8, 4, 10, 0, 0);
  const end   = new Date(2026, 8, 6, 13, 0, 0);
  assert.strictEqual(board.formatDateRange(start.getTime(), end.getTime()), '04-06 SEP');

  const octStart = new Date(2026, 9, 31, 10, 0, 0);
  const novEnd   = new Date(2026, 10, 2, 13, 0, 0);
  assert.strictEqual(board.formatDateRange(octStart.getTime(), novEnd.getTime()),
                     '31OCT-2NOV');
});

test('no next-race row overflows its box', () => {
  // Every date range the calendar can produce, against the width the watch has.
  for (let month = 0; month < 12; month++) {
    for (const day of [1, 9, 10, 28, 30]) {
      const start = new Date(2026, month, day, 10, 0, 0);
      const end = new Date(start.getTime() + 2 * 24 * 60 * 60 * 1000);
      const range = board.formatDateRange(start.getTime(), end.getTime());

      assert.ok(range.length <= board.MAX_NEXT_DATES_CHARS,
                '"' + range + '" is wider than the next-race date box');
    }
  }
});

// ---------------------------------------------------------------------------
// Times
// ---------------------------------------------------------------------------
test('parseClock reads every clock shape the APIs use', () => {
  assert.strictEqual(board.parseClock('58.412'), 58.412);
  assert.strictEqual(board.parseClock('1:11.163'), 71.163);
  assert.strictEqual(board.parseClock('+11.536'), 11.536);
  assert.strictEqual(board.parseClock('2:04:44.859'), 7484.859);
  assert.strictEqual(board.parseClock('+1:05.400'), 65.4);
  assert.strictEqual(board.parseClock(''), null);
  assert.strictEqual(board.parseClock(null), null);
  assert.strictEqual(board.parseClock('+1 Lap'), null);
});

test('parseLapsDown recognises cars a lap or more down', () => {
  assert.strictEqual(board.parseLapsDown('+1 Lap'), 1);
  assert.strictEqual(board.parseLapsDown('+2 Laps'), 2);
  assert.strictEqual(board.parseLapsDown('1 LAP'), 1);
  assert.strictEqual(board.parseLapsDown('Finished'), 0);
  assert.strictEqual(board.parseLapsDown(''), 0);
  assert.strictEqual(board.parseLapsDown(undefined), 0);
});

test('formatLapTime renders laps, and race totals without milliseconds', () => {
  assert.strictEqual(board.formatLapTime(71.163), '1:11.163');
  assert.strictEqual(board.formatLapTime(58.412), '58.412');
  assert.strictEqual(board.formatLapTime(91.5), '1:31.500');
  // A race total has no room for milliseconds in a nine-character column.
  assert.strictEqual(board.formatLapTime(7484.859), '2:04:44');
  assert.strictEqual(board.formatLapTime(null), board.VALUE_UNAVAILABLE);
  assert.strictEqual(board.formatLapTime(-1), board.VALUE_UNAVAILABLE);
  assert.strictEqual(board.formatLapTime('1:11.163'), board.VALUE_UNAVAILABLE);
});

test('formatGap renders deficits, dropping milliseconds past a minute', () => {
  assert.strictEqual(board.formatGap(0.102), '+0.102');
  assert.strictEqual(board.formatGap(11.536), '+11.536');
  assert.strictEqual(board.formatGap(0), '+0.000');
  assert.strictEqual(board.formatGap(65.4), '+1:05');
  assert.strictEqual(board.formatGap(null), board.VALUE_UNAVAILABLE);
});

test('formatLapsDown fits laps down into three characters', () => {
  assert.strictEqual(board.formatLapsDown(1), '+1L');
  assert.strictEqual(board.formatLapsDown(2), '+2L');
  assert.strictEqual(board.formatLapsDown(0), board.VALUE_UNAVAILABLE);
});

test('no formatted time overflows the time column', () => {
  const samples = [];
  for (let seconds = 0; seconds < 9000; seconds += 0.137) {
    samples.push(board.formatLapTime(seconds), board.formatGap(seconds));
  }
  samples.push(board.formatLapsDown(9), board.VALUE_UNAVAILABLE);

  for (const sample of samples) {
    assert.ok(sample.length <= board.MAX_TIME_CHARS,
              '"' + sample + '" is wider than the time column');
  }
});

// ---------------------------------------------------------------------------
// Board assembly
// ---------------------------------------------------------------------------
const QUALIFYING = {
  event: 'Zandvoort',
  session: 'Qualifying',
  entries: [
    { position: '1', code: 'NOR', seconds: 71.163, gapSeconds: null,  lapsDown: 0 },
    { position: '2', code: 'RUS', seconds: 71.265, gapSeconds: 0.102, lapsDown: 0 },
    { position: '4', code: 'PIA', seconds: 71.305, gapSeconds: 0.142, lapsDown: 0 }
  ]
};

test('buildBoard renders a qualifying board as leader plus gaps', () => {
  const built = board.buildBoard(Object.assign({ gapMode: 'gap' }, QUALIFYING));

  assert.strictEqual(built.event, 'ZANDVOORT');
  assert.strictEqual(built.session, 'QUALI');
  assert.deepStrictEqual(built.rows[0], { pos: '1', code: 'NOR', time: '1:11.163' });
  assert.deepStrictEqual(built.rows[1], { pos: '2', code: 'RUS', time: '+0.102' });
  // The third row's position is 4, not 3: a driver was excluded, and the board
  // reports what actually happened rather than renumbering the podium.
  assert.deepStrictEqual(built.rows[2], { pos: '4', code: 'PIA', time: '+0.142' });
});

test('buildBoard in absolute mode gives every row its own time', () => {
  const built = board.buildBoard(Object.assign({ gapMode: 'absolute' }, QUALIFYING));

  assert.strictEqual(built.rows[0].time, '1:11.163');
  assert.strictEqual(built.rows[1].time, '1:11.265');
  assert.strictEqual(built.rows[2].time, '1:11.305');
});

test('buildBoard falls back to a gap when absolute mode has no absolute time', () => {
  const built = board.buildBoard({
    gapMode: 'absolute',
    entries: [
      { position: '1', code: 'VER', seconds: 5400,  gapSeconds: null, lapsDown: 0 },
      { position: '2', code: 'NOR', seconds: null,   gapSeconds: 3.2, lapsDown: 0 },
      { position: '3', code: 'LEC', seconds: null,   gapSeconds: null, lapsDown: 1 }
    ]
  });

  assert.strictEqual(built.rows[1].time, '+3.200');
  assert.strictEqual(built.rows[2].time, '+1L');
});

test('the leader always shows an absolute time, never a gap', () => {
  const built = board.buildBoard({
    gapMode: 'gap',
    entries: [{ position: '1', code: 'VER', seconds: 71.5, gapSeconds: 0, lapsDown: 0 }]
  });
  assert.strictEqual(built.rows[0].time, '1:11.500');
});

test('a short or empty result still fills three rows', () => {
  const built = board.buildBoard({
    event: 'Monza',
    session: 'Practice 1',
    entries: [{ position: '1', code: 'HAM', seconds: 80.001, gapSeconds: null, lapsDown: 0 }]
  });

  assert.strictEqual(built.rows.length, board.PODIUM_SIZE);
  assert.deepStrictEqual(built.rows[1],
    { pos: '2', code: board.CODE_UNAVAILABLE, time: board.VALUE_UNAVAILABLE });
  assert.deepStrictEqual(built.rows[2],
    { pos: '3', code: board.CODE_UNAVAILABLE, time: board.VALUE_UNAVAILABLE });

  const empty = board.emptyBoard();
  assert.strictEqual(empty.event, '');
  assert.strictEqual(empty.rows.length, board.PODIUM_SIZE);
});

test('buildBoard survives junk without throwing', () => {
  for (const junk of [undefined, null, {}, { entries: [null, undefined] },
                      { entries: [{}] }, { event: 42, session: {}, status: [] }]) {
    const built = board.buildBoard(junk);
    assert.strictEqual(built.rows.length, board.PODIUM_SIZE);
  }
});

test('resolveGapMode falls back to the default for anything unknown', () => {
  assert.strictEqual(board.resolveGapMode('gap'), 'gap');
  assert.strictEqual(board.resolveGapMode('absolute'), 'absolute');
  for (const bad of [undefined, null, '', 'nope', 0, {}]) {
    assert.strictEqual(board.resolveGapMode(bad), board.DEFAULT_GAP_MODE);
  }
});

// ---------------------------------------------------------------------------
// Agreement with the watch
// ---------------------------------------------------------------------------
test('everything the board can print exists in the subsetted watch fonts', () => {
  // The fonts on the watch carry only the characters declared in package.json.
  // A glyph outside that set renders as nothing, so a formatting change that
  // introduced, say, a "~" would silently ship a blank cell.
  const timeFont  = fontSubset('SPACE_GROTESK_26');
  const codeFont  = fontSubset('SPACE_MONO_20');
  const labelFont = fontSubset('SPACE_MONO_14');

  const built = board.buildBoard({
    event: 'São Paulo', session: 'Sprint Qualifying',
    gapMode: 'gap',
    entries: [
      { position: '1', code: 'ver', seconds: 7484.859, gapSeconds: null, lapsDown: 0 },
      { position: '2', code: 'NOR', seconds: null, gapSeconds: 65.4, lapsDown: 0 },
      { position: '3', code: 'LEC', seconds: null, gapSeconds: null, lapsDown: 2 }
    ]
  });

  for (const row of built.rows) {
    assert.match(row.time, timeFont, 'time "' + row.time + '" has a glyph the font lacks');
    assert.match(row.code, codeFont, 'code "' + row.code + '" has a glyph the font lacks');
    assert.match(row.pos,  codeFont, 'position "' + row.pos + '" has a glyph the font lacks');
  }
  for (const label of [built.event, built.session]) {
    assert.match(label, labelFont, '"' + label + '" has a glyph the font lacks');
  }

  // The countdown row is drawn in the same font, and its date range is the one
  // string on the face the phone builds from a Date rather than from API text.
  const range = board.formatDateRange(new Date(2026, 9, 31).getTime(),
                                      new Date(2026, 10, 2).getTime());
  assert.match(range, labelFont, '"' + range + '" has a glyph the font lacks');
  assert.match(board.sanitiseLabel('São Paulo', board.MAX_NEXT_LABEL_CHARS), labelFont);

  // The placeholders are drawn by the watch itself as well as sent by the
  // phone, so they have to survive both fonts.
  assert.match(board.VALUE_UNAVAILABLE, timeFont);
  assert.match(board.CODE_UNAVAILABLE, codeFont);
});

test('the placeholders match the ones the watch falls back to', () => {
  const value = WATCHFACE_C.match(/#define\s+VALUE_UNAVAILABLE\s+"([^"]*)"/);
  const code  = WATCHFACE_C.match(/#define\s+CODE_UNAVAILABLE\s+"([^"]*)"/);
  assert.ok(value && code, 'the placeholders are not defined in the C');
  assert.strictEqual(value[1], board.VALUE_UNAVAILABLE);
  assert.strictEqual(code[1], board.CODE_UNAVAILABLE);
});

test('the watch draws as many rows as the board builds', () => {
  const rowCount = WATCHFACE_C.match(/#define\s+ROW_COUNT\s+(\d+)/);
  assert.ok(rowCount, 'ROW_COUNT is not defined in the C');
  assert.strictEqual(parseInt(rowCount[1], 10), board.PODIUM_SIZE);
});

test('every board message key is declared, sent and drawn', () => {
  const INDEX_JS = readFileSync(__dirname + '/../src/pkjs/index.js', 'utf8');
  const keys = MANIFEST.pebble.messageKeys.filter((key) => key.indexOf('F1_') === 0);

  // Nine row strings, plus event, session, the session date and the two halves
  // of the countdown row.
  assert.strictEqual(keys.length, 14);

  for (const key of keys) {
    assert.ok(INDEX_JS.includes(key), key + ' is never sent by index.js');
    assert.ok(WATCHFACE_C.includes('MESSAGE_KEY_' + key),
              key + ' is never read by the watch');
  }
});

test('the watch works out the local date the same way the phone does', () => {
  // The board appears only while these two agree, so a difference in either
  // direction would either hide the board on the day or leave it up a day late.
  const c = WATCHFACE_C.match(
    /static int date_number\(struct tm \*local_tm\) \{([\s\S]*?)\n\}/);
  assert.ok(c, 'date_number is not defined in the C');

  const body = c[1].replace(/\s+/g, ' ');
  assert.match(body, /tm_year \+ 1900\) \* 10000/);
  assert.match(body, /tm_mon \+ 1\) \* 100/);
  assert.match(body, /tm_mday/);

  // And the JS builds the same YYYYMMDD from a local Date.
  assert.strictEqual(board.localDateNumber(new Date(2026, 11, 6, 9, 0).getTime()),
                     20261206);
});
