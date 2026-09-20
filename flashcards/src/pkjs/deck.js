'use strict';

// ---------------------------------------------------------------------------
// The deck library: parsing, limits and the wire format.
//
// One plain-text format, whatever the transport. A deck is a `#` heading and
// the cards beneath it:
//
//     # Irish Phrases
//     Dia duit | Hello
//     Go raibh maith agat | Thank you
//
// The same text arrives either pasted into the Clay textarea or fetched from a
// URL, so parsing lives here on its own and index.js only decides where the
// text came from.
//
// The reason this module carries so much arithmetic is the watch. Pebble gives
// an app 4 kB of persistent storage in total, in fields of at most 256 bytes.
// The whole library cannot live there, so it lives on the phone and the watch
// holds two much smaller things: an index of every deck's title and card count
// (a few hundred bytes, so the deck list is browsable with the phone out of
// range) and the cards of whichever single deck is loaded. Switching decks is
// what needs the phone, not studying one.
//
// That division is why the budget constants below are enforced *here* rather
// than discovered on the watch: a deck that cannot fit should be rejected on
// the phone with a line number, not silently truncated after it has already
// overwritten the deck the wearer was using.
//
// This module is pure. It parses and serialises; index.js fetches and sends.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Wire format
// ---------------------------------------------------------------------------
// Cards are sent and stored as one flat string. AppMessage strings are
// NUL-terminated, so NUL cannot be the separator; ASCII's own separator
// characters can, and they are stripped out of user text below so they can
// never appear by accident.
var UNIT_SEPARATOR   = '\x1f';  // between a card's front and its back
var RECORD_SEPARATOR = '\x1e';  // between one card and the next

// ---------------------------------------------------------------------------
// Limits
// ---------------------------------------------------------------------------
// Sized against the watch's 4 kB, with room left over: settings and the index
// take a few hundred bytes, and a store that is completely full is a store
// that fails its next write.
var MAX_DECKS = 12;

// The deck list is a MenuLayer on a 200 px screen; a longer title would only be
// truncated on the watch, and truncating here at least does it once, visibly.
var MAX_TITLE_CHARS = 24;

// A card's two sides. 100 characters is about five lines of the smallest font
// the card window will drop to, which is the point past which a flashcard has
// stopped being a flashcard.
var MAX_SIDE_CHARS = 100;

// A hard ceiling on cards, independent of the byte budget: very short cards
// would otherwise let a deck through that the index and the session counters
// were never sized for.
var MAX_CARDS_PER_DECK = 100;

// What one deck's serialised cards may occupy on the watch, in bytes.
var DECK_BUDGET_BYTES = 3072;

// What the whole deck index may occupy on the watch, in bytes. The index is
// kept permanently and the cards are not, so the two budgets live side by side
// under the 4 kB: 3072 + 512 leaves a few hundred bytes spare, and a persistent
// store with nothing spare is one that fails its next write.
//
// This is a *byte* budget over a character limit, and the difference is the
// whole point of it: MAX_TITLE_CHARS counts characters, and a title of Irish or
// Japanese runs to two, three or four bytes each. Twelve worst-case titles
// would be a kilobyte on their own.
var MAX_INDEX_BYTES = 512;

// Chunk size for both AppMessage transfer and persist fields. Under Pebble's
// 256-byte field limit, with margin for the NUL terminator and for the header
// the transfer puts alongside each chunk.
var CHUNK_BYTES = 240;

// Cards found before any `#` heading still need a home rather than an error:
// a single-deck file with no heading is the most obvious thing a newcomer will
// paste in, and it should simply work.
var UNTITLED = 'Untitled';

// Shipped so that a fresh install has something to open before any deck has
// been written. Deliberately tiny, and deliberately not useful enough to keep.
var SAMPLE_TEXT = [
  '# Irish Phrases',
  'Dia duit | Hello',
  'Slán | Goodbye',
  'Go raibh maith agat | Thank you',
  'Le do thoil | Please',
  '',
  '# Capitals',
  'Ireland | Dublin',
  'Portugal | Lisbon',
  'Finland | Helsinki'
].join('\n');

// ---------------------------------------------------------------------------
// UTF-8
// ---------------------------------------------------------------------------
// Everything the watch counts is counted in bytes, not characters, and the
// text is going to contain fadas the moment anyone writes Irish into it. A
// chunk boundary dropped through the middle of a multi-byte character would
// reach the watch as a broken glyph, so the length and the splitting below are
// both byte-accurate and codepoint-safe.

/** The length of a string in UTF-8 bytes. */
function utf8Length(value) {
  var text = String(value);
  var bytes = 0;

  for (var i = 0; i < text.length; i++) {
    var code = text.charCodeAt(i);

    if (code < 0x80) {
      bytes += 1;
    } else if (code < 0x800) {
      bytes += 2;
    } else if (code >= 0xD800 && code <= 0xDBFF) {
      // A high surrogate: this and its pair are one 4-byte character. Consume
      // the low surrogate here so it is not counted again as 3 bytes.
      bytes += 4;
      i++;
    } else {
      bytes += 3;
    }
  }

  return bytes;
}

/**
 * Split a string into pieces of at most `maxBytes` UTF-8 bytes, never dividing
 * a character (or a surrogate pair) across two pieces.
 */
function chunkUtf8(value, maxBytes) {
  var text = String(value);
  var chunks = [];
  var chunk = '';
  var chunkBytes = 0;

  for (var i = 0; i < text.length; i++) {
    var isSurrogatePair = false;
    var code = text.charCodeAt(i);

    if (code >= 0xD800 && code <= 0xDBFF && i + 1 < text.length) {
      isSurrogatePair = true;
    }

    var character = isSurrogatePair ? text.substr(i, 2) : text.charAt(i);
    var characterBytes = utf8Length(character);

    if (chunkBytes + characterBytes > maxBytes && chunk !== '') {
      chunks.push(chunk);
      chunk = '';
      chunkBytes = 0;
    }

    chunk += character;
    chunkBytes += characterBytes;

    if (isSurrogatePair) i++;
  }

  if (chunk !== '') chunks.push(chunk);

  return chunks;
}

// ---------------------------------------------------------------------------
// Separators
// ---------------------------------------------------------------------------

// What may sit between a card's two sides, in order of preference.
var SIDE_SEPARATORS = ['|', '\t', ';', ','];

/**
 * Work out what separates the two sides of a card in this text.
 *
 * Deck text no longer comes only from someone typing it: the config page emits
 * it, and a Deck URL may point at whatever a spreadsheet or Anki exported. So
 * rather than insisting on the pipe, the separator is chosen from the text.
 *
 * A pipe anywhere wins outright, which is what keeps every deck written before
 * this existed parsing exactly as it did. Only when there is no pipe at all do
 * the others get a look, and then it is whichever splits the most lines in two
 * — a tab beats a comma on a file where both appear, because the commas are
 * almost always inside the answers rather than between the columns.
 */
function detectSeparator(text) {
  var lines = String(text || '').replace(/\r\n?/g, '\n').split('\n');
  var best = SIDE_SEPARATORS[0];
  var bestScore = 0;

  for (var s = 0; s < SIDE_SEPARATORS.length; s++) {
    var separator = SIDE_SEPARATORS[s];
    var score = 0;

    for (var i = 0; i < lines.length; i++) {
      var line = lines[i].trim();

      // Headings are not cards and never carry a separator worth counting.
      if (line === '' || line.charAt(0) === '#') continue;
      if (line.indexOf(separator) > 0) score++;
    }

    // The pipe is the format's own mark: one is enough to settle it.
    if (separator === '|' && score > 0) return '|';

    if (score > bestScore) {
      bestScore = score;
      best = separator;
    }
  }

  return best;
}

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

/**
 * Strip the characters the wire format reserves, along with tabs and any other
 * control character, and collapse the runs of whitespace that survive. Done to
 * every piece of user text before it is measured, so that what is counted
 * against the budget is exactly what will be stored.
 */
function clean(value) {
  return String(value)
    // eslint-disable-next-line no-control-regex
    .replace(/[\x00-\x1f\x7f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** The bytes one card occupies on the wire, separators included. */
function cardBytes(card) {
  return utf8Length(card.front) + utf8Length(card.back) + 2;
}

/** The bytes a deck's cards occupy once serialised. */
function deckBytes(deck) {
  var total = 0;

  for (var i = 0; i < deck.cards.length; i++) {
    total += cardBytes(deck.cards[i]);
  }

  return total;
}

/**
 * Parse deck text into decks and errors.
 *
 * Errors never abort the parse. A single mistyped line in the middle of a long
 * file should cost that line, not the library — so every problem is collected
 * with its line number and the good cards around it still load.
 *
 * Returns { decks: [{ title, cards: [{ front, back }], bytes }], errors: [] },
 * where each error is { line, message } and `line` is 1-based, or null for a
 * problem that belongs to the file as a whole.
 */
function parse(text) {
  var decks = [];
  var errors = [];
  var current = null;

  if (text === null || text === undefined || clean(text) === '') {
    errors.push({ line: null, message: 'No deck text. Paste some cards, or set a deck URL.' });
    return { decks: decks, errors: errors };
  }

  // Normalise the line endings a pasted or fetched file arrives with, so that a
  // stray \r never becomes part of a card's last word.
  var lines = String(text).replace(/\r\n?/g, '\n').split('\n');
  var separator = detectSeparator(text);

  /** Close off the deck being built, keeping it only if it earned a place. */
  function commitCurrentDeck() {
    if (current === null) return;

    if (current.cards.length === 0) {
      errors.push({
        line: current.line,
        message: 'Deck "' + current.title + '" has no cards, so it was skipped.'
      });
    } else {
      current.bytes = deckBytes(current);
      decks.push(current);
    }

    current = null;
  }

  function startDeck(title, lineNumber) {
    commitCurrentDeck();
    current = { title: title, cards: [], bytes: 0, line: lineNumber };
  }

  for (var i = 0; i < lines.length; i++) {
    var lineNumber = i + 1;
    var line = lines[i].trim();

    if (line === '') continue;

    if (line.charAt(0) === '#') {
      var title = clean(line.substring(1));

      if (title === '') {
        errors.push({ line: lineNumber, message: 'A deck heading needs a name after the #.' });
        title = UNTITLED;
      }

      if (title.length > MAX_TITLE_CHARS) {
        errors.push({
          line: lineNumber,
          message: 'Deck name is longer than ' + MAX_TITLE_CHARS + ' characters and was shortened.'
        });
        title = title.substring(0, MAX_TITLE_CHARS).trim();
      }

      startDeck(title, lineNumber);
      continue;
    }

    var separatorIndex = line.indexOf(separator);

    if (separatorIndex === -1) {
      errors.push({
        line: lineNumber,
        message: 'No ' + (separator === '\t' ? 'tab' : separator) +
                 ' on this line, so it is neither a card nor a # heading. Skipped.'
      });
      continue;
    }

    // Split on the first separator only: a back may legitimately contain one
    // ("tá sé | it is | he is"), a front may not, and the asymmetry is easier
    // to explain than an escaping rule.
    var front = clean(line.substring(0, separatorIndex));
    var back = clean(line.substring(separatorIndex + 1));

    if (front === '' || back === '') {
      errors.push({
        line: lineNumber,
        message: 'A card needs text on both sides of the |. Skipped.'
      });
      continue;
    }

    if (front.length > MAX_SIDE_CHARS || back.length > MAX_SIDE_CHARS) {
      errors.push({
        line: lineNumber,
        message: 'A card side is longer than ' + MAX_SIDE_CHARS + ' characters and was shortened.'
      });
      front = front.substring(0, MAX_SIDE_CHARS).trim();
      back = back.substring(0, MAX_SIDE_CHARS).trim();
    }

    // Cards before any heading open an implicit deck rather than failing.
    if (current === null) startDeck(UNTITLED, lineNumber);

    if (current.cards.length >= MAX_CARDS_PER_DECK) {
      errors.push({
        line: lineNumber,
        message: 'Deck "' + current.title + '" is already at ' + MAX_CARDS_PER_DECK +
                 ' cards. This one and any after it were skipped.'
      });
      continue;
    }

    var card = { front: front, back: back };

    if (deckBytes(current) + cardBytes(card) > DECK_BUDGET_BYTES) {
      errors.push({
        line: lineNumber,
        message: 'Deck "' + current.title + '" is full — the watch has room for ' +
                 DECK_BUDGET_BYTES + ' bytes of cards. This one and any after it were skipped.'
      });
      continue;
    }

    current.cards.push(card);
  }

  commitCurrentDeck();

  if (decks.length > MAX_DECKS) {
    errors.push({
      line: null,
      message: 'Only the first ' + MAX_DECKS + ' decks are kept; ' +
               (decks.length - MAX_DECKS) + ' were dropped.'
    });
    decks = decks.slice(0, MAX_DECKS);
  }

  var titlesBefore = decks.map(function(d) { return d.title; });
  decks = fitIndex(decks, errors);

  for (var t = 0; t < decks.length; t++) {
    if (decks[t].title !== titlesBefore[t]) {
      errors.push({
        line: decks[t].line,
        message: 'Deck name shortened to "' + decks[t].title +
                 '" to fit the watch\'s deck list.'
      });
    }
  }

  if (decks.length === 0) {
    errors.push({ line: null, message: 'No usable decks were found in the text.' });
  }

  return { decks: decks, errors: errors };
}

// ---------------------------------------------------------------------------
// Serialising
// ---------------------------------------------------------------------------

/** One deck's cards as the flat string the watch stores and reads. */
function serialiseCards(deck) {
  var parts = [];

  for (var i = 0; i < deck.cards.length; i++) {
    parts.push(deck.cards[i].front + UNIT_SEPARATOR + deck.cards[i].back);
  }

  // A trailing record separator, so the watch's parser can treat every card
  // identically instead of special-casing the last one.
  return parts.length === 0 ? '' : parts.join(RECORD_SEPARATOR) + RECORD_SEPARATOR;
}

/**
 * The deck index: every deck's title and card count, in menu order. Small
 * enough to keep on the watch permanently, which is what lets the deck list
 * render with the phone out of range.
 */
function serialiseIndex(decks) {
  var parts = [];

  for (var i = 0; i < decks.length; i++) {
    parts.push(decks[i].title + UNIT_SEPARATOR + decks[i].cards.length);
  }

  return parts.length === 0 ? '' : parts.join(RECORD_SEPARATOR) + RECORD_SEPARATOR;
}

/**
 * Shrink the index until it fits MAX_INDEX_BYTES, reporting what it cost.
 *
 * Titles are trimmed first, byte-safely and worst-offender first, because a
 * shortened name still finds the right deck in the list; only if that is not
 * enough are whole decks dropped from the end. Mutates the titles in place,
 * which is what the caller wants: everything downstream — the index, the
 * signature, the menu — should agree on the shortened name.
 */
function fitIndex(decks, errors) {
  var MIN_TITLE_BYTES = 6;
  var kept = decks;

  function indexBytes() {
    return utf8Length(serialiseIndex(kept));
  }

  while (indexBytes() > MAX_INDEX_BYTES) {
    // The longest title is the one with the most to give up.
    var longest = 0;

    for (var i = 1; i < kept.length; i++) {
      if (utf8Length(kept[i].title) > utf8Length(kept[longest].title)) longest = i;
    }

    var title = kept[longest].title;
    var bytes = utf8Length(title);

    if (bytes > MIN_TITLE_BYTES) {
      // chunkUtf8 gives the longest prefix that fits without splitting a
      // character, which is exactly the trim wanted here.
      var trimmed = chunkUtf8(title, bytes - 1)[0] || '';
      kept[longest].title = trimmed.trim();

      if (utf8Length(kept[longest].title) >= bytes) {
        // Trimming has stopped making progress (a title of one wide character,
        // say). Drop a deck rather than spin.
        kept[longest].title = title;
        bytes = MIN_TITLE_BYTES;
      }
    }

    if (bytes <= MIN_TITLE_BYTES) {
      var dropped = kept[kept.length - 1];
      kept = kept.slice(0, kept.length - 1);
      errors.push({
        line: null,
        message: 'The deck list is too long for the watch, so "' + dropped.title +
                 '" was dropped.'
      });

      if (kept.length === 0) return kept;
    }
  }

  return kept;
}

/** A deck's cards, split into transferable and storable pieces. */
function chunkCards(deck) {
  return chunkUtf8(serialiseCards(deck), CHUNK_BYTES);
}

// ---------------------------------------------------------------------------
// Library signature
// ---------------------------------------------------------------------------

/**
 * A 31-bit fingerprint of the whole library.
 *
 * The watch caches one deck's cards by index, and an edit on the phone can move
 * a deck, renumber it or change its contents without changing its position. The
 * watch has no way to notice that on its own, so it would happily go on showing
 * cards from a deck that no longer exists at that index. It stores this number
 * alongside the cached deck instead, and throws the cache away whenever a new
 * index arrives carrying a different one.
 *
 * FNV-1a over the serialised index and every deck's cards. Not a security
 * property — it only has to change when the library does. Masked to 31 bits so
 * it survives the trip through AppMessage's signed 32-bit integers unchanged.
 */
function signature(decks) {
  var text = serialiseIndex(decks);

  for (var i = 0; i < decks.length; i++) {
    text += serialiseCards(decks[i]);
  }

  var hash = 0x811c9dc5;

  for (var j = 0; j < text.length; j++) {
    hash ^= text.charCodeAt(j);
    // FNV's 32-bit prime, by shifts: a plain multiply would lose precision
    // once the product passed 2^53.
    hash += (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24);
    hash = hash >>> 0;
  }

  return hash & 0x7fffffff;
}

module.exports = {
  UNIT_SEPARATOR: UNIT_SEPARATOR,
  RECORD_SEPARATOR: RECORD_SEPARATOR,
  MAX_DECKS: MAX_DECKS,
  MAX_TITLE_CHARS: MAX_TITLE_CHARS,
  MAX_SIDE_CHARS: MAX_SIDE_CHARS,
  MAX_CARDS_PER_DECK: MAX_CARDS_PER_DECK,
  DECK_BUDGET_BYTES: DECK_BUDGET_BYTES,
  MAX_INDEX_BYTES: MAX_INDEX_BYTES,
  CHUNK_BYTES: CHUNK_BYTES,
  UNTITLED: UNTITLED,
  SAMPLE_TEXT: SAMPLE_TEXT,
  SIDE_SEPARATORS: SIDE_SEPARATORS,
  detectSeparator: detectSeparator,
  utf8Length: utf8Length,
  chunkUtf8: chunkUtf8,
  parse: parse,
  deckBytes: deckBytes,
  serialiseCards: serialiseCards,
  serialiseIndex: serialiseIndex,
  chunkCards: chunkCards,
  fitIndex: fitIndex,
  signature: signature
};
