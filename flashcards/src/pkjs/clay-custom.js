'use strict';

// ---------------------------------------------------------------------------
// Clay custom function.
//
// Clay serialises this with Function.prototype.toString() and injects the
// source into the config page, so it runs in the browser with no module system
// around it: it must not require() anything or close over anything defined
// here. Everything it needs comes from `this` (the ClayConfig).
//
// Its job is to hide the deck textarea while a deck URL is set. The two are
// alternatives rather than additions — index.js prefers the URL whenever it has
// one — and showing both would invite someone to type into a box that is being
// ignored.
// ---------------------------------------------------------------------------

function clayCustomFn() {
  var clayConfig = this;

  clayConfig.on(clayConfig.EVENTS.AFTER_BUILD, function() {
    var url  = clayConfig.getItemByMessageKey('DECK_URL');
    var text = clayConfig.getItemByMessageKey('DECK_TEXT');

    if (!url || !text) return;

    function syncTextVisibility() {
      var value = url.get();

      if (value && String(value).trim() !== '') {
        text.hide();
      } else {
        text.show();
      }
    }

    url.on('change', syncTextVisibility);
    syncTextVisibility();
  });
}

module.exports = clayCustomFn;
