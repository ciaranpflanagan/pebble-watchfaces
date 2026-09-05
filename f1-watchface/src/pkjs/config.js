'use strict';

var board   = require('./board.js');
var accent  = require('./accent.js');
var sources = require('./sources.js');

module.exports = [
  {
    'type': 'heading',
    'defaultValue': 'Pit Wall'
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
        'description': 'Colours the clock colon, the session marker and the leader.'
      }
    ]
  },
  {
    'type': 'section',
    'items': [
      {
        'type': 'heading',
        'defaultValue': 'Timing'
      },
      {
        'type': 'radiogroup',
        'messageKey': 'SETTINGS_GAP_MODE',
        'label': 'Second and third rows',
        'defaultValue': board.DEFAULT_GAP_MODE,
        'options': [
          { 'label': 'Gap to the leader (+0.102)', 'value': 'gap' },
          { 'label': 'Their own time (1:11.265)',  'value': 'absolute' }
        ],
        'description': 'The leader always shows an absolute time.'
      }
    ]
  },
  {
    'type': 'section',
    'items': [
      {
        'type': 'heading',
        'defaultValue': 'Data'
      },
      {
        'type': 'select',
        'messageKey': 'SETTINGS_SOURCE',
        'label': 'Source',
        'defaultValue': sources.DEFAULT_SOURCE,
        'options': sources.configOptions(),
        'description': 'Results (Jolpica) is free and needs no key, but a ' +
                       'session only appears once it has finished, and ' +
                       'practice sessions never do. Live timing (OpenF1) ' +
                       'covers every session as it happens — but OpenF1 ' +
                       'blocks unauthenticated requests while a session is ' +
                       'running, so a live board needs a paid API key. ' +
                       'Either way the face falls back to results when live ' +
                       'timing is unavailable.'
      },
      // Hidden unless the live source is selected — see src/pkjs/clay-custom.js.
      {
        'type': 'input',
        'messageKey': 'SETTINGS_API_KEY',
        'label': 'OpenF1 API Key',
        'defaultValue': '',
        'attributes': {
          'placeholder': 'Paste your OpenF1 key',
          'maxlength': sources.MAX_API_KEY_CHARS
        },
        'description': 'Sent to api.openf1.org as a bearer token, and stored ' +
                       'on your phone only. Keys are sold at openf1.org.'
      }
    ]
  },
  {
    'type': 'submit',
    'defaultValue': 'Save'
  }
];
