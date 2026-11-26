#pragma once

// ---------------------------------------------------------------------------
// Every persistent key the app uses, in one place.
//
// Pebble's persistent store is a flat namespace of integers shared by the whole
// app, so two modules that each pick their own keys will eventually pick the
// same one and silently overwrite each other. Collecting them here makes a
// clash visible rather than mysterious.
//
// The two ranges at the bottom are blobs too large for a single field — the
// store holds at most 256 bytes per key — so each occupies a run of
// consecutive keys. Leave the gaps: they are room for those runs to grow.
// ---------------------------------------------------------------------------

#define PERSIST_THEME            0
#define PERSIST_ACCENT           1

// The library's fingerprint, as sent with the deck index. A cached deck is only
// trustworthy while this matches — see library.c.
#define PERSIST_SIGNATURE        2

#define PERSIST_INDEX_CHUNKS     3
#define PERSIST_DECK_ID          4
#define PERSIST_DECK_CHUNKS      5

// The deck index: titles and card counts. Keys 10..13.
#define PERSIST_INDEX_CHUNK_BASE 10

// The active deck's cards. Keys 20..35.
#define PERSIST_DECK_CHUNK_BASE  20
