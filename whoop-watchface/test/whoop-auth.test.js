'use strict';

// Unit tests for src/pkjs/whoop-auth.js, plus the contracts it shares with
// whoop-callback.html and config.js. Run with: npm test

const test = require('node:test');
const assert = require('node:assert');
const { readFileSync } = require('node:fs');

const auth = require('../src/pkjs/whoop-auth.js');
const config = require('../src/pkjs/config.js');

const CALLBACK_HTML = readFileSync(__dirname + '/../whoop-callback.html', 'utf8');
const MANIFEST = JSON.parse(readFileSync(__dirname + '/../package.json', 'utf8'));

const NOW = new Date('2026-11-25T18:00:00Z');
const CREDS = { clientId: 'my-client', clientSecret: 's3cr&t=' };

/** Parses a form-encoded body back into an object. */
function parseForm(body) {
  return Object.fromEntries(new URLSearchParams(body));
}

// --- state ----------------------------------------------------------------

test('generateState makes 8 alphanumeric characters', () => {
  const state = auth.generateState();
  assert.strictEqual(state.length, auth.STATE_LENGTH);
  assert.strictEqual(auth.STATE_LENGTH, 8);
  assert.match(state, /^[A-Za-z0-9]{8}$/);
});

test('generateState uses the injected random source', () => {
  assert.strictEqual(auth.generateState(() => 0), 'AAAAAAAA');
  assert.strictEqual(auth.generateState(() => 0.9999), '99999999');
});

// --- request building -----------------------------------------------------

test('buildAuthorizeUrl carries client ID, redirect, all scopes and state', () => {
  const url = new URL(auth.buildAuthorizeUrl({
    clientId: 'my-client', redirectUri: 'http://localhost:8888/whoop-callback.html', state: 'abcd1234'
  }));
  assert.strictEqual(url.origin + url.pathname, auth.AUTHORIZE_URL);
  assert.strictEqual(url.searchParams.get('response_type'), 'code');
  assert.strictEqual(url.searchParams.get('client_id'), 'my-client');
  assert.strictEqual(url.searchParams.get('redirect_uri'), 'http://localhost:8888/whoop-callback.html');
  assert.strictEqual(url.searchParams.get('state'), 'abcd1234');
  assert.deepStrictEqual(url.searchParams.get('scope').split(' '),
    ['read:recovery', 'read:sleep', 'read:cycles', 'offline']);
});

test('buildAuthorizeUrl refuses missing inputs, naming the field', () => {
  assert.throws(() => auth.buildAuthorizeUrl({ clientId: ' ', redirectUri: 'x', state: 'y' }),
    /buildAuthorizeUrl: clientId is missing/);
  assert.throws(() => auth.buildAuthorizeUrl({ clientId: 'a', redirectUri: null, state: 'y' }),
    /redirectUri is missing/);
});

test('buildCodeExchangeBody is a form-encoded authorization_code grant', () => {
  const body = auth.buildCodeExchangeBody(Object.assign(
    { code: 'the code', redirectUri: 'http://localhost:8888/whoop-callback.html' }, CREDS));
  assert.deepStrictEqual(parseForm(body), {
    grant_type: 'authorization_code',
    code: 'the code',
    client_id: 'my-client',
    client_secret: 's3cr&t=',   // special characters survive encoding
    redirect_uri: 'http://localhost:8888/whoop-callback.html'
  });
});

test('buildRefreshBody asks for the offline scope', () => {
  assert.deepStrictEqual(parseForm(auth.buildRefreshBody(Object.assign({ refreshToken: 'r1' }, CREDS))), {
    grant_type: 'refresh_token',
    refresh_token: 'r1',
    client_id: 'my-client',
    client_secret: 's3cr&t=',
    scope: 'offline'
  });
  assert.throws(() => auth.buildRefreshBody(Object.assign({ refreshToken: '' }, CREDS)),
    /buildRefreshBody: refreshToken is missing/);
});

// --- token responses ------------------------------------------------------

test('a good token response gives tokens and an absolute expiry', () => {
  const result = auth.parseTokenResponse(200, JSON.stringify({
    access_token: 'a1', refresh_token: 'r2', expires_in: 3600, token_type: 'bearer'
  }), NOW);
  assert.deepStrictEqual(result, {
    ok: true,
    tokens: { accessToken: 'a1', refreshToken: 'r2', expiresAt: NOW.getTime() + 3600 * 1000 }
  });
});

test('a token response without refresh_token or expires_in still works', () => {
  const result = auth.parseTokenResponse(200, '{"access_token":"a1"}', NOW);
  assert.strictEqual(result.tokens.refreshToken, null);
  assert.strictEqual(result.tokens.expiresAt, NOW.getTime() + 3600 * 1000);
});

test('400 and 401 mean the grant is dead, with Whoop\'s reason', () => {
  const r400 = auth.parseTokenResponse(400,
    '{"error":"invalid_grant","error_description":"The refresh token is expired"}', NOW);
  assert.strictEqual(r400.ok, false);
  assert.strictEqual(r400.kind, 'rejected');
  assert.match(r400.message, /HTTP 400 \(The refresh token is expired\)/);
  assert.strictEqual(auth.parseTokenResponse(401, '', NOW).kind, 'rejected');
});

test('server errors and no response are temporary', () => {
  assert.strictEqual(auth.parseTokenResponse(503, '<html>', NOW).kind, 'temporary');
  const offline = auth.parseTokenResponse(0, '', NOW);
  assert.strictEqual(offline.kind, 'temporary');
  assert.match(offline.message, /no response/);
});

test('a 200 without an access token is malformed', () => {
  assert.strictEqual(auth.parseTokenResponse(200, 'not json', NOW).kind, 'malformed');
  assert.strictEqual(auth.parseTokenResponse(200, '{}', NOW).kind, 'malformed');
});

// --- refresh timing -------------------------------------------------------

test('needsRefresh is true when missing, expired or inside the margin', () => {
  const at = (msFromNow) => ({ accessToken: 'a', expiresAt: NOW.getTime() + msFromNow });
  assert.strictEqual(auth.needsRefresh(null, NOW), true);
  assert.strictEqual(auth.needsRefresh({ expiresAt: NOW.getTime() + 3600e3 }, NOW), true);
  assert.strictEqual(auth.needsRefresh(at(-1), NOW), true);
  assert.strictEqual(auth.needsRefresh(at(auth.REFRESH_MARGIN_MS - 1), NOW), true);
  assert.strictEqual(auth.needsRefresh(at(auth.REFRESH_MARGIN_MS + 1), NOW), false);
});

// --- callback -------------------------------------------------------------

/** What whoop-callback.html sends back, encoded as it encodes it. */
function callbackResponse(fields) {
  return encodeURIComponent(JSON.stringify({ [auth.CALLBACK_MARKER]: fields }));
}

test('parseCallbackResponse reads the callback page\'s response, encoded or raw', () => {
  const fields = { code: 'c1', state: 'abcd1234', error: '' };
  assert.deepStrictEqual(auth.parseCallbackResponse(callbackResponse(fields)), fields);
  assert.deepStrictEqual(
    auth.parseCallbackResponse(JSON.stringify({ whoopAuth: fields })), fields);
});

test('parseCallbackResponse ignores Clay saves and junk', () => {
  const claySave = encodeURIComponent(JSON.stringify({ SETTINGS_THEME: { value: true } }));
  assert.strictEqual(auth.parseCallbackResponse(claySave), null);
  assert.strictEqual(auth.parseCallbackResponse('%E0%A4%A'), null);   // bad URI encoding
  assert.strictEqual(auth.parseCallbackResponse(''), null);
  assert.strictEqual(auth.parseCallbackResponse(undefined), null);
});

test('validateCallback accepts only a matching state with a code', () => {
  assert.deepStrictEqual(
    auth.validateCallback({ code: 'c1', state: 'abcd1234', error: '' }, 'abcd1234'),
    { ok: true, code: 'c1' });

  const cases = [
    [{ code: 'c1', state: 'WRONG123', error: '' }, 'abcd1234', /did not match/],
    [{ code: 'c1', state: 'abcd1234', error: '' }, undefined, /no connection in progress/],
    [{ code: '',   state: 'abcd1234', error: '' }, 'abcd1234', /no code/],
    [{ code: '',   state: 'abcd1234', error: 'access_denied' }, 'abcd1234', /access_denied/],
    [null, 'abcd1234', /No Whoop callback/]
  ];
  for (const [callback, expected, message] of cases) {
    const result = auth.validateCallback(callback, expected);
    assert.strictEqual(result.ok, false);
    assert.match(result.message, message);
  }
});

// --- config page status ---------------------------------------------------

test('statusText walks the user through connecting', () => {
  assert.match(auth.statusText({}), /Enter your client ID and secret/);
  assert.match(auth.statusText({ clientId: 'a', clientSecret: 'b' }), /Tap Connect/);
  assert.match(auth.statusText({ clientId: 'a', clientSecret: 'b', lastError: 'Boom.' }),
    /Not connected: Boom\./);
  assert.match(auth.statusText({ refreshToken: 'r', lastError: 'stale' }), /^Connected/);
});

// --- contracts with the callback page and config --------------------------

test('the callback page uses the same marker and return-address cookie', () => {
  assert.ok(CALLBACK_HTML.includes(auth.CALLBACK_MARKER + ':'),
    'whoop-callback.html must wrap its payload in ' + auth.CALLBACK_MARKER);
  assert.ok(CALLBACK_HTML.includes("'" + config.RETURN_TO_COOKIE + "'"),
    'whoop-callback.html must read the ' + config.RETURN_TO_COOKIE + ' cookie');
  assert.ok(config.customFn.toString().includes("'" + config.RETURN_TO_COOKIE + "'"),
    'config.js customFn must write the ' + config.RETURN_TO_COOKIE + ' cookie');
});

test('Whoop credentials stay on the phone: never AppMessage keys', () => {
  for (const key of ['WHOOP_CLIENT_ID', 'WHOOP_CLIENT_SECRET']) {
    assert.ok(!MANIFEST.pebble.messageKeys.includes(key), key + ' must not be sent to the watch');
  }
});

test('the config page has the Whoop fields the phone reads', () => {
  const flatten = (items) => items.flatMap((i) => [i].concat(i.items ? flatten(i.items) : []));
  const all = flatten(config.items);
  const keys = all.map((i) => i.messageKey).filter(Boolean);
  const ids = all.map((i) => i.id).filter(Boolean);
  assert.ok(keys.includes('WHOOP_CLIENT_ID') && keys.includes('WHOOP_CLIENT_SECRET'));
  assert.ok(ids.includes('whoopStatus') && ids.includes('whoopConnect'));
  const secret = all.find((i) => i.messageKey === 'WHOOP_CLIENT_SECRET');
  assert.strictEqual(secret.attributes.type, 'password');
});
