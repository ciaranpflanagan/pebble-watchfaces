var accent = require('./accent.js');

// Clay config page. Whoop credentials and the Connect step arrive in a later
// phase; for now this covers appearance and weather.
module.exports = [
  {
    'type': 'heading',
    'defaultValue': 'Triad'
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
        'description': 'Colours the clock colon and the strain ring.'
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
    'type': 'submit',
    'defaultValue': 'Save'
  }
];
