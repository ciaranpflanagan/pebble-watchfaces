'use strict';

// Unit tests for src/pkjs/deck.js
// Run with: npm test   (from flashcards/)
//
// Two things here are worth more than the rest. The first is the byte budget:
// the watch has 4 kB and no way to report that a deck did not fit, so a deck
// too large has to be caught on this side, with the line number that caused it.
// The second is UTF-8. Deck text is going to have fadas in it, and every length
// the watch cares about is a byte length, so a chunk boundary that lands in the
// middle of a character is a broken glyph on the wrist.

const test = require('node:test');
const assert = require('node:assert');

const deck = require('../src/pkjs/deck.js');

const US = deck.UNIT_SEPARATOR;
const RS = deck.RECORD_SEPARATOR;

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

test('a heading and its cards parse into a deck', () => {
  const result = deck.parse([
    '# Irish Phrases',
    'Dia duit | Hello',
    'Slán | Goodbye'
  ].join('\n'));

  assert.deepStrictEqual(result.errors, []);
  assert.strictEqual(result.decks.length, 1);
  assert.strictEqual(result.decks[0].title, 'Irish Phrases');
  assert.deepStrictEqual(result.decks[0].cards, [
    { front: 'Dia duit', back: 'Hello' },
    { front: 'Slán', back: 'Goodbye' }
  ]);
});

test('several headings parse into several decks, in file order', () => {
  const result = deck.parse([
    '# One',
    'a | b',
    '',
    '# Two',
    'c | d',
    'e | f'
  ].join('\n'));

  assert.deepStrictEqual(result.errors, []);
  assert.deepStrictEqual(result.decks.map((d) => d.title), ['One', 'Two']);
  assert.deepStrictEqual(result.decks.map((d) => d.cards.length), [1, 2]);
});

test('cards before any heading open an implicit deck rather than failing', () => {
  const result = deck.parse('France | Paris\nSpain | Madrid');

  assert.deepStrictEqual(result.errors, []);
  assert.strictEqual(result.decks.length, 1);
  assert.strictEqual(result.decks[0].title, deck.UNTITLED);
  assert.strictEqual(result.decks[0].cards.length, 2);
});

test('only the first pipe splits a card, so a back may contain one', () => {
  const result = deck.parse('# D\ntá sé | it is | he is');

  assert.deepStrictEqual(result.decks[0].cards, [
    { front: 'tá sé', back: 'it is | he is' }
  ]);
});

test('blank lines and surrounding whitespace are ignored', () => {
  const result = deck.parse('\n\n#   Spaced   \n\n   a   |   b   \n\n');

  assert.strictEqual(result.decks[0].title, 'Spaced');
  assert.deepStrictEqual(result.decks[0].cards, [{ front: 'a', back: 'b' }]);
});

test('CRLF line endings do not leave a stray return on the last word', () => {
  const result = deck.parse('# D\r\nDia duit | Hello\r\n');

  assert.deepStrictEqual(result.decks[0].cards, [{ front: 'Dia duit', back: 'Hello' }]);
});

test('the separator characters are stripped out of user text', () => {
  // If these survived they would be read back as card boundaries by the watch.
  const result = deck.parse('# D\nfr' + US + 'ont | ba' + RS + 'ck');

  const card = result.decks[0].cards[0];
  assert.ok(card.front.indexOf(US) === -1, 'unit separator survived in the front');
  assert.ok(card.back.indexOf(RS) === -1, 'record separator survived in the back');
  assert.deepStrictEqual(card, { front: 'fr ont', back: 'ba ck' });
});

// ---------------------------------------------------------------------------
// Errors — collected with a line number, never aborting the parse
// ---------------------------------------------------------------------------

test('a line with no pipe is skipped and reported, and the deck still loads', () => {
  const result = deck.parse([
    '# D',
    'a | b',
    'this line is a mistake',
    'c | d'
  ].join('\n'));

  assert.strictEqual(result.errors.length, 1);
  assert.strictEqual(result.errors[0].line, 3);
  assert.match(result.errors[0].message, /No \|/);
  assert.strictEqual(result.decks[0].cards.length, 2);
});

test('a card missing a side is reported with its line number', () => {
  const result = deck.parse('# D\ngood | card\nlonely |');

  assert.strictEqual(result.errors.length, 1);
  assert.strictEqual(result.errors[0].line, 3);
  assert.strictEqual(result.decks[0].cards.length, 1);
});

test('an empty heading is reported and the deck is named Untitled', () => {
  const result = deck.parse('#\na | b');

  assert.strictEqual(result.errors.length, 1);
  assert.strictEqual(result.errors[0].line, 1);
  assert.strictEqual(result.decks[0].title, deck.UNTITLED);
});

test('a heading with no cards is dropped and reported', () => {
  const result = deck.parse('# Empty\n\n# Full\na | b');

  assert.strictEqual(result.errors.length, 1);
  assert.match(result.errors[0].message, /no cards/);
  assert.deepStrictEqual(result.decks.map((d) => d.title), ['Full']);
});

test('empty text is an error rather than an empty success', () => {
  for (const input of ['', '   \n\n  ', null, undefined]) {
    const result = deck.parse(input);
    assert.strictEqual(result.decks.length, 0);
    assert.ok(result.errors.length > 0, 'expected an error for ' + JSON.stringify(input));
  }
});

test('a long deck name is shortened and reported', () => {
  const longTitle = 'N'.repeat(deck.MAX_TITLE_CHARS + 10);
  const result = deck.parse('# ' + longTitle + '\na | b');

  assert.strictEqual(result.decks[0].title.length, deck.MAX_TITLE_CHARS);
  assert.match(result.errors[0].message, /shortened/);
});

test('a long card side is shortened and reported', () => {
  const longSide = 'x'.repeat(deck.MAX_SIDE_CHARS + 10);
  const result = deck.parse('# D\n' + longSide + ' | b');

  assert.strictEqual(result.decks[0].cards[0].front.length, deck.MAX_SIDE_CHARS);
  assert.match(result.errors[0].message, /shortened/);
});

// ---------------------------------------------------------------------------
// Limits — the watch's 4 kB, enforced here because it cannot be enforced there
// ---------------------------------------------------------------------------

test('cards past the per-deck cap are skipped, not silently truncated', () => {
  const lines = ['# Big'];
  for (let i = 0; i < deck.MAX_CARDS_PER_DECK + 5; i++) lines.push('f' + i + ' | b' + i);

  const result = deck.parse(lines.join('\n'));

  assert.strictEqual(result.decks[0].cards.length, deck.MAX_CARDS_PER_DECK);
  assert.ok(result.errors.length > 0);
  // The first card over the line is the one reported: heading + cap + 1.
  assert.strictEqual(result.errors[0].line, deck.MAX_CARDS_PER_DECK + 2);
});

test('a deck is never allowed past the byte budget', () => {
  // Long cards, so the budget bites well before the card-count cap does.
  const side = 'x'.repeat(deck.MAX_SIDE_CHARS);
  const lines = ['# Heavy'];
  for (let i = 0; i < 40; i++) lines.push(side + ' | ' + side);

  const result = deck.parse(lines.join('\n'));
  const parsed = result.decks[0];

  assert.ok(parsed.bytes <= deck.DECK_BUDGET_BYTES,
    'deck of ' + parsed.bytes + ' bytes exceeded the budget');
  assert.ok(parsed.cards.length < 40, 'expected some cards to be refused');
  assert.ok(result.errors.some((e) => /full/.test(e.message)));
});

test('decks past the library cap are dropped and reported', () => {
  const lines = [];
  for (let i = 0; i < deck.MAX_DECKS + 3; i++) lines.push('# Deck ' + i, 'a | b');

  const result = deck.parse(lines.join('\n'));

  assert.strictEqual(result.decks.length, deck.MAX_DECKS);
  assert.ok(result.errors.some((e) => e.line === null && /3 were dropped/.test(e.message)));
});

test('the sample deck parses cleanly', () => {
  const result = deck.parse(deck.SAMPLE_TEXT);

  assert.deepStrictEqual(result.errors, []);
  assert.deepStrictEqual(result.decks.map((d) => d.title), ['Irish Phrases', 'Capitals']);
});

// ---------------------------------------------------------------------------
// UTF-8
// ---------------------------------------------------------------------------

test('utf8Length counts bytes, not characters', () => {
  assert.strictEqual(deck.utf8Length('abc'), 3);
  assert.strictEqual(deck.utf8Length('Slán'), 5);          // á is two bytes
  assert.strictEqual(deck.utf8Length('€'), 3);
  assert.strictEqual(deck.utf8Length('😀'), 4);            // one surrogate pair
  assert.strictEqual(deck.utf8Length(''), 0);
});

test('utf8Length agrees with Node on real text', () => {
  const samples = ['Dia duit', 'Go raibh maith agat', 'Sláinte — céad míle fáilte', '日本語', 'a😀b'];

  for (const sample of samples) {
    assert.strictEqual(deck.utf8Length(sample), Buffer.byteLength(sample, 'utf8'), sample);
  }
});

test('chunkUtf8 never splits a multi-byte character', () => {
  // Every character is two bytes, so an odd byte limit forces the boundary to
  // land where a naive split would cut a character in half.
  const text = 'á'.repeat(20);
  const chunks = deck.chunkUtf8(text, 5);

  assert.strictEqual(chunks.join(''), text);

  for (const chunk of chunks) {
    assert.ok(Buffer.byteLength(chunk, 'utf8') <= 5, 'chunk over the limit');
    // A chunk that split a character would not survive a decode round trip.
    assert.strictEqual(Buffer.from(chunk, 'utf8').toString('utf8'), chunk);
  }
});

test('chunkUtf8 keeps a surrogate pair together', () => {
  const text = '😀😀😀';
  const chunks = deck.chunkUtf8(text, 5);   // one emoji is 4 bytes, so one each

  assert.deepStrictEqual(chunks, ['😀', '😀', '😀']);
  assert.strictEqual(chunks.join(''), text);
});

test('chunkUtf8 returns nothing for empty text', () => {
  assert.deepStrictEqual(deck.chunkUtf8('', 10), []);
});

// ---------------------------------------------------------------------------
// Serialising
// ---------------------------------------------------------------------------

test('cards serialise to separator-delimited records with a trailing separator', () => {
  const parsed = deck.parse('# D\na | b\nc | d').decks[0];

  assert.strictEqual(deck.serialiseCards(parsed), 'a' + US + 'b' + RS + 'c' + US + 'd' + RS);
});

test('the index carries every deck title and card count', () => {
  const parsed = deck.parse('# One\na | b\n# Two\nc | d\ne | f').decks;

  assert.strictEqual(deck.serialiseIndex(parsed), 'One' + US + '1' + RS + 'Two' + US + '2' + RS);
});

test('chunked cards reassemble exactly, within the chunk limit', () => {
  const lines = ['# Big'];
  for (let i = 0; i < 60; i++) lines.push('fáda ' + i + ' | back ' + i);

  const parsed = deck.parse(lines.join('\n')).decks[0];
  const chunks = deck.chunkCards(parsed);

  assert.ok(chunks.length > 1, 'expected the deck to need several chunks');
  assert.strictEqual(chunks.join(''), deck.serialiseCards(parsed));

  for (const chunk of chunks) {
    assert.ok(Buffer.byteLength(chunk, 'utf8') <= deck.CHUNK_BYTES, 'chunk over CHUNK_BYTES');
  }
});

test('a deck at the budget still chunks into fields the watch can store', () => {
  const side = 'x'.repeat(deck.MAX_SIDE_CHARS);
  const lines = ['# Heavy'];
  for (let i = 0; i < 40; i++) lines.push(side + ' | ' + side);

  const parsed = deck.parse(lines.join('\n')).decks[0];
  const chunks = deck.chunkCards(parsed);

  // Pebble allows 256 bytes per persist field; CHUNK_BYTES leaves margin below
  // it for the NUL terminator and the transfer header.
  for (const chunk of chunks) {
    assert.ok(Buffer.byteLength(chunk, 'utf8') <= 256);
  }
  assert.strictEqual(chunks.join(''), deck.serialiseCards(parsed));
});

test('deckBytes matches what the serialised cards actually weigh', () => {
  const parsed = deck.parse('# D\nSlán | Goodbye\na | b').decks[0];

  assert.strictEqual(parsed.bytes, Buffer.byteLength(deck.serialiseCards(parsed), 'utf8'));
});

// ---------------------------------------------------------------------------
// Library signature — what tells the watch its cached deck has gone stale
// ---------------------------------------------------------------------------

test('the signature is stable for the same library', () => {
  const a = deck.parse(deck.SAMPLE_TEXT).decks;
  const b = deck.parse(deck.SAMPLE_TEXT).decks;

  assert.strictEqual(deck.signature(a), deck.signature(b));
});

test('the signature changes when a card changes', () => {
  const before = deck.parse('# D\na | b').decks;
  const after = deck.parse('# D\na | c').decks;

  assert.notStrictEqual(deck.signature(before), deck.signature(after));
});

test('the signature changes when decks are reordered', () => {
  // The case the signature exists for: the watch caches a deck by index, and a
  // reorder leaves the indices valid but pointing at the wrong cards.
  const before = deck.parse('# One\na | b\n# Two\nc | d').decks;
  const after = deck.parse('# Two\nc | d\n# One\na | b').decks;

  assert.notStrictEqual(deck.signature(before), deck.signature(after));
});

test('the signature changes when a deck is renamed', () => {
  const before = deck.parse('# One\na | b').decks;
  const after = deck.parse('# Uno\na | b').decks;

  assert.notStrictEqual(deck.signature(before), deck.signature(after));
});

test('the signature fits in the positive half of a 32-bit integer', () => {
  // It travels as an AppMessage int32; a negative value would read as a
  // different number on the watch.
  const lines = [];
  for (let i = 0; i < deck.MAX_DECKS; i++) lines.push('# Deck ' + i, 'fáda ' + i + ' | back ' + i);

  for (const text of [deck.SAMPLE_TEXT, lines.join('\n'), '# D\na | b']) {
    const value = deck.signature(deck.parse(text).decks);
    assert.ok(Number.isInteger(value) && value >= 0 && value <= 0x7fffffff, 'out of range: ' + value);
  }
});
