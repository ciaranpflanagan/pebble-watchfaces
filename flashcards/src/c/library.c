#include "library.h"
#include "persist.h"

#include <stdlib.h>
#include <string.h>

// ---------------------------------------------------------------------------
// The watch's half of the library.
//
// The phone owns the decks; this side holds two things. The deck index — every
// title and card count — is kept permanently, which is what lets the deck list
// open and be browsed with the phone out of range. The cards of one deck are
// kept alongside it and replaced whenever a different deck is opened. Together
// they are sized to sit inside Pebble's 4 kB with a few hundred bytes to spare.
//
// Both arrive over the same chunked transfer, because a persist field holds 256
// bytes and neither blob does. Chunks are staged into a buffer as they come,
// and only once the last one lands is anything committed — a transfer that
// stalls half way leaves the previous deck intact rather than a broken one.
//
// The wire format is flat text: fields separated by 0x1f, records by 0x1e, with
// a trailing record separator so every record parses the same way.
//
//   index:  title 1f count 1e title 1f count 1e ...
//   deck:   front 1f back  1e front 1f back  1e ...
//
// Parsing is done in place. The separators are overwritten with NULs and the
// pointers kept, so a deck costs its own bytes and an array of pointers rather
// than a second copy of every card.
// ---------------------------------------------------------------------------

#define UNIT_SEPARATOR   '\x1f'
#define RECORD_SEPARATOR '\x1e'

#define MAX_TITLE_BYTES 100

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

static char s_index_blob[INDEX_BUDGET_BYTES + 1];
static char s_cards_blob[DECK_BUDGET_BYTES + 1];

static struct {
  const char *title;
  int         cards;
} s_decks[MAX_DECKS];
static int s_deck_count = 0;

static struct {
  const char *front;
  const char *back;
} s_cards[MAX_CARDS_PER_DECK];
static int s_card_count = 0;

static char s_active_title[MAX_TITLE_BYTES + 1];
static int  s_active_deck = -1;
static int  s_signature   = 0;

// The transfer in flight. `kind` is -1 when there is none.
static struct {
  int  kind;
  int  id;
  int  total;
  int  expected;
  char title[MAX_TITLE_BYTES + 1];
  char buffer[DECK_BUDGET_BYTES + 1];
  int  length;
} s_staging = { .kind = -1 };

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

/**
 * Split a blob into records in place, handing each one's two fields to the
 * caller. Stops at the first malformed record rather than guessing: a truncated
 * transfer is better shown short than shown wrong.
 */
static int parse_records(char *blob, int max_records,
                         void (*take)(int slot, char *first, char *second)) {
  int count = 0;
  char *cursor = blob;

  while (*cursor != '\0' && count < max_records) {
    char *unit   = strchr(cursor, UNIT_SEPARATOR);
    char *record = strchr(cursor, RECORD_SEPARATOR);

    // Both must exist, and the field separator must come first.
    if (unit == NULL || record == NULL || unit > record) break;

    *unit = '\0';
    *record = '\0';

    take(count, cursor, unit + 1);
    count++;

    cursor = record + 1;
  }

  return count;
}

static void take_deck(int slot, char *title, char *cards) {
  s_decks[slot].title = title;
  s_decks[slot].cards = atoi(cards);
}

static void take_card(int slot, char *front, char *back) {
  s_cards[slot].front = front;
  s_cards[slot].back = back;
}

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------
// A blob is written across a run of consecutive keys. The split is by bytes and
// takes no account of character boundaries, which is safe because nothing reads
// a single chunk: they are only ever concatenated back into the whole.
//
// The length is passed in rather than measured, and what is stored is always
// the staging buffer rather than the parsed one. Parsing writes NULs over the
// separators, so strlen() of a blob that has been through parse_records()
// stops at the end of its first field — storing that would persist one title
// and lose the rest of the library.

static void store_blob(const char *blob, int length, uint32_t count_key,
                       uint32_t base_key, int max_chunks) {
  int offset = 0;
  int chunks = 0;
  char piece[CHUNK_BYTES + 1];

  while (offset < length && chunks < max_chunks) {
    int size = length - offset;
    if (size > CHUNK_BYTES) size = CHUNK_BYTES;

    memcpy(piece, blob + offset, (size_t)size);
    piece[size] = '\0';
    persist_write_string(base_key + (uint32_t)chunks, piece);

    offset += size;
    chunks++;
  }

  persist_write_int(count_key, chunks);
}

static bool restore_blob(char *out, size_t size, uint32_t count_key,
                         uint32_t base_key, int max_chunks) {
  if (!persist_exists(count_key)) return false;

  int chunks = persist_read_int(count_key);
  if (chunks <= 0 || chunks > max_chunks) return false;

  size_t used = 0;
  char piece[CHUNK_BYTES + 2];

  for (int i = 0; i < chunks; i++) {
    if (!persist_exists(base_key + (uint32_t)i)) return false;

    int read = persist_read_string(base_key + (uint32_t)i, piece, sizeof(piece));
    if (read <= 0) return false;

    size_t piece_length = strlen(piece);
    if (used + piece_length >= size) return false;

    memcpy(out + used, piece, piece_length);
    used += piece_length;
  }

  out[used] = '\0';
  return true;
}

/** Forget the cached deck, in storage as well as in memory. */
static void drop_deck(void) {
  s_card_count = 0;
  s_active_deck = -1;
  s_active_title[0] = '\0';
  s_cards_blob[0] = '\0';

  persist_delete(PERSIST_DECK_ID);
  persist_delete(PERSIST_DECK_CHUNKS);

  for (int i = 0; i < MAX_DECK_CHUNKS; i++) {
    persist_delete(PERSIST_DECK_CHUNK_BASE + (uint32_t)i);
  }
}

// ---------------------------------------------------------------------------
// Startup
// ---------------------------------------------------------------------------

void library_init(void) {
  s_index_blob[0] = '\0';
  s_cards_blob[0] = '\0';
  s_active_title[0] = '\0';

  s_signature = persist_exists(PERSIST_SIGNATURE) ? persist_read_int(PERSIST_SIGNATURE) : 0;

  if (restore_blob(s_index_blob, sizeof(s_index_blob),
                   PERSIST_INDEX_CHUNKS, PERSIST_INDEX_CHUNK_BASE, MAX_INDEX_CHUNKS)) {
    s_deck_count = parse_records(s_index_blob, MAX_DECKS, take_deck);
  } else {
    s_deck_count = 0;
  }

  if (restore_blob(s_cards_blob, sizeof(s_cards_blob),
                   PERSIST_DECK_CHUNKS, PERSIST_DECK_CHUNK_BASE, MAX_DECK_CHUNKS)) {
    s_card_count = parse_records(s_cards_blob, MAX_CARDS_PER_DECK, take_card);
    s_active_deck = persist_exists(PERSIST_DECK_ID) ? persist_read_int(PERSIST_DECK_ID) : -1;

    // A deck whose id no longer names a deck in the index is left over from a
    // library that has since changed, and its cards belong to nothing.
    if (s_active_deck < 0 || s_active_deck >= s_deck_count || s_card_count == 0) {
      drop_deck();
    } else {
      strncpy(s_active_title, library_deck_title(s_active_deck), MAX_TITLE_BYTES);
      s_active_title[MAX_TITLE_BYTES] = '\0';
    }
  } else {
    s_card_count = 0;
    s_active_deck = -1;
  }

  APP_LOG(APP_LOG_LEVEL_INFO, "Library restored: %d deck(s), %d card(s) loaded",
          s_deck_count, s_card_count);
}

// ---------------------------------------------------------------------------
// The deck list
// ---------------------------------------------------------------------------

int library_deck_count(void) {
  return s_deck_count;
}

const char *library_deck_title(int deck_id) {
  if (deck_id < 0 || deck_id >= s_deck_count) return "";
  return s_decks[deck_id].title;
}

int library_deck_card_count(int deck_id) {
  if (deck_id < 0 || deck_id >= s_deck_count) return 0;
  return s_decks[deck_id].cards;
}

// ---------------------------------------------------------------------------
// The loaded deck
// ---------------------------------------------------------------------------

bool library_deck_loaded(int deck_id) {
  return s_active_deck == deck_id && s_card_count > 0;
}

int library_active_deck(void) {
  return s_active_deck;
}

const char *library_active_title(void) {
  return s_active_title;
}

int library_card_count(void) {
  return s_card_count;
}

const char *library_card_front(int card) {
  if (card < 0 || card >= s_card_count) return "";
  return s_cards[card].front;
}

const char *library_card_back(int card) {
  if (card < 0 || card >= s_card_count) return "";
  return s_cards[card].back;
}

// ---------------------------------------------------------------------------
// Receiving
// ---------------------------------------------------------------------------

static void commit_index(void) {
  memcpy(s_index_blob, s_staging.buffer, (size_t)s_staging.length);
  s_index_blob[s_staging.length] = '\0';

  // Stored from the staging buffer, and before parsing, for the reason given
  // above store_blob.
  store_blob(s_staging.buffer, s_staging.length,
             PERSIST_INDEX_CHUNKS, PERSIST_INDEX_CHUNK_BASE, MAX_INDEX_CHUNKS);

  s_deck_count = parse_records(s_index_blob, MAX_DECKS, take_deck);

  // The index carries the library's fingerprint as its id. A change to it means
  // the decks have been edited, and a deck cached under the old numbering could
  // now be sitting at the wrong place in the list — so it goes.
  if (s_staging.id != s_signature) {
    APP_LOG(APP_LOG_LEVEL_INFO, "Library changed (%d -> %d); dropping the cached deck",
            s_signature, s_staging.id);
    s_signature = s_staging.id;
    persist_write_int(PERSIST_SIGNATURE, s_signature);
    drop_deck();
  }

  // The cached deck may also have fallen off the end of a shorter list.
  if (s_active_deck >= s_deck_count) drop_deck();

  APP_LOG(APP_LOG_LEVEL_INFO, "Deck index: %d deck(s)", s_deck_count);
}

static void commit_deck(void) {
  memcpy(s_cards_blob, s_staging.buffer, (size_t)s_staging.length);
  s_cards_blob[s_staging.length] = '\0';

  s_card_count = parse_records(s_cards_blob, MAX_CARDS_PER_DECK, take_card);

  if (s_card_count == 0) {
    APP_LOG(APP_LOG_LEVEL_ERROR, "Deck %d arrived with no readable cards", s_staging.id);
    drop_deck();
    return;
  }

  s_active_deck = s_staging.id;
  strncpy(s_active_title, s_staging.title, MAX_TITLE_BYTES);
  s_active_title[MAX_TITLE_BYTES] = '\0';

  persist_write_int(PERSIST_DECK_ID, s_active_deck);
  store_blob(s_staging.buffer, s_staging.length,
             PERSIST_DECK_CHUNKS, PERSIST_DECK_CHUNK_BASE, MAX_DECK_CHUNKS);

  APP_LOG(APP_LOG_LEVEL_INFO, "Deck %d \"%s\": %d card(s)",
          s_active_deck, s_active_title, s_card_count);
}

LibraryChunkResult library_receive_chunk(int kind, int id, const char *title,
                                         int total, int index, const char *data) {
  if (data == NULL || total <= 0 || index < 0 || index >= total) {
    APP_LOG(APP_LOG_LEVEL_ERROR, "Nonsense chunk: kind %d, %d of %d", kind, index, total);
    s_staging.kind = -1;
    return LIBRARY_CHUNK_ERROR;
  }

  if (index == 0) {
    // A fresh transfer. Anything half-received is abandoned here rather than
    // merged, which is what makes a retry from the phone simply work.
    s_staging.kind = kind;
    s_staging.id = id;
    s_staging.total = total;
    s_staging.expected = 0;
    s_staging.length = 0;
    s_staging.title[0] = '\0';

    if (title != NULL) {
      strncpy(s_staging.title, title, MAX_TITLE_BYTES);
      s_staging.title[MAX_TITLE_BYTES] = '\0';
    }
  } else if (s_staging.kind != kind || s_staging.id != id ||
             s_staging.total != total || s_staging.expected != index) {
    // Chunks are sent one at a time and only after the last was acknowledged,
    // so anything out of order means the transfer is not what we think it is.
    APP_LOG(APP_LOG_LEVEL_ERROR, "Chunk %d of kind %d arrived out of order (expected %d)",
            index, kind, s_staging.expected);
    s_staging.kind = -1;
    return LIBRARY_CHUNK_ERROR;
  }

  int data_length = (int)strlen(data);
  int capacity = (kind == BLOB_KIND_INDEX) ? INDEX_BUDGET_BYTES : DECK_BUDGET_BYTES;

  if (s_staging.length + data_length > capacity) {
    APP_LOG(APP_LOG_LEVEL_ERROR, "Blob of kind %d overran its %d byte budget", kind, capacity);
    s_staging.kind = -1;
    return LIBRARY_CHUNK_ERROR;
  }

  memcpy(s_staging.buffer + s_staging.length, data, (size_t)data_length);
  s_staging.length += data_length;
  s_staging.buffer[s_staging.length] = '\0';
  s_staging.expected = index + 1;

  if (s_staging.expected < total) return LIBRARY_CHUNK_PENDING;

  s_staging.kind = -1;

  if (kind == BLOB_KIND_INDEX) {
    commit_index();
    return LIBRARY_CHUNK_INDEX_DONE;
  }

  commit_deck();
  return LIBRARY_CHUNK_DECK_DONE;
}
