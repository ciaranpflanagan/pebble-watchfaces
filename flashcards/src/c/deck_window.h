#pragma once

#include <pebble.h>

/** Push the deck list. The app's first and last window. */
void deck_window_push(void);

/** Rebuild the list after a new index arrived. */
void deck_window_reload(void);

/**
 * Show a one-line status in place of the list.
 *
 * Every status clears itself after `clear_after_ms`, which is what keeps a
 * message from becoming a dead end: the list is the only way out of this
 * window, and a status that stayed put would strand the wearer in an app whose
 * every button belongs to a menu they can no longer see.
 */
void deck_window_set_status(const char *status, uint32_t clear_after_ms);

/** As above, for the wait while a deck is fetched — it names its own timeout. */
void deck_window_set_fetching(void);

/** Clear any status and return to the list. */
void deck_window_clear_status(void);

/** The deck the wearer last chose, or -1 if they have not chosen yet. */
int deck_window_pending_deck(void);
