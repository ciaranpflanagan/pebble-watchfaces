'use strict';

// ---------------------------------------------------------------------------
// Opening the Clay config page in the emulator.
//
// pebble-tool 5's emulator serves a config page itself when the app opens a
// data: URI: it hosts the HTML at http://localhost:<port>/config/<uuid>/ and
// opens that with ?return_to=<where to send the saved settings>. Anything
// else (an http URL carrying the whole page in its #hash, as the old
// clay-proxy.html workaround did) is ~100 KB, and the emulator never passes
// it to `pebble emu-app-config`, which then times out.
//
// In the emulator Clay builds its page with a "$$RETURN_TO$$" placeholder for
// the return address, which its hosted page used to fill in from the query
// string. Nothing fills it in now, so toDataUri swaps it for code that reads
// return_to from the page's own query string, as that hosted page did.
// ---------------------------------------------------------------------------

// As it appears in pebble-clay's bundled page template (a test checks it).
var RETURN_TO_PLACEHOLDER = '"$$RETURN_TO$$"';
var RETURN_TO_FROM_QUERY =
  "(new URLSearchParams(location.search).get('return_to') || 'pebblejs://close#')";

/**
 * Turns Clay's emulator URL (<hosted page>#<encoded HTML>) into a data: URI
 * whose page finds its return address in its own query string.
 *
 * @param {string} clayUrl - from clay.generateUrl() while running in the emulator
 * @return {string}
 */
function toDataUri(clayUrl) {
  var hashAt = typeof clayUrl === 'string' ? clayUrl.indexOf('#') : -1;
  if (hashAt === -1) {
    throw new Error('emulator-config: Clay URL has no #page part; did pebble-clay change?');
  }
  var html = decodeURIComponent(clayUrl.substring(hashAt + 1));
  if (html.indexOf(RETURN_TO_PLACEHOLDER) === -1) {
    throw new Error('emulator-config: Clay page has no ' + RETURN_TO_PLACEHOLDER +
                    ' placeholder; did pebble-clay change?');
  }
  // split/join, not replace: '$' in a replacement string is special.
  html = html.split(RETURN_TO_PLACEHOLDER).join(RETURN_TO_FROM_QUERY);
  return 'data:text/html;charset=utf-8,' + encodeURIComponent(html);
}

module.exports = {
  RETURN_TO_PLACEHOLDER: RETURN_TO_PLACEHOLDER,
  toDataUri: toDataUri
};
