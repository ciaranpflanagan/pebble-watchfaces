'use strict';

// ---------------------------------------------------------------------------
// Bottom-row complications.
//
// The footer renders a short label on the left and a value on the right. Which
// value that is comes from here: the phone picks the complication, the watch
// reads the underlying sensor. The numeric `value` is what travels over
// AppMessage as SETTINGS_COMPLICATION and must stay in step with the
// ComplicationType enum in src/c/console-watchface.c.
//
// `label` is the fallback shown when the user has not typed a custom one. The
// timezone entry has none because its label comes from the chosen city (see
// timezones.js). Every label must fit MAX_LABEL_CHARS and use only characters
// in the SPACE_MONO_14 subset declared in package.json.
//
// `health` marks the complications backed by Pebble Health. Those need the
// "health" capability in package.json and can legitimately read as "--" when
// the user has health tracking switched off.
// ---------------------------------------------------------------------------

var COMPLICATIONS = [
  { key: 'timezone', value: 0, name: 'Second timezone', label: null,      health: false },
  { key: 'steps',    value: 1, name: 'Steps',           label: 'STEPS',   health: true  },
  { key: 'battery',  value: 2, name: 'Battery',         label: 'BATTERY', health: false },
  { key: 'heart',    value: 3, name: 'Heart rate',      label: 'HEART',   health: true  },
  { key: 'calories', value: 4, name: 'Active calories', label: 'CALS',    health: true  }
];

var DEFAULT_COMPLICATION = 'timezone';

var BY_KEY = {};
for (var i = 0; i < COMPLICATIONS.length; i++) {
  BY_KEY[COMPLICATIONS[i].key] = COMPLICATIONS[i];
}

/** Coerce anything stored or posted back by Clay into a known complication key. */
function resolveComplication(key) {
  return Object.prototype.hasOwnProperty.call(BY_KEY, key) ? key : DEFAULT_COMPLICATION;
}

/** The AppMessage integer for a complication key. */
function toValue(key) {
  return BY_KEY[resolveComplication(key)].value;
}

function isTimezone(key) {
  return resolveComplication(key) === 'timezone';
}

/**
 * The built-in label for a complication, or '' for the timezone, whose label
 * depends on the chosen city rather than on the complication itself.
 */
function defaultLabel(key) {
  return BY_KEY[resolveComplication(key)].label || '';
}

/** Options for the Clay select, in declaration order. */
function configOptions() {
  return COMPLICATIONS.map(function(c) {
    return { label: c.name, value: c.key };
  });
}

module.exports = {
  COMPLICATIONS: COMPLICATIONS,
  DEFAULT_COMPLICATION: DEFAULT_COMPLICATION,
  resolveComplication: resolveComplication,
  toValue: toValue,
  isTimezone: isTimezone,
  defaultLabel: defaultLabel,
  configOptions: configOptions
};
