'use strict';

// ---------------------------------------------------------------------------
// Whoop data → watch.
//
// A "snapshot" is the face's view of Whoop at one moment:
//
//   {
//     recovery:   0–100     recovery score, %
//     sleepPerf:  0–100     sleep performance, %
//     sleepMins:  minutes   time asleep (in bed minus awake)
//     strain:     0–21      day strain, one decimal
//     syncedAt:   Date      when the snapshot was taken
//   }
//
// Any field Whoop has not scored yet is null. buildSnapshot makes one from
// Whoop API replies; mockSnapshot is a fixed one for design work.
//
// Recovery zones are drawn on the watch; RECOVERY_GREEN_MIN and
// RECOVERY_YELLOW_MIN must match the C (a test checks this).
// ---------------------------------------------------------------------------

var RECOVERY_GREEN_MIN  = 67;
var RECOVERY_YELLOW_MIN = 34;
var STRAIN_MAX = 21;

// The watch reads -1 as "no reading" and shows "--".
var NO_VALUE = -1;

/** A plausible mid-afternoon snapshot, for designing and testing the face. */
function mockSnapshot(now) {
  return {
    recovery:  78,
    sleepPerf: 91,
    sleepMins: 7 * 60 + 42,
    strain:    12.4,
    syncedAt:  now || new Date()
  };
}

function recoveryZone(score) {
  if (typeof score !== 'number' || !isFinite(score)) return null;
  if (score >= RECOVERY_GREEN_MIN)  return 'green';
  if (score >= RECOVERY_YELLOW_MIN) return 'yellow';
  return 'red';
}

function clampInt(value, min, max) {
  if (typeof value !== 'number' || !isFinite(value)) return NO_VALUE;
  var n = Math.round(value);
  return n < min ? min : (n > max ? max : n);
}

/**
 * The AppMessage fields for a snapshot. Every value is an integer: strain
 * travels in tenths (12.4 → 124) and the sync time in epoch seconds.
 */
function toWatchPayload(snapshot) {
  var s = snapshot || {};
  var synced = s.syncedAt instanceof Date ? s.syncedAt.getTime() : NaN;
  return {
    WHOOP_RECOVERY:   clampInt(s.recovery, 0, 100),
    WHOOP_SLEEP_PERF: clampInt(s.sleepPerf, 0, 100),
    WHOOP_SLEEP_MINS: clampInt(s.sleepMins, 0, 24 * 60),
    WHOOP_STRAIN:     typeof s.strain === 'number' && isFinite(s.strain)
                        ? clampInt(s.strain * 10, 0, STRAIN_MAX * 10) : NO_VALUE,
    WHOOP_SYNC_TIME:  isFinite(synced) ? Math.floor(synced / 1000) : 0
  };
}

// ---------------------------------------------------------------------------
// Whoop API (v2) → snapshot. Pure: index.js does the requests.
//
// Whoop groups data by cycle, one physiological day starting at wake-up:
//   GET /v2/cycle?limit=1            latest cycle: id and day strain
//   GET /v2/cycle/{id}/recovery      that cycle's recovery (404 until scored)
//   GET /v2/cycle/{id}/sleep         the sleep that started that cycle
//
// Every record has a score_state of SCORED, PENDING_SCORE or UNSCORABLE, and
// only SCORED records carry a usable score.
//
// Docs: https://developer.whoop.com/api
// ---------------------------------------------------------------------------

var API_BASE = 'https://api.prod.whoop.com/developer';

function latestCycleUrl() {
  return API_BASE + '/v2/cycle?limit=1';
}

function requireCycleId(cycleId, where) {
  if (typeof cycleId !== 'number' || !isFinite(cycleId) || cycleId < 0 ||
      Math.floor(cycleId) !== cycleId) {
    throw new Error(where + ': cycle id must be a non-negative integer, got ' + cycleId);
  }
  return cycleId;
}

function cycleRecoveryUrl(cycleId) {
  return API_BASE + '/v2/cycle/' + requireCycleId(cycleId, 'cycleRecoveryUrl') + '/recovery';
}

function cycleSleepUrl(cycleId) {
  return API_BASE + '/v2/cycle/' + requireCycleId(cycleId, 'cycleSleepUrl') + '/sleep';
}

/**
 * What an API status means for us:
 *   'ok'            2xx
 *   'none'          404: e.g. no recovery for this cycle yet
 *   'unauthorised'  401: the access token is no good
 *   'rate_limited'  429
 *   'temporary'     anything else: network failure (0), 5xx, ...
 */
function classifyApiStatus(status) {
  if (status >= 200 && status < 300) return 'ok';
  if (status === 404) return 'none';
  if (status === 401) return 'unauthorised';
  if (status === 429) return 'rate_limited';
  return 'temporary';
}

function parseJson(bodyText, what) {
  try {
    return JSON.parse(bodyText);
  } catch (e) {
    // Not e.message: V8 quotes the bad input, and this is the user's data.
    throw new Error(what + ' was not valid JSON');
  }
}

function finiteOrNull(value) {
  return typeof value === 'number' && isFinite(value) ? value : null;
}

/** record.score, if Whoop has scored the record; otherwise null. */
function scoreOf(record) {
  if (!record || record.score_state !== 'SCORED' || !record.score ||
      typeof record.score !== 'object') {
    return null;
  }
  return record.score;
}

/**
 * The latest cycle from a /v2/cycle?limit=1 reply: { id, strain }, or null
 * if the account has no cycles at all (e.g. a brand-new strap).
 * Throws with a description if the reply isn't the expected shape.
 */
function parseLatestCycle(bodyText) {
  var body = parseJson(bodyText, 'Cycle reply');
  if (!body || !Array.isArray(body.records)) {
    throw new Error('Cycle reply had no records list');
  }
  var cycle = body.records[0];
  if (!cycle) return null;
  if (typeof cycle.id !== 'number') {
    throw new Error('Latest cycle had no numeric id');
  }
  var score = scoreOf(cycle);
  return { id: cycle.id, strain: score ? finiteOrNull(score.strain) : null };
}

/** Recovery score (0–100) from a /v2/cycle/{id}/recovery reply, or null. */
function parseRecovery(bodyText) {
  var score = scoreOf(parseJson(bodyText, 'Recovery reply'));
  return score ? finiteOrNull(score.recovery_score) : null;
}

/**
 * Minutes actually asleep: light + slow-wave + REM. That's time in bed minus
 * time awake minus time with no data. null if any stage is missing.
 */
function sleepMinutes(stageSummary) {
  var s = stageSummary || {};
  var stages = [s.total_light_sleep_time_milli, s.total_slow_wave_sleep_time_milli,
                s.total_rem_sleep_time_milli];
  var totalMs = 0;
  for (var i = 0; i < stages.length; i++) {
    if (finiteOrNull(stages[i]) === null || stages[i] < 0) return null;
    totalMs += stages[i];
  }
  return Math.round(totalMs / 60000);
}

/** { sleepPerf, sleepMins } from a /v2/cycle/{id}/sleep reply; nulls if unscored. */
function parseSleep(bodyText) {
  var score = scoreOf(parseJson(bodyText, 'Sleep reply'));
  if (!score) return { sleepPerf: null, sleepMins: null };
  return {
    sleepPerf: finiteOrNull(score.sleep_performance_percentage),
    sleepMins: sleepMinutes(score.stage_summary)
  };
}

/**
 * A snapshot from the parsed parts. Missing parts become nulls, which the
 * watch shows as "--".
 *
 * @param {{cycle: ?{strain: ?number}, recovery: ?number,
 *          sleep: ?{sleepPerf: ?number, sleepMins: ?number}}} parts
 * @param {Date} now - when the data was fetched
 */
function buildSnapshot(parts, now) {
  var p = parts || {};
  var sleep = p.sleep || {};
  return {
    recovery:  finiteOrNull(p.recovery),
    sleepPerf: finiteOrNull(sleep.sleepPerf),
    sleepMins: finiteOrNull(sleep.sleepMins),
    strain:    p.cycle ? finiteOrNull(p.cycle.strain) : null,
    syncedAt:  now
  };
}

module.exports = {
  API_BASE: API_BASE,
  latestCycleUrl: latestCycleUrl,
  cycleRecoveryUrl: cycleRecoveryUrl,
  cycleSleepUrl: cycleSleepUrl,
  classifyApiStatus: classifyApiStatus,
  parseLatestCycle: parseLatestCycle,
  parseRecovery: parseRecovery,
  parseSleep: parseSleep,
  sleepMinutes: sleepMinutes,
  buildSnapshot: buildSnapshot,
  RECOVERY_GREEN_MIN: RECOVERY_GREEN_MIN,
  RECOVERY_YELLOW_MIN: RECOVERY_YELLOW_MIN,
  STRAIN_MAX: STRAIN_MAX,
  NO_VALUE: NO_VALUE,
  mockSnapshot: mockSnapshot,
  recoveryZone: recoveryZone,
  toWatchPayload: toWatchPayload
};
