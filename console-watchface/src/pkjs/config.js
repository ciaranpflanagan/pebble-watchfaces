var timezones = require('./timezones.js');

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
        'defaultValue': 'Second Timezone'
      },
      {
        'type': 'text',
        'defaultValue': TWO_COLUMN_STYLE
      },
      // Left column: declared before the select so it lands on the left.
      {
        'type': 'input',
        'messageKey': 'SETTINGS_TZ_LABEL',
        'label': 'Label',
        'defaultValue': '',
        'attributes': {
          'placeholder': 'City name',
          'maxlength': timezones.MAX_LABEL_CHARS,
          'data-tz-col': 'left'
        },
        'description': 'Shown on the watch, in capitals. Up to ' +
                       timezones.MAX_LABEL_CHARS +
                       ' characters. Leave blank to use the city name.'
      },
      // Right column.
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
