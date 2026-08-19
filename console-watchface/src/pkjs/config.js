var timezones     = require('./timezones.js');
var complications = require('./complications.js');
var accent        = require('./accent.js');

// ---------------------------------------------------------------------------
// Clay has no column primitive: every component renders as a block-level
// `.component` div, and a section renders as a `.section` div wrapping them.
//
// To lay the label and city side by side we inject a stylesheet through a
// `text` item (Clay renders those with its `html` manipulator, so raw markup
// survives) and turn the containing section into a flex row. The section is
// selected with `:has()` on the data-tz-col attributes hung off the two
// inputs, so no other section on the page is affected.
//
// Where `:has()` is unsupported the rules simply never match and the two
// components stack vertically, which is Clay's normal layout. Narrow screens
// stack them too — two side-by-side fields under ~420px are unusable on a
// phone.
// ---------------------------------------------------------------------------
var TWO_COLUMN_STYLE =
  '<style>' +
  '.section:has([data-tz-col]) {' +
  '  display: flex;' +
  '  flex-wrap: wrap;' +
  '  align-items: flex-start;' +
  '  column-gap: 12px;' +
  '}' +
  // The heading and this style holder span the full width of the row.
  '.section:has([data-tz-col]) > .component-heading,' +
  '.section:has([data-tz-col]) > .component-text {' +
  '  flex: 0 0 100%;' +
  '  margin: 0;' +
  '}' +
  // Label (left) and city (right) share the remaining width evenly.
  '.section:has([data-tz-col]) > .component-input,' +
  '.section:has([data-tz-col]) > .component-select {' +
  '  flex: 1 1 0;' +
  '  min-width: 0;' +
  '}' +
  // The complication picker sits on its own line above that pair.
  '.section:has([data-tz-col]) > .component-select:has([data-tz-col="full"]) {' +
  '  flex: 0 0 100%;' +
  '}' +
  '@media (max-width: 420px) {' +
  '  .section:has([data-tz-col]) > .component-input,' +
  '  .section:has([data-tz-col]) > .component-select {' +
  '    flex: 0 0 100%;' +
  '  }' +
  '}' +
  '</style>';

module.exports = [
  {
    'type': 'heading',
    'defaultValue': 'Homezone'
  },
  {
    'type': 'section',
    'items': [
      {
        'type': 'heading',
        'defaultValue': 'Appearance'
      },
      {
        'type': 'toggle',
        'messageKey': 'SETTINGS_THEME',
        'label': 'Light Theme',
        'defaultValue': false,
        'description': 'Switch between dark and light backgrounds'
      },
      {
        'type': 'color',
        'messageKey': 'SETTINGS_ACCENT',
        'label': 'Accent Colour',
        'defaultValue': accent.toHexString(accent.DEFAULT_ACCENT),
        'sunlight': true,
        'description': 'Colours the clock colon and the bottom-row marker.'
      }
    ]
  },
  {
    'type': 'section',
    'items': [
      {
        'type': 'heading',
        'defaultValue': 'Weather'
      },
      {
        'type': 'radiogroup',
        'messageKey': 'SETTINGS_TEMP_UNIT',
        'label': 'Temperature Unit',
        'defaultValue': 'C',
        'options': [
          { 'label': 'Celsius (°C)', 'value': 'C' },
          { 'label': 'Fahrenheit (°F)', 'value': 'F' }
        ]
      }
    ]
  },
  {
    'type': 'section',
    'items': [
      {
        'type': 'heading',
        'defaultValue': 'Bottom Row'
      },
      {
        'type': 'text',
        'defaultValue': TWO_COLUMN_STYLE
      },
      {
        'type': 'select',
        'messageKey': 'SETTINGS_COMPLICATION',
        'label': 'Show',
        'defaultValue': complications.DEFAULT_COMPLICATION,
        'options': complications.configOptions(),
        'attributes': {
          'data-tz-col': 'full'
        },
        'description': 'Steps, heart rate and calories come from Pebble Health ' +
                       'and read as -- while health tracking is switched off.'
      },
      // Left column: declared before the city select so it lands on the left.
      {
        'type': 'input',
        'messageKey': 'SETTINGS_TZ_LABEL',
        'label': 'Label',
        'defaultValue': '',
        'attributes': {
          'placeholder': 'Leave blank for default',
          'maxlength': timezones.MAX_LABEL_CHARS,
          'data-tz-col': 'left'
        },
        'description': 'Shown on the watch, in capitals. Up to ' +
                       timezones.MAX_LABEL_CHARS +
                       ' characters. Applies to whatever the bottom row is ' +
                       'showing. Leave blank for the city name, or STEPS, ' +
                       'BATTERY, HEART, CALS.'
      },
      // Right column. Hidden unless the bottom row is the second timezone
      // (see src/pkjs/clay-custom.js).
      {
        'type': 'select',
        'messageKey': 'SETTINGS_TZ_KEY',
        'label': 'City',
        'defaultValue': timezones.DEFAULT_ZONE,
        'options': timezones.configOptions(),
        'attributes': {
          'data-tz-col': 'right'
        }
      }
    ]
  },
  {
    'type': 'submit',
    'defaultValue': 'Save'
  }
];
