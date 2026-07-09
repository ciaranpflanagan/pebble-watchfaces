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
        'type': 'select',
        'messageKey': 'SETTINGS_TZ_KEY',
        'label': 'City',
        'defaultValue': 'DUB',
        'options': [
          { 'label': 'Dublin / London',  'value': 'DUB' },
          { 'label': 'New York',          'value': 'NYC' },
          { 'label': 'Los Angeles',       'value': 'LAX' },
          { 'label': 'Chicago',           'value': 'CHI' },
          { 'label': 'UTC',               'value': 'UTC' },
          { 'label': 'Paris / Berlin',    'value': 'PAR' },
          { 'label': 'Tokyo',             'value': 'TYO' },
          { 'label': 'Sydney',            'value': 'SYD' },
          { 'label': 'Dubai',             'value': 'DXB' },
          { 'label': 'Hong Kong',         'value': 'HKG' }
        ]
      }
    ]
  },
  {
    'type': 'submit',
    'defaultValue': 'Save'
  }
];
