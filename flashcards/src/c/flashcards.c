#include <pebble.h>
#include <stdlib.h>
#include <time.h>

#include "app.h"
#include "card_window.h"
#include "deck_window.h"
#include "library.h"
#include "session.h"
#include "theme.h"

// ---------------------------------------------------------------------------
// Cue Card — a flashcards app for the Pebble Time 2 (emery, 200 × 228).
//
// The decks live on the phone. This side holds an index of their titles and
// counts, kept for good so the list is browsable on its own, and the cards of
// whichever deck was last opened. See library.c for why it is split that way,
// and src/pkjs/deck.js for the parsing and the budgets that keep it inside
// Pebble's 4 kB.
//
// This file is the seam: the app's lifecycle, and the AppMessage traffic that
// no window should have to know about.
// ---------------------------------------------------------------------------

// Sized for one chunk of card text (240 bytes) plus a deck title and the four
// small integers alongside it, with room for the dictionary's own overhead.
#define INBOX_SIZE  512
#define OUTBOX_SIZE 128

// ---------------------------------------------------------------------------
// Outbound
// ---------------------------------------------------------------------------

void app_request_deck(int deck_id) {
  DictionaryIterator *out;
  AppMessageResult result = app_message_outbox_begin(&out);

  if (result != APP_MSG_OK) {
    APP_LOG(APP_LOG_LEVEL_ERROR, "Could not open the outbox for deck %d: %d",
            deck_id, (int)result);
    deck_window_set_status("Could not reach your phone. Try again.", 5000);
    return;
  }

  // Offset by one so that a deck id of zero is never mistaken for an absent
  // key on the phone side, where a missing value reads as undefined.
  dict_write_int32(out, MESSAGE_KEY_DECK_REQUEST, deck_id + 1);

  result = app_message_outbox_send();

  if (result != APP_MSG_OK) {
    APP_LOG(APP_LOG_LEVEL_ERROR, "Deck request %d failed to send: %d",
            deck_id, (int)result);
    deck_window_set_status("Could not reach your phone. Try again.", 5000);
  }
}

bool app_phone_connected(void) {
  return connection_service_peek_pebble_app_connection();
}

// ---------------------------------------------------------------------------
// Inbound
// ---------------------------------------------------------------------------

static void handle_settings(DictionaryIterator *iter) {
  Tuple *theme_t  = dict_find(iter, MESSAGE_KEY_SETTINGS_THEME);
  Tuple *accent_t = dict_find(iter, MESSAGE_KEY_SETTINGS_ACCENT);

  if (theme_t == NULL && accent_t == NULL) return;

  if (theme_t != NULL) theme_set_inverted((bool)theme_t->value->int32);
  if (accent_t != NULL) theme_set_accent_hex((int)accent_t->value->int32);

  // Both windows may be stacked; both are repainted, since only one of them
  // knows which is on top and neither should have to.
  deck_window_reload();
  card_window_refresh();
}

static void handle_error(DictionaryIterator *iter) {
  Tuple *error_t = dict_find(iter, MESSAGE_KEY_LIB_ERROR);

  if (error_t == NULL) return;

  APP_LOG(APP_LOG_LEVEL_ERROR, "Phone: %s", error_t->value->cstring);
  deck_window_set_status(error_t->value->cstring, 6000);
}

static void handle_blob(DictionaryIterator *iter) {
  Tuple *kind_t  = dict_find(iter, MESSAGE_KEY_BLOB_KIND);
  Tuple *data_t  = dict_find(iter, MESSAGE_KEY_BLOB_DATA);
  Tuple *total_t = dict_find(iter, MESSAGE_KEY_BLOB_TOTAL);
  Tuple *index_t = dict_find(iter, MESSAGE_KEY_BLOB_INDEX);
  Tuple *id_t    = dict_find(iter, MESSAGE_KEY_BLOB_ID);
  Tuple *title_t = dict_find(iter, MESSAGE_KEY_BLOB_TITLE);

  if (kind_t == NULL || data_t == NULL || total_t == NULL || index_t == NULL) return;

  int kind = (int)kind_t->value->int32;
  int id = (id_t != NULL) ? (int)id_t->value->int32 : 0;
  const char *title = (title_t != NULL) ? title_t->value->cstring : NULL;

  LibraryChunkResult result = library_receive_chunk(
      kind, id, title,
      (int)total_t->value->int32,
      (int)index_t->value->int32,
      data_t->value->cstring);

  switch (result) {
    case LIBRARY_CHUNK_PENDING:
      break;

    case LIBRARY_CHUNK_INDEX_DONE:
      deck_window_clear_status();
      deck_window_reload();
      break;

    case LIBRARY_CHUNK_DECK_DONE:
      deck_window_clear_status();
      deck_window_reload();

      // Only open the deck if it is the one that was asked for. An index that
      // arrives late could otherwise throw the wearer into a deck they left.
      if (library_active_deck() == deck_window_pending_deck()) {
        card_window_push();
      }
      break;

    case LIBRARY_CHUNK_ERROR:
      deck_window_set_status("That deck did not arrive in one piece. Try again.", 5000);
      break;
  }
}

static void inbox_received(DictionaryIterator *iter, void *context) {
  handle_settings(iter);
  handle_error(iter);
  handle_blob(iter);
}

static void inbox_dropped(AppMessageResult reason, void *context) {
  APP_LOG(APP_LOG_LEVEL_ERROR, "Inbox dropped a message: %d", (int)reason);
  deck_window_set_status("A message was lost. Try the deck again.", 5000);
}

static void outbox_failed(DictionaryIterator *iter, AppMessageResult reason, void *context) {
  APP_LOG(APP_LOG_LEVEL_ERROR, "Outbox failed: %d", (int)reason);
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

static void init(void) {
  // The shuffle wants a different order each launch; the clock is the only
  // thing to hand that differs.
  srand((unsigned int)time(NULL));

  theme_load();
  library_init();

  app_message_register_inbox_received(inbox_received);
  app_message_register_inbox_dropped(inbox_dropped);
  app_message_register_outbox_failed(outbox_failed);
  app_message_open(INBOX_SIZE, OUTBOX_SIZE);

  deck_window_push();
}

static void deinit(void) {
  // The windows tear themselves down as the stack unwinds.
}

int main(void) {
  init();
  app_event_loop();
  deinit();
  return 0;
}
