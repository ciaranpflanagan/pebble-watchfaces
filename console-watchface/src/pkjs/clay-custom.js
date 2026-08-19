'use strict';

// ---------------------------------------------------------------------------
// Clay custom function.
//
// Clay serialises this with Function.prototype.toString() and injects the
// source into the config page, so it runs in the browser with no module
// system around it: it must not require() anything or close over anything
// defined here. Everything it needs comes from `this` (the ClayConfig) and the
// minified helpers Clay passes in.
//
// Its whole job is to hide the city picker when the bottom row is showing
// something other than the second timezone.
// ---------------------------------------------------------------------------

function clayCustomFn() {
  var clayConfig = this;

  clayConfig.on(clayConfig.EVENTS.AFTER_BUILD, function() {
    var complication = clayConfig.getItemByMessageKey('SETTINGS_COMPLICATION');
    var city         = clayConfig.getItemByMessageKey('SETTINGS_TZ_KEY');

    if (!complication || !city) return;

    function syncCityVisibility() {
      if (complication.get() === 'timezone') {
        city.show();
      } else {
        city.hide();
      }
    }

    complication.on('change', syncCityVisibility);
    syncCityVisibility();
  });
}

module.exports = clayCustomFn;
