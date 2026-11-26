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
          'Up to ' + deck.MAX_DECKS + ' decks, ' + deck.MAX_CARDS_PER_DECK +
          ' cards each. Every deck stays on your phone; the watch holds the ' +
          'list of them and whichever one you last opened.'
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
        'type': 'deckeditor',
        'messageKey': 'DECK_TEXT',
        'label': 'Decks',
        'defaultValue': deck.SAMPLE_TEXT
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
        // The raw integer, not '0xRRGGBB'. Clay's colour component lowercases
        // whatever it is given and pads it to six characters, so a '0x' prefix
        // survives into the sunlight palette lookup, misses, and paints the
        // swatch '#undefined' — it renders blank rather than failing.
        'defaultValue': accent.DEFAULT_ACCENT,
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
