#pragma once

#include <pebble.h>

// ---------------------------------------------------------------------------
// Limits. Every one of these has a counterpart in src/pkjs/deck.js, which is
// where they are enforced: the phone refuses a deck that would not fit here,
// with the line number that caused it, because this side has no way to tell
// anyone why a deck came up short.
// ---------------------------------------------------------------------------
#define MAX_DECKS           12
#define MAX_CARDS_PER_DECK  100
#define CHUNK_BYTES         240
#define INDEX_BUDGET_BYTES  512
#define DECK_BUDGET_BYTES   3072
#define MAX_INDEX_CHUNKS    4
#define MAX_DECK_CHUNKS     16

// Blob kinds. Must match BLOB_*_KIND in src/pkjs/index.js.
#define BLOB_KIND_INDEX 0
#define BLOB_KIND_DECK  1

typedef enum {
  LIBRARY_CHUNK_PENDING,      // taken, more expected
  LIBRARY_CHUNK_INDEX_DONE,   // the deck list is complete
  LIBRARY_CHUNK_DECK_DONE,    // a deck's cards are complete
  LIBRARY_CHUNK_ERROR         // out of order or too large; the transfer is void
} LibraryChunkResult;

/** Restore whatever survived the last run. Call once, at startup. */
void library_init(void);

// The deck list.
int         library_deck_count(void);
const char *library_deck_title(int deck_id);
int         library_deck_card_count(int deck_id);

/** Take one chunk of an incoming blob. See LibraryChunkResult. */
LibraryChunkResult library_receive_chunk(int kind, int id, const char *title,
                                         int total, int index, const char *data);

// The deck currently held on the watch.
bool        library_deck_loaded(int deck_id);
int         library_active_deck(void);
const char *library_active_title(void);
int         library_card_count(void);
const char *library_card_front(int card);
const char *library_card_back(int card);
