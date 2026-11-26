var accent = require('./accent.js');

// ---------------------------------------------------------------------------
// Clay config page: appearance, weather and the Whoop connection.
//
// The Whoop client ID and secret are Clay inputs with messageKeys so Clay
// saves and pre-fills them, but they are NOT AppMessage keys: index.js reads
// them from the config response and keeps them on the phone. They never go to
// the watch, so they are deliberately absent from package.json's messageKeys.
// ---------------------------------------------------------------------------

// The cookie that carries our return address to whoop-callback.html.
// Keep in step with that page.
var RETURN_TO_COOKIE = 'whebbleWhoopReturnTo';

var items = [
  {
    'type': 'heading',
    'defaultValue': 'Whebble'
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
    'type': 'section',
    'items': [
      {
        'type': 'heading',
        'defaultValue': 'Whoop'
      },
      {
        'type': 'text',
        'id': 'whoopStatus',
        'defaultValue': ''
      },
      {
        'type': 'input',
        'messageKey': 'WHOOP_CLIENT_ID',
        'label': 'Client ID',
        'defaultValue': '',
        'attributes': { 'autocapitalize': 'off', 'autocorrect': 'off', 'spellcheck': 'false' }
      },
      {
        'type': 'input',
        'messageKey': 'WHOOP_CLIENT_SECRET',
        'label': 'Client Secret',
        'defaultValue': '',
        'description': 'From your app in the Whoop developer dashboard. Stored only on your phone.',
        'attributes': { 'type': 'password', 'autocomplete': 'off' }
      },
      {
        'type': 'button',
        'id': 'whoopConnect',
        'primary': true,
        'defaultValue': 'Connect to Whoop',
        'description': 'Save your client ID and secret first, then reopen settings to connect.'
      }
    ]
  },
  {
    'type': 'submit',
    'defaultValue': 'Save'
  }
];

/**
 * Runs inside the config page (Clay serialises it with toString), so it can't
 * use anything from this file's scope. Its only input is meta.userData.whoop,
 * set by index.js just before the page opens:
 *
 *   { status: string, authorizeUrl: string|null, connected: boolean }
 *
 * authorizeUrl is null until a client ID and secret are saved, which hides
 * the Connect button.
 */
function customFn() {
  var clayConfig = this;
  // Duplicated from RETURN_TO_COOKIE above: this function can't see it.
  var returnToCookie = 'whebbleWhoopReturnTo';

  clayConfig.on(clayConfig.EVENTS.AFTER_BUILD, function() {
    var whoop = (clayConfig.meta.userData && clayConfig.meta.userData.whoop) || {};
    var status = clayConfig.getItemById('whoopStatus');
    var connect = clayConfig.getItemById('whoopConnect');

    if (status) status.set(whoop.status || '');
    if (!connect) return;

    if (!whoop.authorizeUrl) {
      connect.hide();
      return;
    }

    connect.set(whoop.connected ? 'Reconnect to Whoop' : 'Connect to Whoop');
    connect.on('click', function() {
      // whoop-callback.html needs our return address to get back to the
      // watchface (it varies in the emulator; see that page). A cookie, not
      // localStorage: in the emulator this page and the callback are both on
      // localhost but on different ports, and cookies ignore the port. On a
      // real phone this page is a data: URI where cookies fail, and the
      // callback's default return address is correct there anyway.
      try {
        document.cookie = returnToCookie + '=' +
          encodeURIComponent(window.returnTo || 'pebblejs://close#') + '; path=/; max-age=900';
      } catch (e) {
        console.log('Could not store return address for the Whoop callback: ' + e);
      }
      window.location.href = whoop.authorizeUrl;
    });
  });
}

module.exports = {
  RETURN_TO_COOKIE: RETURN_TO_COOKIE,
  items: items,
  customFn: customFn
};
