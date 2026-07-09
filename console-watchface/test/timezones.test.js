'use strict';

// Unit tests for src/pkjs/timezones.js
// Run with: npm test   (from console-watchface/)
//
// These run under Node, not on the watch, so Intl is always present here. That
// lets us treat Intl as the reference implementation and assert that the static
// offset table in timezones.js agrees with the real tz database.
//
// timezones.js must never call Intl (or any other ICU-backed builtin) itself:
// the emulator's V8 has no ICU data and hard-aborts the process. There is a
// test below that guards against it creeping back in.

const test = require('node:test');
const assert = require('node:assert');
const { readFileSync } = require('node:fs');

const tz = require('../src/pkjs/timezones.js');

// The 15th of any month is comfortably clear of every DST changeover we model
// (EU: late Mar/Oct, US: 2nd Sun Mar + 1st Sun Nov, AU: 1st Sun Apr/Oct,
// NZ: 1st Sun Apr + last Sun Sep), so exact agreement is a fair expectation.
const SAFE_SAMPLE_DAY = 15;
const SAMPLE_YEARS = [2026, 2027, 2028, 2029, 2030];

/** Reference offset for a zone at an instant, straight from Intl. */
function referenceOffsetMinutes(zone, date) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: zone,
    hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(date);

  const wall = {};
  for (const { type, value } of parts) wall[type] = value;
  const hour = parseInt(wall.hour, 10) % 24;

  const wallClockAsUtc = Date.UTC(
    parseInt(wall.year, 10),
    parseInt(wall.month, 10) - 1,
    parseInt(wall.day, 10),
    hour,
    parseInt(wall.minute, 10),
    parseInt(wall.second, 10),
  );
  return Math.round((wallClockAsUtc - date.getTime()) / 60000);
}

test('every zone is a timezone name Intl accepts', () => {
  for (const { zone } of tz.ZONES) {
    assert.doesNotThrow(
      () => new Intl.DateTimeFormat('en-US', { timeZone: zone }),
      `Intl rejected zone "${zone}"`,
    );
  }
});

test('the dropdown covers every whole hour offset from UTC-11 to UTC+13', () => {
  const hours = new Set();
  for (const zone of tz.ZONES) {
    for (const offset of [zone.std, zone.dst]) {
      if (offset !== undefined && offset % 60 === 0) hours.add(offset / 60);
    }
  }
  const gaps = [];
  for (let hour = -11; hour <= 13; hour++) {
    if (!hours.has(hour)) gaps.push(hour);
  }
  assert.deepStrictEqual(gaps, [], `uncovered UTC offsets: ${gaps.join(', ')}`);
});

test('the dropdown covers the sub-hour offsets people actually live in', () => {
  const offsets = new Set();
  for (const zone of tz.ZONES) {
    for (const offset of [zone.std, zone.dst]) {
      if (offset !== undefined) offsets.add(offset);
    }
  }
  // Newfoundland (-3:30), Tehran (+3:30), India (+5:30), Nepal (+5:45),
  // Adelaide (+9:30).
  for (const offset of [-210, 210, 330, 345, 570]) {
    assert.ok(offsets.has(offset), `missing sub-hour offset ${offset} minutes`);
  }
});

test('the static offset table agrees with Intl away from changeovers', () => {
  for (const { zone } of tz.ZONES) {
    for (const year of SAMPLE_YEARS) {
      for (let month = 0; month < 12; month++) {
        const instant = new Date(Date.UTC(year, month, SAFE_SAMPLE_DAY, 12));
        assert.strictEqual(
          tz.staticOffsetMinutes(zone, instant),
          referenceOffsetMinutes(zone, instant),
          `${zone} on ${instant.toISOString()}`,
        );
      }
    }
  }
});

test('getOffsetMinutes returns the right offset either side of a DST boundary', () => {
  const winter = new Date(Date.UTC(2026, 0, 15, 12));
  const summer = new Date(Date.UTC(2026, 6, 15, 12));

  assert.strictEqual(tz.getOffsetMinutes('Europe/Dublin', winter), 0);
  assert.strictEqual(tz.getOffsetMinutes('Europe/Dublin', summer), 60);
  assert.strictEqual(tz.getOffsetMinutes('America/New_York', winter), -300);
  assert.strictEqual(tz.getOffsetMinutes('America/New_York', summer), -240);

  // Southern hemisphere: DST in January, standard time in July.
  assert.strictEqual(tz.getOffsetMinutes('Australia/Sydney', winter), 660);
  assert.strictEqual(tz.getOffsetMinutes('Australia/Sydney', summer), 600);

  // No DST anywhere in the year.
  assert.strictEqual(tz.getOffsetMinutes('Asia/Tokyo', winter), 540);
  assert.strictEqual(tz.getOffsetMinutes('Asia/Tokyo', summer), 540);
});

test('legacy three-letter city keys migrate to IANA zones', () => {
  assert.strictEqual(tz.resolveZone('DUB'), 'Europe/Dublin');
  assert.strictEqual(tz.resolveZone('NYC'), 'America/New_York');
  assert.strictEqual(tz.resolveZone('HKG'), 'Asia/Hong_Kong');
  assert.strictEqual(tz.resolveZone('UTC'), 'UTC');
});

test('unknown, empty and malformed zones fall back to the default', () => {
  assert.strictEqual(tz.resolveZone('Mars/Olympus_Mons'), tz.DEFAULT_ZONE);
  assert.strictEqual(tz.resolveZone(''), tz.DEFAULT_ZONE);
  assert.strictEqual(tz.resolveZone(null), tz.DEFAULT_ZONE);
  assert.strictEqual(tz.resolveZone(undefined), tz.DEFAULT_ZONE);
});

test('resolveZone does not treat inherited Object properties as zones', () => {
  assert.strictEqual(tz.resolveZone('constructor'), tz.DEFAULT_ZONE);
  assert.strictEqual(tz.resolveZone('toString'), tz.DEFAULT_ZONE);
});

test('every curated default label fits the watch layer and font subset', () => {
  for (const { zone, label } of tz.ZONES) {
    assert.ok(
      label.length <= tz.MAX_LABEL_CHARS,
      `${zone} label "${label}" is ${label.length} chars, max ${tz.MAX_LABEL_CHARS}`,
    );
    assert.match(label, /^[A-Z0-9 '&./+-]+$/, `${zone} label "${label}" has unrenderable characters`);
  }
});

test('normaliseLabel uppercases and strips unrenderable characters', () => {
  assert.strictEqual(tz.normaliseLabel('dublin'), 'DUBLIN');
  assert.strictEqual(tz.normaliseLabel('New_York'), 'NEW YORK');
  assert.strictEqual(tz.normaliseLabel('Tokyo!!! ***'), 'TOKYO');
  assert.strictEqual(tz.normaliseLabel('  spaced   out  '), 'SPACED OUT');
});

test('normaliseLabel folds accents rather than dropping the letter', () => {
  assert.strictEqual(tz.normaliseLabel('Dún'), 'DUN');
  assert.strictEqual(tz.normaliseLabel('Zürich'), 'ZURICH');
  assert.strictEqual(tz.normaliseLabel('São Paulo'), 'SAO PAULO');
});

test('normaliseLabel truncates to the layer width without a trailing space', () => {
  assert.strictEqual(tz.normaliseLabel('Buenos Aires'), 'BUENOS AIR');
  assert.strictEqual(tz.normaliseLabel('AAAAAAAAA B'), 'AAAAAAAAA');
  assert.ok(tz.normaliseLabel('Somewhere Very Long').length <= tz.MAX_LABEL_CHARS);
});

test('normaliseLabel returns empty string when nothing usable survives', () => {
  assert.strictEqual(tz.normaliseLabel(''), '');
  assert.strictEqual(tz.normaliseLabel(null), '');
  assert.strictEqual(tz.normaliseLabel(undefined), '');
  assert.strictEqual(tz.normaliseLabel('!!!'), '');
  assert.strictEqual(tz.normaliseLabel('   '), '');
});

test('resolveLabel prefers custom text and falls back to the zone default', () => {
  assert.strictEqual(tz.resolveLabel('Europe/Dublin', 'Home'), 'HOME');
  assert.strictEqual(tz.resolveLabel('Europe/Dublin', ''), 'DUBLIN');
  assert.strictEqual(tz.resolveLabel('Europe/Dublin', '   '), 'DUBLIN');
  assert.strictEqual(tz.resolveLabel('Europe/Dublin', '!!!'), 'DUBLIN');
  assert.strictEqual(tz.resolveLabel('Asia/Kolkata', null), 'INDIA');
});

test('configOptions yields one label/value pair per zone, in order', () => {
  const options = tz.configOptions();
  assert.strictEqual(options.length, tz.ZONES.length);
  assert.strictEqual(options[0].value, 'Pacific/Pago_Pago');
  for (const option of options) {
    assert.ok(option.label && option.value, 'option missing label or value');
  }
});

test('formatUtcOffset renders whole, negative and sub-hour offsets', () => {
  assert.strictEqual(tz.formatUtcOffset(0), 'UTC+0');
  assert.strictEqual(tz.formatUtcOffset(60), 'UTC+1');
  assert.strictEqual(tz.formatUtcOffset(-300), 'UTC-5');
  assert.strictEqual(tz.formatUtcOffset(330), 'UTC+5:30');
  assert.strictEqual(tz.formatUtcOffset(345), 'UTC+5:45');
  assert.strictEqual(tz.formatUtcOffset(-210), 'UTC-3:30');
  assert.strictEqual(tz.formatUtcOffset(570), 'UTC+9:30');
});

test('every dropdown label carries the city name and its UTC offset', () => {
  for (const option of tz.configOptions()) {
    assert.match(
      option.label,
      / \(UTC[+-]\d+(:\d\d)?\)$/,
      `option "${option.label}" has no UTC offset suffix`,
    );
  }
});

test('dropdown offsets follow DST, so a zone reads differently in summer', () => {
  const winter = new Date(Date.UTC(2026, 0, 15, 12));
  const summer = new Date(Date.UTC(2026, 6, 15, 12));

  const labelFor = (options, zone) =>
    options.find((option) => option.value === zone).label;

  assert.strictEqual(labelFor(tz.configOptions(winter), 'Europe/Dublin'), 'Dublin (UTC+0)');
  assert.strictEqual(labelFor(tz.configOptions(summer), 'Europe/Dublin'), 'Dublin (UTC+1)');
  assert.strictEqual(labelFor(tz.configOptions(winter), 'America/New_York'), 'New York (UTC-5)');
  assert.strictEqual(labelFor(tz.configOptions(summer), 'America/New_York'), 'New York (UTC-4)');

  // Southern hemisphere runs the other way round.
  assert.strictEqual(
    labelFor(tz.configOptions(winter), 'Australia/Sydney'),
    'Sydney / Melbourne (UTC+11)',
  );
  assert.strictEqual(
    labelFor(tz.configOptions(summer), 'Australia/Sydney'),
    'Sydney / Melbourne (UTC+10)',
  );
});

test('timezones.js never touches Intl or other ICU-backed builtins', () => {
  // The emulator's V8 (via STPyV8) is built without ICU data. Constructing an
  // Intl.DateTimeFormat aborts the process with SIGTRAP inside ICU rather than
  // throwing, so it cannot be caught and cannot even be feature-detected.
  // String.prototype.normalize is backed by the same machinery.
  const source = readFileSync(require.resolve('../src/pkjs/timezones.js'), 'utf8');
  const code = source.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');

  assert.doesNotMatch(code, /\bIntl\b/, 'timezones.js references Intl outside a comment');
  assert.doesNotMatch(code, /\.normalize\s*\(/, 'timezones.js calls String.prototype.normalize');
});

test('offsets stay within an hour of Intl even across DST changeover days', () => {
  // Away from changeovers we demand exact agreement (see the test above). Near
  // one, the static rules approximate the transition instant, so allow the
  // table to be at most an hour out for at most a day either side.
  for (const { zone } of tz.ZONES) {
    for (const year of SAMPLE_YEARS) {
      for (let dayOfYear = 0; dayOfYear < 365; dayOfYear++) {
        const instant = new Date(Date.UTC(year, 0, 1 + dayOfYear, 12));
        const expected = referenceOffsetMinutes(zone, instant);
        const actual = tz.staticOffsetMinutes(zone, instant);
        if (actual === expected) continue;

        // A disagreement is only tolerable if the true offset genuinely changes
        // within a day of this instant, i.e. we are sitting on a changeover.
        const dayBefore = referenceOffsetMinutes(zone, new Date(instant.getTime() - 86400000));
        const dayAfter = referenceOffsetMinutes(zone, new Date(instant.getTime() + 86400000));
        const nearChangeover = dayBefore !== expected || dayAfter !== expected;

        assert.ok(
          nearChangeover && Math.abs(actual - expected) <= 60,
          `${zone} on ${instant.toISOString()}: table said ${actual}, Intl said ${expected}`,
        );
      }
    }
  }
});

test('normaliseLabel folds the dotted capital I that Turkish place names use', () => {
  assert.strictEqual(tz.normaliseLabel('İstanbul'), 'ISTANBUL');
  assert.strictEqual(tz.normaliseLabel('straße'), 'STRASSE');
  assert.strictEqual(tz.normaliseLabel('Kraków'), 'KRAKOW');
});
