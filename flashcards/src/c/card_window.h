#pragma once

#include <pebble.h>

/** Open the card window on the deck already loaded by the library. */
void card_window_push(void);

/** Repaint, e.g. after the theme changed while it was open. */
void card_window_refresh(void);
