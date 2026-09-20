#pragma once

#include <pebble.h>

// ---------------------------------------------------------------------------
// The few things the windows need from the app itself.
//
// Kept to this, rather than letting a window talk to AppMessage directly: the
// deck list should not have to know that a deck arrives over Bluetooth, and
// flashcards.c should stay the only place that does.
// ---------------------------------------------------------------------------

/** Ask the phone for a deck's cards. */
void app_request_deck(int deck_id);

/** Whether the phone is reachable at all, for messages worth phrasing well. */
bool app_phone_connected(void);
