#include "session.h"
#include "library.h"

#include <stdlib.h>
#include <string.h>

// ---------------------------------------------------------------------------
// The study session.
//
// A shuffled queue of card numbers, worked through once. Cards answered wrongly
// are collected as they go, and when the queue runs out that collection becomes
// the next queue — so a session ends when everything has been got right at
// least once, rather than after a fixed number of cards.
//
// Doing it in rounds rather than by appending to a single growing queue is what
// keeps the memory fixed: two arrays the size of the deck, however many times a
// stubborn card comes back around.
//
// The score is deliberately unforgiving. A card counts as correct only if it
// was never missed, so the final number says how much was known on arrival
// rather than how much was eventually dragged out.
// ---------------------------------------------------------------------------

static uint8_t s_queue[MAX_CARDS_PER_DECK];
static int     s_queue_length = 0;
static int     s_queue_position = 0;

static uint8_t s_retry[MAX_CARDS_PER_DECK];
static int     s_retry_length = 0;

static bool s_missed[MAX_CARDS_PER_DECK];

static int  s_total = 0;
static int  s_round = 1;
static bool s_finished = true;

/** Fisher–Yates, so every ordering is as likely as every other. */
static void shuffle(uint8_t *values, int count) {
  for (int i = count - 1; i > 0; i--) {
    int j = rand() % (i + 1);
    uint8_t held = values[i];
    values[i] = values[j];
    values[j] = held;
  }
}

void session_start(int card_count) {
  if (card_count > MAX_CARDS_PER_DECK) card_count = MAX_CARDS_PER_DECK;

  s_total = card_count;
  s_queue_length = card_count;
  s_queue_position = 0;
  s_retry_length = 0;
  s_round = 1;
  s_finished = (card_count == 0);

  for (int i = 0; i < card_count; i++) {
    s_queue[i] = (uint8_t)i;
    s_missed[i] = false;
  }

  shuffle(s_queue, s_queue_length);
}

bool session_finished(void) {
  return s_finished;
}

int session_current_card(void) {
  if (s_finished || s_queue_position >= s_queue_length) return 0;
  return s_queue[s_queue_position];
}

int session_position(void) {
  return s_queue_position + 1;
}

int session_round_length(void) {
  return s_queue_length;
}

int session_round(void) {
  return s_round;
}

void session_grade(bool correct) {
  if (s_finished || s_queue_position >= s_queue_length) return;

  uint8_t card = s_queue[s_queue_position];

  if (!correct) {
    s_missed[card] = true;

    // The bound is the deck's own size, and a card can only be queued for retry
    // once per round, so this can never overrun.
    if (s_retry_length < MAX_CARDS_PER_DECK) {
      s_retry[s_retry_length] = card;
      s_retry_length++;
    }
  }

  s_queue_position++;

  if (s_queue_position < s_queue_length) return;

  if (s_retry_length == 0) {
    s_finished = true;
    return;
  }

  // Another round, over just the cards that came up short.
  memcpy(s_queue, s_retry, (size_t)s_retry_length);
  s_queue_length = s_retry_length;
  s_queue_position = 0;
  s_retry_length = 0;
  s_round++;

  shuffle(s_queue, s_queue_length);
}

int session_correct(void) {
  int correct = 0;

  for (int i = 0; i < s_total; i++) {
    if (!s_missed[i]) correct++;
  }

  return correct;
}

int session_total(void) {
  return s_total;
}
