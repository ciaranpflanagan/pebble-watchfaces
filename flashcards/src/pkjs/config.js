'use strict';

var accent = require('./accent.js');
var deck   = require('./deck.js');

module.exports = [
  {
    'type': 'heading',
    'defaultValue': 'Cue Card'
  },
  {
    'type': 'section',
    'items': [
      {
        'type': 'heading',
        'defaultValue': 'Decks'
      },
      {
        'type': 'text',
        'defaultValue':
          'One deck per <code>#</code> heading, one card per line, with a ' +
          '<code>|</code> between the two sides:<br><br>' +
          '<code># Irish Phrases<br>Dia duit | Hello<br>' +
          'Go raibh maith agat | Thank you</code><br><br>' +
          'Up to ' + deck.MAX_DECKS + ' decks. Every deck stays on your phone; ' +
          'the watch holds the list of them and whichever one you last opened.'
      },
      {
        'type': 'input',
        'messageKey': 'DECK_URL',
        'label': 'Deck URL',
        'defaultValue': '',
        'attributes': {
          'placeholder': 'https://example.com/decks.txt',
          'type': 'url'
        },
        'description': 'Optional. A plain-text file in the format above — a raw ' +
                       'Gist works well. If this is set it replaces the box ' +
                       'below, so a deck can be edited without opening this page.'
      },
      // Hidden while a URL is set — see src/pkjs/clay-custom.js.
      {
        'type': 'textarea',
        'messageKey': 'DECK_TEXT',
        'label': 'Decks',
        'defaultValue': deck.SAMPLE_TEXT,
        'description': 'Leave this empty to fall back to the sample decks.'
      }
    ]
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
        'description': 'Marks the front of a card, the progress bar and the ' +
                       'selected deck.'
      }
    ]
  },
  {
    'type': 'submit',
    'defaultValue': 'Save'
  }
];
