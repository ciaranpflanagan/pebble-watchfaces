'use strict';

// Unit tests for src/pkjs/whoop.js, plus the contracts between the phone code,
// the C and package.json. Run with: npm test

const test = require('node:test');
const assert = require('node:assert');
const { readFileSync } = require('node:fs');

const whoop = require('../src/pkjs/whoop.js');

const WATCHFACE_C = readFileSync(__dirname + '/../src/c/whoop-watchface.c', 'utf8');
const MANIFEST = JSON.parse(readFileSync(__dirname + '/../package.json', 'utf8'));

function cDefine(name) {
  const m = WATCHFACE_C.match(new RegExp('#define\\s+' + name + '\\s+(\\d+)'));
  assert.ok(m, name + ' not found in the C');
  return Number(m[1]);
}

/** The characters a Pebble font resource was subsetted to. */
function fontRegex(name) {
  const font = MANIFEST.pebble.resources.media.find((r) => r.name === name);
  assert.ok(font, name + ' missing from package.json');
  return new RegExp('^' + font.characterRegex + '*$');
}

test('toWatchPayload sends integers, with strain in tenths', () => {
  const synced = new Date('2026-11-17T14:05:00Z');
  assert.deepStrictEqual(whoop.toWatchPayload(whoop.mockSnapshot(synced)), {
    WHOOP_RECOVERY:   78,
    WHOOP_SLEEP_PERF: 91,
    WHOOP_SLEEP_MINS: 462,
    WHOOP_STRAIN:     124,
    WHOOP_SYNC_TIME:  Math.floor(synced.getTime() / 1000)
  });
});

test('unscored fields become -1, a missing sync time 0', () => {
  assert.deepStrictEqual(whoop.toWatchPayload({
    recovery: null, sleepPerf: undefined, sleepMins: NaN, strain: null
  }), {
    WHOOP_RECOVERY: -1, WHOOP_SLEEP_PERF: -1, WHOOP_SLEEP_MINS: -1,
    WHOOP_STRAIN: -1, WHOOP_SYNC_TIME: 0
  });
  assert.strictEqual(whoop.toWatchPayload(null).WHOOP_RECOVERY, -1);
});

test('values are clamped to their scales', () => {
  const p = whoop.toWatchPayload({ recovery: 140, sleepPerf: -5, strain: 25.3, sleepMins: 9999 });
  assert.strictEqual(p.WHOOP_RECOVERY, 100);
  assert.strictEqual(p.WHOOP_SLEEP_PERF, 0);
  assert.strictEqual(p.WHOOP_STRAIN, 210);
  assert.strictEqual(p.WHOOP_SLEEP_MINS, 1440);
});

test('strain rounds to the nearest tenth', () => {
  assert.strictEqual(whoop.toWatchPayload({ strain: 8.06 }).WHOOP_STRAIN, 81);
  assert.strictEqual(whoop.toWatchPayload({ strain: 0 }).WHOOP_STRAIN, 0);
});

test('recovery zones use Whoop thresholds', () => {
  assert.strictEqual(whoop.recoveryZone(100), 'green');
  assert.strictEqual(whoop.recoveryZone(67), 'green');
  assert.strictEqual(whoop.recoveryZone(66), 'yellow');
  assert.strictEqual(whoop.recoveryZone(34), 'yellow');
  assert.strictEqual(whoop.recoveryZone(33), 'red');
  assert.strictEqual(whoop.recoveryZone(0), 'red');
  assert.strictEqual(whoop.recoveryZone(null), null);
});

test('the C recovery thresholds and strain scale match the JS', () => {
  assert.strictEqual(cDefine('RECOVERY_GREEN_MIN'), whoop.RECOVERY_GREEN_MIN);
  assert.strictEqual(cDefine('RECOVERY_YELLOW_MIN'), whoop.RECOVERY_YELLOW_MIN);
  assert.strictEqual(cDefine('STRAIN_MAX_TENTHS'), whoop.STRAIN_MAX * 10);
});

test('every payload key is a declared messageKey that the C reads', () => {
  const keys = Object.keys(whoop.toWatchPayload(whoop.mockSnapshot()));
  for (const key of keys) {
    assert.ok(MANIFEST.pebble.messageKeys.includes(key), key + ' not in messageKeys');
    assert.ok(WATCHFACE_C.includes('MESSAGE_KEY_' + key), key + ' never read by the C');
  }
});

test('every declared messageKey is read by the C', () => {
  for (const key of MANIFEST.pebble.messageKeys) {
    assert.ok(WATCHFACE_C.includes('MESSAGE_KEY_' + key), key + ' never read by the C');
  }
});

test('the subsetted fonts cover every string the face draws', () => {
  // Ring values and the temperature use SPACE_GROTESK_18.
  const grotesk20 = fontRegex('SPACE_GROTESK_18');
  for (const s of ['--', '0', '100', '12.4', '21.0', '-12°C', '104°F']) {
    assert.match(s, grotesk20, JSON.stringify(s));
  }
  // Ring labels and footer use SPACE_MONO_11.
  const mono11 = fontRegex('SPACE_MONO_11');
  for (const s of ['RECOVERY', 'SLEEP', 'STRAIN', 'SLEPT 7H 42M', 'SLEPT --',
                   'SYNC 08:12', 'NOT SYNCED']) {
    assert.match(s, mono11, JSON.stringify(s));
  }
  assert.match('21:44', fontRegex('SPACE_GROTESK_56'));
});

test('the C draws the labels the font test checks', () => {
  for (const s of ['"RECOVERY"', '"SLEEP"', '"STRAIN"', '"SLEPT %dH %02dM"',
                   '"SYNC %s"', '"NOT SYNCED"']) {
    assert.ok(WATCHFACE_C.includes(s), s + ' not in the C');
  }
});

// --- Whoop API (v2) → snapshot -------------------------------------------
// Fixtures follow the response shapes in https://developer.whoop.com/api

const MIN = 60 * 1000;

const SCORED_CYCLE = JSON.stringify({
  records: [{
    id: 93845, user_id: 10129, start: '2026-11-25T06:25:14.059Z', end: null,
    timezone_offset: '-08:00', score_state: 'SCORED',
    score: { strain: 12.4, kilojoule: 8288.297, average_heart_rate: 68, max_heart_rate: 141 }
  }],
  next_token: 'MTIzOjEyMzEyMw'
});

const SCORED_RECOVERY = JSON.stringify({
  cycle_id: 93845, sleep_id: 'ecfc6a15-4661-442f-a9a4-f160dd7afae8', user_id: 10129,
  score_state: 'SCORED',
  score: { user_calibrating: false, recovery_score: 78, resting_heart_rate: 51,
           hrv_rmssd_milli: 61.2, spo2_percentage: 95.6875, skin_temp_celsius: 33.7 }
});

const SCORED_SLEEP = JSON.stringify({
  id: 'ecfc6a15-4661-442f-a9a4-f160dd7afae8', cycle_id: 93845, nap: false,
  score_state: 'SCORED',
  score: {
    stage_summary: {
      total_in_bed_time_milli: 520 * MIN,
      total_awake_time_milli: 50 * MIN,
      total_no_data_time_milli: 8 * MIN,
      total_light_sleep_time_milli: 230 * MIN,
      total_slow_wave_sleep_time_milli: 110 * MIN,
      total_rem_sleep_time_milli: 122 * MIN,
      sleep_cycle_count: 4, disturbance_count: 12
    },
    respiratory_rate: 16.1, sleep_performance_percentage: 91,
    sleep_consistency_percentage: 90, sleep_efficiency_percentage: 91.7
  }
});

test('API URLs are v2 and built from the cycle id', () => {
  assert.strictEqual(whoop.latestCycleUrl(), 'https://api.prod.whoop.com/developer/v2/cycle?limit=1');
  assert.strictEqual(whoop.cycleRecoveryUrl(93845),
    'https://api.prod.whoop.com/developer/v2/cycle/93845/recovery');
  assert.strictEqual(whoop.cycleSleepUrl(93845),
    'https://api.prod.whoop.com/developer/v2/cycle/93845/sleep');
  assert.throws(() => whoop.cycleSleepUrl('93845/../user'), /cycleSleepUrl: cycle id must be/);
  assert.throws(() => whoop.cycleRecoveryUrl(1.5), /cycle id must be/);
});

test('API statuses are classified', () => {
  assert.strictEqual(whoop.classifyApiStatus(200), 'ok');
  assert.strictEqual(whoop.classifyApiStatus(404), 'none');
  assert.strictEqual(whoop.classifyApiStatus(401), 'unauthorised');
  assert.strictEqual(whoop.classifyApiStatus(429), 'rate_limited');
  assert.strictEqual(whoop.classifyApiStatus(0), 'temporary');
  assert.strictEqual(whoop.classifyApiStatus(503), 'temporary');
});

test('scored replies become a full snapshot and payload', () => {
  const now = new Date('2026-11-25T21:00:00Z');
  const snapshot = whoop.buildSnapshot({
    cycle: whoop.parseLatestCycle(SCORED_CYCLE),
    recovery: whoop.parseRecovery(SCORED_RECOVERY),
    sleep: whoop.parseSleep(SCORED_SLEEP)
  }, now);
  assert.deepStrictEqual(snapshot, {
    recovery: 78, sleepPerf: 91, sleepMins: 462, strain: 12.4, syncedAt: now
  });
  assert.deepStrictEqual(whoop.toWatchPayload(snapshot), {
    WHOOP_RECOVERY: 78, WHOOP_SLEEP_PERF: 91, WHOOP_SLEEP_MINS: 462,
    WHOOP_STRAIN: 124, WHOOP_SYNC_TIME: Math.floor(now.getTime() / 1000)
  });
});

test('time asleep is light + deep + REM (in bed minus awake minus no data)', () => {
  const summary = JSON.parse(SCORED_SLEEP).score.stage_summary;
  const expected = (summary.total_in_bed_time_milli - summary.total_awake_time_milli -
                    summary.total_no_data_time_milli) / MIN;
  assert.strictEqual(whoop.sleepMinutes(summary), expected);
  assert.strictEqual(whoop.sleepMinutes({ total_light_sleep_time_milli: 1 }), null);
  assert.strictEqual(whoop.sleepMinutes(null), null);
});

test('PENDING_SCORE and UNSCORABLE records give nulls, shown as --', () => {
  for (const state of ['PENDING_SCORE', 'UNSCORABLE']) {
    const cycle = JSON.parse(SCORED_CYCLE);
    cycle.records[0].score_state = state;
    assert.deepStrictEqual(whoop.parseLatestCycle(JSON.stringify(cycle)), { id: 93845, strain: null });

    const recovery = Object.assign(JSON.parse(SCORED_RECOVERY), { score_state: state });
    assert.strictEqual(whoop.parseRecovery(JSON.stringify(recovery)), null);

    const sleep = Object.assign(JSON.parse(SCORED_SLEEP), { score_state: state });
    assert.deepStrictEqual(whoop.parseSleep(JSON.stringify(sleep)), { sleepPerf: null, sleepMins: null });
  }
});

test('missing parts (no recovery yet, no cycles) become -1 on the watch', () => {
  const now = new Date('2026-11-25T07:00:00Z');
  const p = whoop.toWatchPayload(whoop.buildSnapshot({
    cycle: whoop.parseLatestCycle(SCORED_CYCLE), recovery: null, sleep: null
  }, now));
  assert.strictEqual(p.WHOOP_STRAIN, 124);
  assert.strictEqual(p.WHOOP_RECOVERY, -1);
  assert.strictEqual(p.WHOOP_SLEEP_PERF, -1);
  assert.strictEqual(p.WHOOP_SLEEP_MINS, -1);

  assert.strictEqual(whoop.parseLatestCycle('{"records":[]}'), null);
  const empty = whoop.toWatchPayload(whoop.buildSnapshot({ cycle: null }, now));
  assert.strictEqual(empty.WHOOP_STRAIN, -1);
  assert.strictEqual(empty.WHOOP_SYNC_TIME, Math.floor(now.getTime() / 1000));
});

test('malformed replies throw without quoting the data', () => {
  assert.throws(() => whoop.parseLatestCycle('{"recovery_score": 7'), /^Error: Cycle reply was not valid JSON$/);
  assert.throws(() => whoop.parseLatestCycle('{}'), /no records list/);
  assert.throws(() => whoop.parseLatestCycle('{"records":[{"id":"x"}]}'), /no numeric id/);
  assert.throws(() => whoop.parseRecovery('<html>'), /Recovery reply was not valid JSON/);
});

test('the manifest lets a real phone reach Whoop and the weather', () => {
  const internet = MANIFEST.pebble.usesPermissions.find((p) => p.name === 'Internet');
  assert.ok(internet, 'usesPermissions needs an Internet entry');
  for (const host of [new URL(whoop.API_BASE).hostname, 'api.open-meteo.com']) {
    assert.ok(internet.parameters.domains.includes(host), host + ' missing from Internet domains');
  }
  assert.ok(MANIFEST.pebble.usesPermissions.includes('Location'), 'Location needed for weather');
});
