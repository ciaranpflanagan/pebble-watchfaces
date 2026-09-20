#include "card_window.h"
#include "library.h"
#include "session.h"
#include "theme.h"

#include <stdio.h>
#include <string.h>

// ---------------------------------------------------------------------------
// The card.
//
// One window with two states and a tail. Face down it shows the question alone,
// filling the screen. Flipped, the question shrinks to a line at the top and
// the answer takes the space beneath it — keeping both in view is what makes a
// wrong answer worth anything, since the point is to see what you should have
// said next to what you did. When the session ends the same window draws the
// score rather than pushing a third one, so Back still means what it meant.
//
// Everything is drawn in one update proc rather than assembled from TextLayers.
// Card text is arbitrary — it is whatever was typed on the phone — so the size
// it needs is not known until it is measured, and measuring is the only way to
// choose a font that fills the screen for three words and still fits thirty.
//
// That measuring is also why the app uses the system Gothic faces rather than
// the subsetted Space Grotesk of its sibling watchfaces: a subset is built from
// a known set of characters, and there is no knowing these.
// ---------------------------------------------------------------------------

#define SCREEN_W 200
#define SCREEN_H 228
#define SAFE_L   12
#define SAFE_R   188
#define SAFE_W   (SAFE_R - SAFE_L)

#define HEADER_Y      6
#define HEADER_H      18
#define HAIRLINE_Y    27

#define CONTENT_TOP   33
#define CONTENT_BOTOM 192
#define CONTENT_H     (CONTENT_BOTOM - CONTENT_TOP)

// Flipped: the question keeps a band at the top, the answer takes the rest.
#define PROMPT_H      44
#define DIVIDER_Y     (CONTENT_TOP + PROMPT_H + 6)
#define ANSWER_TOP    (DIVIDER_Y + 7)
#define ANSWER_H      (CONTENT_BOTOM - ANSWER_TOP)

#define BAR_Y         200
#define BAR_H         4
#define HINT_Y        208
#define HINT_H        16

static Window *s_window;
static Layer  *s_canvas;

static bool s_flipped = false;

// Largest first: the search below takes the first that fits, so the order is
// the preference. GOTHIC_09 is a last resort that always "fits" by truncating.
static const char *const FONT_LADDER[] = {
  FONT_KEY_GOTHIC_28_BOLD,
  FONT_KEY_GOTHIC_24_BOLD,
  FONT_KEY_GOTHIC_18_BOLD,
  FONT_KEY_GOTHIC_14_BOLD,
  FONT_KEY_GOTHIC_14
};
static const int FONT_LADDER_SIZE = sizeof(FONT_LADDER) / sizeof(FONT_LADDER[0]);

/**
 * The largest font from the ladder whose wrapped text fits `box`, measured
 * rather than guessed. Falls through to the smallest, which may overflow — a
 * clipped long card still reads better than an empty screen.
 */
static GFont fitting_font(const char *text, GRect box) {
  for (int i = 0; i < FONT_LADDER_SIZE; i++) {
    GFont font = fonts_get_system_font(FONT_LADDER[i]);
    GSize needed = graphics_text_layout_get_content_size(
        text, font, box, GTextOverflowModeWordWrap, GTextAlignmentCenter);

    if (needed.h <= box.size.h) return font;
  }

  return fonts_get_system_font(FONT_LADDER[FONT_LADDER_SIZE - 1]);
}

/** Draw text centred in both directions, at the largest size that fits. */
static void draw_fitted(GContext *ctx, const char *text, GRect box, GColor colour) {
  GFont font = fitting_font(text, box);
  GSize needed = graphics_text_layout_get_content_size(
      text, font, box, GTextOverflowModeWordWrap, GTextAlignmentCenter);

  // Centre vertically by shifting the box down by half the slack. The SDK
  // leaves a few pixels of leading above a line, so nudge back up by two.
  int16_t slack = box.size.h - needed.h;
  if (slack < 0) slack = 0;

  GRect placed = GRect(box.origin.x, box.origin.y + slack / 2 - 2,
                       box.size.w, needed.h + 4);

  graphics_context_set_text_color(ctx, colour);
  graphics_draw_text(ctx, text, font, placed,
                     GTextOverflowModeWordWrap, GTextAlignmentCenter, NULL);
}

/**
 * The deck name, the position, and the rule beneath them.
 *
 * The rule's colour is the card's state: accent while the question stands
 * alone, plain once it has been answered. It replaced a small accent mark
 * floating beside the question, which read as a stray text cursor rather than
 * as a deliberate part of the screen.
 */
static void draw_header(GContext *ctx, const char *left, const char *right,
                        GColor rule) {
  graphics_context_set_text_color(ctx, theme_muted());

  graphics_draw_text(ctx, left, fonts_get_system_font(FONT_KEY_GOTHIC_14),
                     GRect(SAFE_L, HEADER_Y, SAFE_W - 54, HEADER_H),
                     GTextOverflowModeTrailingEllipsis, GTextAlignmentLeft, NULL);

  graphics_draw_text(ctx, right, fonts_get_system_font(FONT_KEY_GOTHIC_14),
                     GRect(SAFE_R - 54, HEADER_Y, 54, HEADER_H),
                     GTextOverflowModeTrailingEllipsis, GTextAlignmentRight, NULL);

  graphics_context_set_stroke_color(ctx, rule);
  graphics_context_set_stroke_width(ctx, 2);
  graphics_draw_line(ctx, GPoint(SAFE_L, HAIRLINE_Y), GPoint(SAFE_R, HAIRLINE_Y));
}

static void draw_hint(GContext *ctx, const char *hint) {
  graphics_context_set_text_color(ctx, theme_muted());
  graphics_draw_text(ctx, hint, fonts_get_system_font(FONT_KEY_GOTHIC_14),
                     GRect(SAFE_L, HINT_Y, SAFE_W, HINT_H),
                     GTextOverflowModeTrailingEllipsis, GTextAlignmentCenter, NULL);
}

/** Progress through the current round, as a bar along the foot. */
static void draw_progress(GContext *ctx) {
  int length = session_round_length();
  if (length <= 0) return;

  int done = session_position() - 1;

  // The empty track is thinner than the filled part, so a session that has
  // barely started does not open with a full-width bar as its loudest element.
  graphics_context_set_fill_color(ctx, theme_hairline());
  graphics_fill_rect(ctx, GRect(SAFE_L, BAR_Y + 1, SAFE_W, BAR_H - 2), 0, GCornerNone);

  int filled = (SAFE_W * done) / length;

  if (filled > 0) {
    graphics_context_set_fill_color(ctx, theme_accent());
    graphics_fill_rect(ctx, GRect(SAFE_L, BAR_Y, filled, BAR_H), 0, GCornerNone);
  }
}

static void draw_summary(GContext *ctx) {
  static char score[16];
  static char counter[32];

  snprintf(score, sizeof(score), "%d/%d", session_correct(), session_total());
  snprintf(counter, sizeof(counter), "%d round%s",
           session_round(), session_round() == 1 ? "" : "s");

  draw_header(ctx, library_active_title(), counter, theme_hairline());

  graphics_context_set_text_color(ctx, theme_accent());
  graphics_draw_text(ctx, score, fonts_get_system_font(FONT_KEY_BITHAM_42_BOLD),
                     GRect(SAFE_L, 70, SAFE_W, 50),
                     GTextOverflowModeTrailingEllipsis, GTextAlignmentCenter, NULL);

  graphics_context_set_text_color(ctx, theme_fg());
  graphics_draw_text(ctx, "first time right",
                     fonts_get_system_font(FONT_KEY_GOTHIC_18),
                     GRect(SAFE_L, 124, SAFE_W, 24),
                     GTextOverflowModeTrailingEllipsis, GTextAlignmentCenter, NULL);

  draw_hint(ctx, "SELECT again  BACK list");
}

static void draw_card(GContext *ctx) {
  static char counter[16];

  int card = session_current_card();
  const char *front = library_card_front(card);
  const char *back = library_card_back(card);

  snprintf(counter, sizeof(counter), "%d/%d", session_position(), session_round_length());

  // The accent rule under the header is what says which side is showing.
  draw_header(ctx, library_active_title(), counter,
              s_flipped ? theme_hairline() : theme_accent());

  if (!s_flipped) {
    // Face down: the question alone, as large as it will go.
    draw_fitted(ctx, front,
                GRect(SAFE_L, CONTENT_TOP, SAFE_W, CONTENT_H), theme_fg());

    draw_hint(ctx, "SELECT to flip");
  } else {
    // Flipped: the question stays, quietly, above the answer.
    draw_fitted(ctx, front,
                GRect(SAFE_L, CONTENT_TOP, SAFE_W, PROMPT_H), theme_muted());

    graphics_context_set_stroke_color(ctx, theme_hairline());
    graphics_context_set_stroke_width(ctx, 1);
    graphics_draw_line(ctx, GPoint(SAFE_L + 40, DIVIDER_Y), GPoint(SAFE_R - 40, DIVIDER_Y));

    draw_fitted(ctx, back,
                GRect(SAFE_L, ANSWER_TOP, SAFE_W, ANSWER_H), theme_fg());

    draw_hint(ctx, "UP got it   DOWN again");
  }

  draw_progress(ctx);
}

static void canvas_update_proc(Layer *layer, GContext *ctx) {
  if (library_card_count() == 0) {
    draw_header(ctx, library_active_title(), "", theme_hairline());
    draw_hint(ctx, "No cards in this deck.");
    return;
  }

  if (session_finished()) {
    draw_summary(ctx);
  } else {
    draw_card(ctx);
  }
}

// ---------------------------------------------------------------------------
// Buttons
//
// Select flips, and only after the flip do Up and Down mean anything. Leaving
// them inert on the question side is deliberate: grading is the one action here
// that cannot be taken back, and it should not be reachable by a thumb that has
// got ahead of the screen.
// ---------------------------------------------------------------------------

static void select_click_handler(ClickRecognizerRef recognizer, void *context) {
  if (session_finished()) {
    session_start(library_card_count());
    s_flipped = false;
  } else if (!s_flipped) {
    s_flipped = true;
  }

  layer_mark_dirty(s_canvas);
}

static void grade_and_advance(bool correct) {
  if (session_finished() || !s_flipped) return;

  session_grade(correct);
  s_flipped = false;
  layer_mark_dirty(s_canvas);
}

static void up_click_handler(ClickRecognizerRef recognizer, void *context) {
  grade_and_advance(true);
}

static void down_click_handler(ClickRecognizerRef recognizer, void *context) {
  grade_and_advance(false);
}

static void click_config_provider(void *context) {
  window_single_click_subscribe(BUTTON_ID_SELECT, select_click_handler);
  window_single_click_subscribe(BUTTON_ID_UP, up_click_handler);
  window_single_click_subscribe(BUTTON_ID_DOWN, down_click_handler);
}

// ---------------------------------------------------------------------------
// Window
// ---------------------------------------------------------------------------

static void window_load(Window *window) {
  Layer *root = window_get_root_layer(window);

  s_canvas = layer_create(layer_get_bounds(root));
  layer_set_update_proc(s_canvas, canvas_update_proc);
  layer_add_child(root, s_canvas);
}

static void window_unload(Window *window) {
  layer_destroy(s_canvas);
  s_canvas = NULL;
  window_destroy(s_window);
  s_window = NULL;
}

void card_window_push(void) {
  session_start(library_card_count());
  s_flipped = false;

  if (s_window == NULL) {
    s_window = window_create();
    window_set_window_handlers(s_window, (WindowHandlers) {
      .load = window_load,
      .unload = window_unload
    });
    window_set_click_config_provider(s_window, click_config_provider);
  }

  window_set_background_color(s_window, theme_bg());
  window_stack_push(s_window, true);
}

void card_window_refresh(void) {
  if (s_window == NULL) return;

  window_set_background_color(s_window, theme_bg());
  if (s_canvas != NULL) layer_mark_dirty(s_canvas);
}
