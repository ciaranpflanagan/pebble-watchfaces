#pragma once

#include <pebble.h>

// ---------------------------------------------------------------------------
// One run through a deck.
//
// Pure bookkeeping — it knows card numbers, never card text — so the drawing
// and the study logic can be reasoned about separately.
// ---------------------------------------------------------------------------

/** Begin a run through `card_count` cards, in a fresh shuffle. */
void session_start(int card_count);

bool session_finished(void);

/** The card to show now, as an index into the loaded deck. */
int session_current_card(void);

// Progress through the current round, for the bar and the counter.
int session_position(void);
int session_round_length(void);

/** Which round this is: 1 while going through the deck, 2+ while mopping up. */
int session_round(void);

/** Answer the current card and move on. */
void session_grade(bool correct);

// The score, once finished: cards never missed, out of the deck's size.
int session_correct(void);
int session_total(void);
