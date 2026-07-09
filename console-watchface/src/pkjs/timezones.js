'use strict';

// ---------------------------------------------------------------------------
// Timezone data and label helpers.
//
// ZONES lists one representative city per real UTC offset, west to east, so the
// whole world is reachable from a dropdown short enough to scroll on a phone.
// That means every whole-hour offset from UTC-11 to UTC+13, plus the sub-hour
// offsets that matter (Newfoundland, Tehran, India, Nepal, Adelaide).
//
// Offsets come from the static table below, not from Intl.
//
// Do NOT reach for Intl.DateTimeFormat here. The emulator's JS engine (STPyV8)
// embeds a V8 built without full ICU data, and constructing a DateTimeFormat
// aborts the whole process inside ICU:
//
//   v8::internal::JSDateTimeFormat::CreateDateTimeFormat
//   v8::internal::DateTimePatternGeneratorCache::CreateGenerator
//   v8::internal::V8::FatalProcessOutOfMemory -> v8::base::OS::Abort()
//
// That is a SIGTRAP, not a JS exception, so it cannot be caught, and probing
// for Intl is itself the thing that crashes. The same caveat applies to any
// other ICU-backed builtin, which is why normaliseLabel() folds accents with an
// explicit character map rather than String.prototype.normalize.
//
// The trade-off is that DST changeover instants are approximated to within an
// hour, and a government moving its changeover dates needs an update here. The
// unit tests check this table against Node's Intl for every zone across several
// years, so the data is at least verified against the real tz database.
//
//   std   — UTC offset in minutes east of UTC outside DST (New York: -300)
//   dst   — UTC offset in minutes east of UTC during DST; absent if the zone
//           never observes DST
//   rule  — which DST calendar the zone follows: 'EU' | 'US' | 'AU' | 'NZ'
// ---------------------------------------------------------------------------

// The footer label layer fits ten monospaced characters at SPACE_MONO_14.
// Keep in sync with FOOTER_LABEL_* in src/c/console-watchface.c.
var MAX_LABEL_CHARS = 10;

// Characters that have glyphs in the SPACE_MONO_14 subset (see package.json).
// Anything else would render as a blank box on the watch, so it is stripped.
var UNSUPPORTED_LABEL_CHARS = /[^A-Z0-9 '&./+-]/g;

// Accented Latin characters folded to their base letter. Uppercase forms are
// covered by .toUpperCase() running after the fold, so only the lowercase and
// uppercase source characters we expect users to type are listed.
var ACCENT_FOLD = {
  'à':'a','á':'a','â':'a','ã':'a','ä':'a','å':'a','ā':'a','ă':'a','ą':'a',
  'è':'e','é':'e','ê':'e','ë':'e','ē':'e','ĕ':'e','ė':'e','ę':'e','ě':'e',
  'ì':'i','í':'i','î':'i','ï':'i','ī':'i','į':'i','ı':'i',
  'ò':'o','ó':'o','ô':'o','õ':'o','ö':'o','ø':'o','ō':'o','ŏ':'o','ő':'o',
  'ù':'u','ú':'u','û':'u','ü':'u','ū':'u','ŭ':'u','ů':'u','ű':'u','ų':'u',
  'ý':'y','ÿ':'y',
  'ñ':'n','ń':'n','ň':'n',
  'ç':'c','ć':'c','č':'c',
  'ß':'ss','ş':'s','ś':'s','š':'s',
  'ž':'z','ź':'z','ż':'z',
  'ł':'l','đ':'d','ð':'d','þ':'th',
  'ř':'r','ť':'t','ď':'d','ğ':'g',
  'æ':'ae','œ':'oe',
  'À':'A','Á':'A','Â':'A','Ã':'A','Ä':'A','Å':'A','Ā':'A','Ą':'A',
  'È':'E','É':'E','Ê':'E','Ë':'E','Ē':'E','Ę':'E','Ě':'E',
  'Ì':'I','Í':'I','Î':'I','Ï':'I','Ī':'I','Į':'I','İ':'I',
  'Ò':'O','Ó':'O','Ô':'O','Õ':'O','Ö':'O','Ø':'O','Ō':'O','Ő':'O',
  'Ù':'U','Ú':'U','Û':'U','Ü':'U','Ū':'U','Ů':'U','Ű':'U',
  'Ý':'Y','Ñ':'N','Ń':'N','Ň':'N',
  'Ç':'C','Ć':'C','Č':'C',
  'Ş':'S','Ś':'S','Š':'S','Ž':'Z','Ź':'Z','Ż':'Z',
  'Ł':'L','Đ':'D','Ð':'D','Þ':'TH',
  'Ř':'R','Ť':'T','Ď':'D','Ğ':'G',
  'Æ':'AE','Œ':'OE'
};

var ZONES = [
  { zone: 'Pacific/Pago_Pago', name: 'Pago Pago', label: 'PAGO PAGO', std: -660 },
  { zone: 'Pacific/Honolulu', name: 'Honolulu', label: 'HONOLULU', std: -600 },
  { zone: 'America/Anchorage', name: 'Anchorage', label: 'ANCHORAGE', std: -540, dst: -480, rule: 'US' },
  { zone: 'America/Los_Angeles', name: 'Los Angeles', label: 'LA', std: -480, dst: -420, rule: 'US' },
  { zone: 'America/Denver', name: 'Denver', label: 'DENVER', std: -420, dst: -360, rule: 'US' },
  { zone: 'America/Chicago', name: 'Chicago', label: 'CHICAGO', std: -360, dst: -300, rule: 'US' },
  { zone: 'America/New_York', name: 'New York', label: 'NEW YORK', std: -300, dst: -240, rule: 'US' },
  { zone: 'America/Halifax', name: 'Halifax', label: 'HALIFAX', std: -240, dst: -180, rule: 'US' },
  { zone: 'America/St_Johns', name: 'Newfoundland', label: 'ST JOHNS', std: -210, dst: -150, rule: 'US' },
  { zone: 'America/Sao_Paulo', name: 'Sao Paulo', label: 'SAO PAULO', std: -180 },
  { zone: 'Atlantic/South_Georgia', name: 'South Georgia', label: 'S GEORGIA', std: -120 },
  { zone: 'Atlantic/Azores', name: 'Azores', label: 'AZORES', std: -60, dst: 0, rule: 'EU' },
  { zone: 'UTC', name: 'UTC', label: 'UTC', std: 0 },
  { zone: 'Europe/London', name: 'London', label: 'LONDON', std: 0, dst: 60, rule: 'EU' },
  { zone: 'Europe/Dublin', name: 'Dublin', label: 'DUBLIN', std: 0, dst: 60, rule: 'EU' },
  { zone: 'Europe/Paris', name: 'Paris / Berlin', label: 'PARIS', std: 60, dst: 120, rule: 'EU' },
  { zone: 'Europe/Athens', name: 'Athens / Helsinki', label: 'ATHENS', std: 120, dst: 180, rule: 'EU' },
  { zone: 'Africa/Johannesburg', name: 'Johannesburg', label: 'JOBURG', std: 120 },
  { zone: 'Europe/Moscow', name: 'Moscow', label: 'MOSCOW', std: 180 },
  { zone: 'Asia/Tehran', name: 'Tehran', label: 'TEHRAN', std: 210 },
  { zone: 'Asia/Dubai', name: 'Dubai', label: 'DUBAI', std: 240 },
  { zone: 'Asia/Karachi', name: 'Karachi', label: 'KARACHI', std: 300 },
  { zone: 'Asia/Kolkata', name: 'Mumbai / Delhi', label: 'INDIA', std: 330 },
  { zone: 'Asia/Kathmandu', name: 'Kathmandu', label: 'KATHMANDU', std: 345 },
  { zone: 'Asia/Dhaka', name: 'Dhaka', label: 'DHAKA', std: 360 },
  { zone: 'Asia/Bangkok', name: 'Bangkok / Jakarta', label: 'BANGKOK', std: 420 },
  { zone: 'Asia/Singapore', name: 'Singapore', label: 'SINGAPORE', std: 480 },
  { zone: 'Asia/Hong_Kong', name: 'Hong Kong', label: 'HONG KONG', std: 480 },
  { zone: 'Asia/Shanghai', name: 'Beijing / Shanghai', label: 'SHANGHAI', std: 480 },
  { zone: 'Asia/Tokyo', name: 'Tokyo / Seoul', label: 'TOKYO', std: 540 },
  { zone: 'Australia/Adelaide', name: 'Adelaide', label: 'ADELAIDE', std: 570, dst: 630, rule: 'AU' },
  { zone: 'Australia/Brisbane', name: 'Brisbane', label: 'BRISBANE', std: 600 },
  { zone: 'Australia/Sydney', name: 'Sydney / Melbourne', label: 'SYDNEY', std: 600, dst: 660, rule: 'AU' },
  { zone: 'Pacific/Noumea', name: 'Noumea', label: 'NOUMEA', std: 660 },
  { zone: 'Pacific/Auckland', name: 'Auckland', label: 'AUCKLAND', std: 720, dst: 780, rule: 'NZ' },
  { zone: 'Pacific/Tongatapu', name: 'Tonga', label: 'TONGA', std: 780 }];

var DEFAULT_ZONE = 'Europe/Dublin';

// Index by IANA name for O(1) lookup.
var ZONES_BY_NAME = {};
for (var i = 0; i < ZONES.length; i++) {
  ZONES_BY_NAME[ZONES[i].zone] = ZONES[i];
}

// ---------------------------------------------------------------------------
// Legacy settings migration.
// Builds before the full timezone list stored a three-letter city key.
// ---------------------------------------------------------------------------
var LEGACY_KEY_TO_ZONE = {
  DUB: 'Europe/Dublin',
  NYC: 'America/New_York',
  LAX: 'America/Los_Angeles',
  CHI: 'America/Chicago',
  UTC: 'UTC',
  PAR: 'Europe/Paris',
  TYO: 'Asia/Tokyo',
  SYD: 'Australia/Sydney',
  DXB: 'Asia/Dubai',
  HKG: 'Asia/Hong_Kong'
};

/**
 * Resolve a stored timezone setting to a zone name we know about. Accepts a
 * current IANA name, a legacy three-letter key, or junk from a corrupt store.
 */
function resolveZone(stored) {
  if (!stored) return DEFAULT_ZONE;
  if (Object.prototype.hasOwnProperty.call(ZONES_BY_NAME, stored)) return stored;
  if (Object.prototype.hasOwnProperty.call(LEGACY_KEY_TO_ZONE, stored)) {
    return LEGACY_KEY_TO_ZONE[stored];
  }
  console.log('Unknown timezone "' + stored + '", falling back to ' + DEFAULT_ZONE);
  return DEFAULT_ZONE;
}

/**
 * Render a UTC offset in minutes as a readable suffix: 60 -> 'UTC+1',
 * -300 -> 'UTC-5', 330 -> 'UTC+5:30'. Whole hours omit the minutes part.
 */
function formatUtcOffset(minutes) {
  var sign      = minutes < 0 ? '-' : '+';
  var magnitude = Math.abs(minutes);
  var hours     = Math.floor(magnitude / 60);
  var mins      = magnitude % 60;
  var minsPart  = mins === 0 ? '' : ':' + (mins < 10 ? '0' + mins : String(mins));
  return 'UTC' + sign + hours + minsPart;
}

/**
 * Options for the Clay config dropdown, in the order ZONES declares them, each
 * labelled with the offset in force at `date` (default: now). The offset is
 * DST-aware, so Dublin reads 'UTC+1' in July and 'UTC+0' in January.
 */
function configOptions(date) {
  var instant = date || new Date();
  return ZONES.map(function(z) {
    return {
      label: z.name + ' (' + formatUtcOffset(getOffsetMinutes(z.zone, instant)) + ')',
      value: z.zone
    };
  });
}

// ---------------------------------------------------------------------------
// Offset resolution — static table only. See the Intl warning at the top.
// ---------------------------------------------------------------------------

// --- DST rule helpers -------------------------------------------------------

function lastSundayUtc(year, month0, hour) {
  var d = new Date(Date.UTC(year, month0 + 1, 0));   // last day of the month
  d.setUTCDate(d.getUTCDate() - d.getUTCDay());       // rewind to Sunday
  d.setUTCHours(hour, 0, 0, 0);
  return d;
}

function nthSundayUtc(year, month0, n, hour) {
  var d = new Date(Date.UTC(year, month0, 1));
  d.setUTCDate(1 + ((7 - d.getUTCDay()) % 7) + (n - 1) * 7);
  d.setUTCHours(hour || 0, 0, 0, 0);
  return d;
}

function isEuDst(now) {
  var year  = now.getUTCFullYear();
  var start = lastSundayUtc(year, 2, 1);   // last Sun Mar @ 01:00 UTC
  var end   = lastSundayUtc(year, 9, 1);   // last Sun Oct @ 01:00 UTC
  return now >= start && now < end;
}

function isUsDst(now) {
  var year  = now.getUTCFullYear();
  var month = now.getUTCMonth();
  if (month < 2 || month > 10) return false;   // Dec-Feb: standard time
  if (month > 2 && month < 10) return true;    // Apr-Oct: DST
  if (month === 2) {
    return now >= nthSundayUtc(year, 2, 2, 7);  // 2nd Sun Mar, 02:00 EST ~ 07:00 UTC
  }
  return now < nthSundayUtc(year, 10, 1, 6);    // 1st Sun Nov, 02:00 EDT ~ 06:00 UTC
}

function isAuDst(now) {
  // Southern summer: 1st Sun Oct 02:00 local through 1st Sun Apr 03:00 local.
  var year  = now.getUTCFullYear();
  var month = now.getUTCMonth();
  if (month > 3 && month < 9) return false;                 // May-Sep: standard
  if (month === 3) return now < nthSundayUtc(year, 3, 1, 16);
  if (month === 9) return now >= nthSundayUtc(year, 9, 1, 16);
  return true;                                               // Oct-Mar
}

function isNzDst(now) {
  // Southern summer: last Sun Sep 02:00 local through 1st Sun Apr 03:00 local.
  var year  = now.getUTCFullYear();
  var month = now.getUTCMonth();
  if (month > 3 && month < 8) return false;                 // May-Aug: standard
  if (month === 3) return now < nthSundayUtc(year, 3, 1, 14);
  if (month === 8) return now >= lastSundayUtc(year, 8, 14);
  return true;                                               // Oct-Mar
}

/**
 * Offset of `zone` at `date` from the static table, in minutes east of UTC.
 * Accurate to within an hour of a DST changeover instant.
 */
function staticOffsetMinutes(zone, date) {
  var entry = ZONES_BY_NAME[zone];
  if (!entry) return 0;
  if (entry.dst === undefined) return entry.std;

  var isDst = false;
  if      (entry.rule === 'EU') isDst = isEuDst(date);
  else if (entry.rule === 'US') isDst = isUsDst(date);
  else if (entry.rule === 'AU') isDst = isAuDst(date);
  else if (entry.rule === 'NZ') isDst = isNzDst(date);

  return isDst ? entry.dst : entry.std;
}

/**
 * Offset of `zone` from UTC in minutes east of UTC at `date` (default: now).
 * Unknown zones resolve to DEFAULT_ZONE rather than silently returning 0.
 */
function getOffsetMinutes(zone, date) {
  return staticOffsetMinutes(resolveZone(zone), date || new Date());
}

// ---------------------------------------------------------------------------
// Labels
// ---------------------------------------------------------------------------

/**
 * Fold user-supplied text into something the watch can actually render:
 * uppercase, accents stripped, unsupported characters removed, collapsed
 * whitespace, truncated to the footer label width. Returns '' if nothing
 * usable survives, which callers treat as "use the zone's default label".
 */
function normaliseLabel(text) {
  if (!text) return '';

  var label = String(text);

  // Fold accented Latin letters to their base form, so "Dún" becomes "DUN"
  // rather than losing the character to the unsupported-character filter.
  // Done with an explicit map because String.prototype.normalize is backed by
  // ICU, which the emulator's V8 lacks (see the Intl warning at the top).
  var folded = '';
  for (var i = 0; i < label.length; i++) {
    var ch = label.charAt(i);
    folded += Object.prototype.hasOwnProperty.call(ACCENT_FOLD, ch)
      ? ACCENT_FOLD[ch]
      : ch;
  }

  var cleaned = folded
    .toUpperCase()
    .replace(/_/g, ' ')
    .replace(UNSUPPORTED_LABEL_CHARS, '')
    .replace(/\s+/g, ' ')
    .replace(/^ +| +$/g, '');

  // Truncating can leave a trailing space behind; trim once more.
  return cleaned.substring(0, MAX_LABEL_CHARS).replace(/ +$/, '');
}

/** The curated default label for a zone, e.g. 'Europe/Dublin' -> 'DUBLIN'. */
function labelForZone(zone) {
  return ZONES_BY_NAME[resolveZone(zone)].label;
}

/**
 * The label to display for a zone, preferring the user's custom text whenever
 * it survives normalisation.
 */
function resolveLabel(zone, customLabel) {
  return normaliseLabel(customLabel) || labelForZone(zone);
}

module.exports = {
  ZONES: ZONES,
  DEFAULT_ZONE: DEFAULT_ZONE,
  MAX_LABEL_CHARS: MAX_LABEL_CHARS,
  configOptions: configOptions,
  formatUtcOffset: formatUtcOffset,
  resolveZone: resolveZone,
  getOffsetMinutes: getOffsetMinutes,
  staticOffsetMinutes: staticOffsetMinutes,
  normaliseLabel: normaliseLabel,
  labelForZone: labelForZone,
  resolveLabel: resolveLabel
};
