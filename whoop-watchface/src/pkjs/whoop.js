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
// Any field Whoop has not scored yet is null. Phase 1 uses MOCK_SNAPSHOT;
// later phases build snapshots from the Whoop API.
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

module.exports = {
  RECOVERY_GREEN_MIN: RECOVERY_GREEN_MIN,
  RECOVERY_YELLOW_MIN: RECOVERY_YELLOW_MIN,
  STRAIN_MAX: STRAIN_MAX,
  NO_VALUE: NO_VALUE,
  mockSnapshot: mockSnapshot,
  recoveryZone: recoveryZone,
  toWatchPayload: toWatchPayload
};
