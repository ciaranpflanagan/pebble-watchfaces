'use strict';

// Unit tests for src/pkjs/emulator-config.js. Run with: npm test

const test = require('node:test');
const assert = require('node:assert');
const { readFileSync } = require('node:fs');

const emulatorConfig = require('../src/pkjs/emulator-config.js');

// The page template as pebble-clay bundles it into the app.
const CLAY_BUNDLE = readFileSync(
  require.resolve('pebble-clay/dist/js/index.js', { paths: [__dirname + '/..'] }), 'utf8');

/** What clay.generateUrl() returns in the emulator: hosted page + #encoded HTML. */
function clayEmulatorUrl(html) {
  return 'http://clay.pebble.com.s3-website-us-west-2.amazonaws.com/#' + encodeURIComponent(html);
}

/** The HTML inside a data: URI. */
function decodeDataUri(uri) {
  const prefix = 'data:text/html;charset=utf-8,';
  assert.ok(uri.startsWith(prefix), 'not an HTML data: URI: ' + uri.slice(0, 40));
  return decodeURIComponent(uri.slice(prefix.length));
}

test('pebble-clay\'s page template still has the placeholder we replace', () => {
  assert.ok(CLAY_BUNDLE.includes('window.returnTo=' + emulatorConfig.RETURN_TO_PLACEHOLDER),
    'pebble-clay changed how its page gets the return address; update emulator-config.js');
});

test('toDataUri makes the page read return_to from its own query string', () => {
  const page = '<script>window.returnTo="$$RETURN_TO$$",window.x=1</script><p>50% $off</p>';
  const html = decodeDataUri(emulatorConfig.toDataUri(clayEmulatorUrl(page)));

  assert.ok(!html.includes('$$RETURN_TO$$'));
  assert.ok(html.includes("new URLSearchParams(location.search).get('return_to')"));
  assert.ok(html.includes('<p>50% $off</p>'), 'the rest of the page must survive untouched');

  // Run the resulting assignment as the browser would.
  const assignment = html.match(/window\.returnTo=(.*?),window\.x/)[1];
  const evaluate = (search) => new Function('location', 'return ' + assignment)({ search });
  assert.strictEqual(evaluate('?return_to=http%3A%2F%2Flocalhost%3A5000%2Fclose%3F'),
    'http://localhost:5000/close?');
  assert.strictEqual(evaluate(''), 'pebblejs://close#');
});

test('toDataUri explains what broke if Clay\'s URL or page changes', () => {
  assert.throws(() => emulatorConfig.toDataUri('http://no-hash.example/'), /no #page part/);
  assert.throws(() => emulatorConfig.toDataUri(clayEmulatorUrl('<p>no placeholder</p>')),
    /no "\$\$RETURN_TO\$\$" placeholder/);
  assert.throws(() => emulatorConfig.toDataUri(undefined), /no #page part/);
});
