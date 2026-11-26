'use strict';

// ---------------------------------------------------------------------------
// Clay custom function.
//
// Clay serialises this with Function.prototype.toString() and injects the
// source into the config page, so it runs in the browser with no module system
// around it: it must not require() anything or close over anything defined
// here. Everything it needs comes from `this` (the ClayConfig).
//
// Its job is to hide the OpenF1 API key field unless the live source is
// selected — the free results source has no use for a key, and an empty box
// asking for one reads like something is missing.
// ---------------------------------------------------------------------------

function clayCustomFn() {
  var clayConfig = this;

  clayConfig.on(clayConfig.EVENTS.AFTER_BUILD, function() {
    var source = clayConfig.getItemByMessageKey('SETTINGS_SOURCE');
    var apiKey = clayConfig.getItemByMessageKey('SETTINGS_API_KEY');

    if (!source || !apiKey) return;

    function syncApiKeyVisibility() {
      if (source.get() === 'live') {
        apiKey.show();
      } else {
        apiKey.hide();
      }
    }

    source.on('change', syncApiKeyVisibility);
    syncApiKeyVisibility();
  });
}

module.exports = clayCustomFn;
