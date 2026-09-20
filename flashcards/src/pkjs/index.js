'use strict';

var Clay         = require('pebble-clay');
var deck         = require('./deck.js');
var accent       = require('./accent.js');
var clayCustomFn = require('./clay-custom.js');
var clay         = new Clay(require('./config.js'), clayCustomFn, { autoHandleEvents: false });

// ---------------------------------------------------------------------------
// The phone half of Cue Card.
//
// It owns the library. The watch has 4 kB of persistent storage, which is not
// enough for a set of decks, so the whole library lives here in localStorage
// and the watch is sent two much smaller things:
//
//   the index — every deck's title and card count, a few hundred bytes, which
//               the watch keeps for good so the deck list works with the phone
//               out of range;
//   one deck  — the cards of whichever deck the wearer has just opened, sent
//               on request and overwriting the last one.
//
// Both travel over the same chunked-blob transfer below, because neither fits
// the 256 bytes a single persist field holds. One mechanism rather than two
// keeps the watch's receiving code to a single routine.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Config page.
// Clay 1.0.4 always generates a clay.pebble.com S3 base URL and ignores any
// URI passed to generateUrl(). In the emulator, Chrome then blocks the save
// redirect (public page → localhost) under Private Network Access rules.
//
// Fix: let Clay generate its URL, strip the S3 base, and prepend a local
// server instead. Both the page origin and return_to become localhost, which
// Chrome permits (local → local is fine).
//
// Before running `pebble emu-app-config`, serve the project root in a separate
// terminal so clay-proxy.html is reachable:
//   python3 -m http.server 8888 --directory .
//
// On a real phone this proxy is unused entirely — see IS_EMULATOR below.
// ---------------------------------------------------------------------------
var LOCAL_CLAY_URI = 'http://localhost:8888/clay-proxy.html';

// Set to false before publishing to the Rebble store; ./build.sh --prod does it.
var IS_EMULATOR = true;

var HTTP_TIMEOUT_MS = 12 * 1000;

// A chunk that fails to send is nearly always a Bluetooth stall rather than a
// refusal, and the link usually recovers within a second or two. Worth a few
// goes before giving the wearer an error they cannot act on.
var MAX_CHUNK_ATTEMPTS = 4;
var CHUNK_RETRY_MS = 600;

// Blob kinds. Must match BLOB_KIND_* in src/c/flashcards.c.
var BLOB_INDEX_KIND = 0;
var BLOB_DECK_KIND  = 1;

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------
var SETTINGS_STORAGE_KEY = 'cueCardSettings';
var LIBRARY_STORAGE_KEY  = 'cueCardLibrary';

var DEFAULT_SETTINGS = {
  deckUrl:  '',
  deckText: deck.SAMPLE_TEXT,
  theme:    false,
  accent:   accent.DEFAULT_ACCENT
};

/** Tidy a URL from the config page. Empty means "use the textarea instead". */
function normaliseUrl(value) {
  if (value === null || value === undefined) return '';

  var url = String(value).trim();

  if (url === '') return '';

  // Anything that is not plainly http(s) is refused rather than attempted:
  // the failure would otherwise surface on the watch as a bare network error.
  if (!/^https?:\/\//i.test(url)) return '';

  return url;
}

/** Bring a settings object read from storage into the current shape. */
function migrateSettings(stored) {
  if (!stored) return DEFAULT_SETTINGS;

  return {
    deckUrl:  normaliseUrl(stored.deckUrl),
    deckText: typeof stored.deckText === 'string' ? stored.deckText : DEFAULT_SETTINGS.deckText,
    theme:    !!stored.theme,
    accent:   accent.resolveAccent(stored.accent)
  };
}

function loadSettings() {
  try {
    return migrateSettings(JSON.parse(localStorage.getItem(SETTINGS_STORAGE_KEY)));
  } catch (e) {
    console.log('Settings unreadable, falling back to defaults: ' + e);
    return DEFAULT_SETTINGS;
  }
}

function saveSettings(settings) {
  try {
    localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(settings));
  } catch (e) {
    console.log('Settings could not be saved: ' + e);
  }
}

// ---------------------------------------------------------------------------
// The library
// ---------------------------------------------------------------------------
// Kept in memory while the app runs and mirrored to localStorage, so that a
// deck URL which is unreachable falls back to the last good copy rather than
// leaving the watch with nothing.

var library = { decks: [], signature: 0 };

function buildLibrary(decks) {
  return { decks: decks, signature: deck.signature(decks) };
}

function cacheLibrary(text) {
  try {
    localStorage.setItem(LIBRARY_STORAGE_KEY, text);
  } catch (e) {
    console.log('Library could not be cached: ' + e);
  }
}

function cachedLibraryText() {
  try {
    return localStorage.getItem(LIBRARY_STORAGE_KEY) || '';
  } catch (e) {
    console.log('Library cache unreadable: ' + e);
    return '';
  }
}

/**
 * Turn deck text into a library, reporting whatever went wrong.
 *
 * Parse errors are never fatal on their own: a file with one bad line still
 * yields every other card, and the wearer is better served by the decks that
 * did load plus a note than by an empty watch.
 */
function adoptText(text, origin) {
  var parsed = deck.parse(text);

  for (var i = 0; i < parsed.errors.length; i++) {
    var error = parsed.errors[i];
    console.log('Deck text (' + origin + ')' +
                (error.line === null ? '' : ' line ' + error.line) + ': ' + error.message);
  }

  if (parsed.decks.length === 0) {
    return { library: null, error: firstErrorMessage(parsed.errors) };
  }

  return { library: buildLibrary(parsed.decks), error: null };
}

/** The message worth putting on a 200 px screen when nothing loaded at all. */
function firstErrorMessage(errors) {
  if (!errors || errors.length === 0) return 'No decks found.';

  var error = errors[0];
  return error.line === null ? error.message : 'Line ' + error.line + ': ' + error.message;
}

/**
 * Work out the library and hand it to `onDone(error)`, which is called exactly
 * once whether the source was the network, the cache or the textarea.
 */
function resolveLibrary(settings, onDone) {
  if (settings.deckUrl === '') {
    var direct = adoptText(settings.deckText, 'settings');

    if (direct.library !== null) {
      library = direct.library;
      cacheLibrary(settings.deckText);
      onDone(null);
    } else {
      onDone(direct.error);
    }
    return;
  }

  getText(settings.deckUrl, function(text, error) {
    if (error === null) {
      var fetched = adoptText(text, settings.deckUrl);

      if (fetched.library !== null) {
        library = fetched.library;
        cacheLibrary(text);
        onDone(null);
        return;
      }

      // The URL answered, but with nothing usable. Falling back to a cached
      // copy here would hide a broken file behind stale decks, so this one is
      // reported rather than papered over.
      onDone(fetched.error);
      return;
    }

    console.log('Deck URL failed: ' + error);

    var cached = adoptText(cachedLibraryText(), 'cache');

    if (cached.library !== null) {
      library = cached.library;
      console.log('Using the cached library instead.');
      onDone(null);
      return;
    }

    onDone('Could not reach the deck URL, and nothing is cached.');
  });
}

// ---------------------------------------------------------------------------
// HTTP
// ---------------------------------------------------------------------------

/**
 * GET some text. `onDone` is called with (text, error) and always exactly once,
 * so every caller can treat a failure as a null payload rather than having to
 * wire up two paths.
 */
function getText(url, onDone) {
  var xhr = new XMLHttpRequest();
  var settled = false;

  function settle(text, error) {
    if (settled) return;
    settled = true;
    onDone(text, error);
  }

  xhr.onload = function() {
    if (this.status < 200 || this.status >= 300) {
      settle(null, 'HTTP ' + this.status + ' from ' + url);
      return;
    }
    settle(this.responseText, null);
  };
  xhr.onerror   = function() { settle(null, 'Request failed: ' + url); };
  xhr.ontimeout = function() { settle(null, 'Request timed out: ' + url); };

  try {
    xhr.open('GET', url);
    xhr.timeout = HTTP_TIMEOUT_MS;
    xhr.send();
  } catch (e) {
    settle(null, 'Request could not be started: ' + e);
  }
}

// ---------------------------------------------------------------------------
// AppMessage
// ---------------------------------------------------------------------------

function sendSettingsToWatch(settings) {
  Pebble.sendAppMessage({
    SETTINGS_THEME:  settings.theme ? 1 : 0,
    SETTINGS_ACCENT: accent.resolveAccent(settings.accent)
  }, function() {
    console.log('Settings sent: theme=' + settings.theme +
                ' accent=' + accent.toHexString(settings.accent));
  }, function(e) {
    console.log('Settings send failed: ' + JSON.stringify(e));
  });
}

function sendErrorToWatch(message) {
  Pebble.sendAppMessage({ LIB_ERROR: String(message) }, function() {
    console.log('Error sent to watch: ' + message);
  }, function(e) {
    console.log('Error send failed: ' + JSON.stringify(e));
  });
}

// ---------------------------------------------------------------------------
// Chunked transfer
// ---------------------------------------------------------------------------
// One blob at a time, one chunk per message, each sent only once the previous
// has been acknowledged. Serialising it this way costs a little speed and buys
// ordering: the watch can insist on the chunk index it is expecting and treat
// anything else as a transfer worth abandoning.
//
// `generation` guards the callbacks. A wearer who backs out of one deck and
// into another leaves a send in flight whose ack would otherwise advance the
// transfer that replaced it.

var transfer = null;
var generation = 0;

function abortTransfer() {
  transfer = null;
  generation++;
}

function beginTransfer(blob) {
  abortTransfer();

  if (blob.chunks.length === 0) {
    console.log('Nothing to send for blob kind ' + blob.kind);
    return;
  }

  transfer = {
    kind:       blob.kind,
    id:         blob.id,
    title:      blob.title,
    chunks:     blob.chunks,
    position:   0,
    attempts:   0,
    generation: generation
  };

  sendCurrentChunk();
}

function sendCurrentChunk() {
  var active = transfer;

  if (active === null) return;

  if (active.position >= active.chunks.length) {
    console.log('Sent ' + active.chunks.length + ' chunk(s) for kind ' + active.kind +
                ' id ' + active.id);
    transfer = null;
    return;
  }

  var message = {
    BLOB_KIND:  active.kind,
    BLOB_ID:    active.id,
    BLOB_TOTAL: active.chunks.length,
    BLOB_INDEX: active.position,
    BLOB_DATA:  active.chunks[active.position]
  };

  // The title rides along with the opening chunk rather than in a message of
  // its own, so the watch has something to draw the moment a transfer starts.
  if (active.position === 0 && active.title !== null) {
    message.BLOB_TITLE = active.title;
  }

  var sentGeneration = active.generation;

  Pebble.sendAppMessage(message, function() {
    if (transfer === null || transfer.generation !== sentGeneration) return;

    transfer.position++;
    transfer.attempts = 0;
    sendCurrentChunk();
  }, function(e) {
    if (transfer === null || transfer.generation !== sentGeneration) return;

    transfer.attempts++;

    if (transfer.attempts >= MAX_CHUNK_ATTEMPTS) {
      console.log('Giving up on chunk ' + transfer.position + ' of kind ' +
                  transfer.kind + ': ' + JSON.stringify(e));
      abortTransfer();
      sendErrorToWatch('The deck did not finish sending. Try again.');
      return;
    }

    console.log('Retrying chunk ' + transfer.position + ' (attempt ' +
                transfer.attempts + '): ' + JSON.stringify(e));
    setTimeout(sendCurrentChunk, CHUNK_RETRY_MS);
  });
}

/** Send the deck list. Its id doubles as the library's signature. */
function sendIndexToWatch() {
  if (library.decks.length === 0) {
    sendErrorToWatch('No decks. Open the settings to add some.');
    return;
  }

  beginTransfer({
    kind:   BLOB_INDEX_KIND,
    id:     library.signature,
    title:  null,
    chunks: deck.chunkUtf8(deck.serialiseIndex(library.decks), deck.CHUNK_BYTES)
  });
}

/** Send one deck's cards, in answer to the watch asking for it. */
function sendDeckToWatch(deckId) {
  if (deckId < 0 || deckId >= library.decks.length) {
    console.log('Watch asked for deck ' + deckId + ', which does not exist.');
    sendErrorToWatch('That deck is no longer there. Reopen the app.');
    return;
  }

  var requested = library.decks[deckId];

  console.log('Sending deck ' + deckId + ' "' + requested.title + '" (' +
              requested.cards.length + ' cards, ' + requested.bytes + ' bytes)');

  beginTransfer({
    kind:   BLOB_DECK_KIND,
    id:     deckId,
    title:  requested.title,
    chunks: deck.chunkCards(requested)
  });
}

/** Rebuild the library from the current settings and push the deck list. */
function refresh(settings) {
  resolveLibrary(settings, function(error) {
    if (error !== null) {
      console.log('Library unavailable: ' + error);
      sendErrorToWatch(error);
      return;
    }

    console.log('Library: ' + library.decks.length + ' deck(s), signature ' +
                library.signature);
    sendIndexToWatch();
  });
}

// ---------------------------------------------------------------------------
// Pebble events
// ---------------------------------------------------------------------------
Pebble.addEventListener('ready', function() {
  var settings = loadSettings();
  sendSettingsToWatch(settings);
  refresh(settings);
});

Pebble.addEventListener('appmessage', function(e) {
  if (!e || !e.payload) return;

  // The only thing the watch ever asks for. It arrives as the deck's index in
  // the list the watch was sent, offset by one so that zero is never ambiguous
  // with an absent key.
  if (typeof e.payload.DECK_REQUEST === 'number') {
    sendDeckToWatch(e.payload.DECK_REQUEST - 1);
  }
});

Pebble.addEventListener('showConfiguration', function() {
  var generated = clay.generateUrl();
  if (IS_EMULATOR) {
    var fragment = generated.substring(generated.indexOf('#'));
    Pebble.openURL(LOCAL_CLAY_URI + fragment);
  } else {
    Pebble.openURL(generated);
  }
});

Pebble.addEventListener('webviewclosed', function(e) {
  if (!e.response || e.response === 'CANCELLED') return;

  try {
    // Pass false so getSettings returns raw string-keyed objects with .value
    // properties, instead of the numeric-keyed AppMessage-ready format.
    var claySettings = clay.getSettings(e.response, false);
    var settings = {
      deckUrl:  normaliseUrl(claySettings.DECK_URL && claySettings.DECK_URL.value),
      deckText: (claySettings.DECK_TEXT && claySettings.DECK_TEXT.value) || '',
      theme:    !!(claySettings.SETTINGS_THEME && claySettings.SETTINGS_THEME.value),
      accent:   accent.resolveAccent(
                  claySettings.SETTINGS_ACCENT && claySettings.SETTINGS_ACCENT.value)
    };
    saveSettings(settings);
    sendSettingsToWatch(settings);
    refresh(settings);
  } catch (err) {
    console.log('webviewclosed error: ' + err);
  }
});
