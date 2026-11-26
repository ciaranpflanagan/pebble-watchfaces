#include "deck_window.h"
#include "app.h"
#include "card_window.h"
#include "library.h"
#include "theme.h"

#include <stdio.h>
#include <string.h>

// ---------------------------------------------------------------------------
// The deck list.
//
// A MenuLayer over the index, which is the part of the library the watch keeps
// for good — so this screen works whether or not the phone is anywhere nearby.
// Choosing a deck is the only thing that needs it: a deck already loaded opens
// straight away, and any other has to be fetched.
//
// The status line replaces the list while that fetch is in flight, and is also
// where anything the phone has to say ends up. It is drawn over the top rather
// than pushed as a window of its own so that Back always means the same thing
// here, whatever is on screen.
// ---------------------------------------------------------------------------

#define STATUS_MAX 96

// How long a message stays up before the list comes back. Long enough to read
// twice; short enough that nobody wonders whether the app has hung.
#define STATUS_CLEAR_MS 5000

// How long to wait on a deck before saying so. A deck is a dozen small messages
// over Bluetooth, and a phone that has gone to sleep takes a moment to answer.
#define FETCH_TIMEOUT_MS 20000

static Window    *s_window;
static MenuLayer *s_menu;
static TextLayer *s_status_layer;

static char      s_status[STATUS_MAX + 1];
static int       s_pending_deck = -1;
static AppTimer *s_status_timer = NULL;
static bool      s_fetching = false;

static uint16_t menu_get_num_rows(MenuLayer *menu, uint16_t section, void *context) {
  int count = library_deck_count();
  return (uint16_t)(count > 0 ? count : 0);
}

static int16_t menu_get_cell_height(MenuLayer *menu, MenuIndex *index, void *context) {
  // Enough for a title and its subtitle with air around them. The default cell
  // is sized for the smaller screens and crowds the two lines together here.
  return 46;
}

static void menu_draw_row(GContext *ctx, const Layer *cell, MenuIndex *index, void *context) {
  static char subtitle[24];

  int deck_id = index->row;
  int cards = library_deck_card_count(deck_id);

  snprintf(subtitle, sizeof(subtitle), "%d card%s", cards, cards == 1 ? "" : "s");

  // A deck already on the watch is marked, because it is the one that will open
  // without the phone — worth knowing before you walk away from it.
  if (library_deck_loaded(deck_id)) {
    GRect bounds = layer_get_bounds(cell);

    // The selected row is painted in the accent itself, so an accent dot on it
    // would be invisible — which is exactly the row most likely to carry one.
    MenuIndex selected = menu_layer_get_selected_index(s_menu);
    bool highlighted = (selected.section == index->section && selected.row == index->row);

    graphics_context_set_fill_color(ctx, highlighted ? gcolor_legible_over(theme_accent())
                                                     : theme_accent());
    graphics_fill_rect(ctx, GRect(bounds.size.w - 12, bounds.size.h / 2 - 3, 5, 5),
                       2, GCornersAll);
  }

  menu_cell_basic_draw(ctx, cell, library_deck_title(deck_id), subtitle, NULL);
}

static void menu_select_click(MenuLayer *menu, MenuIndex *index, void *context) {
  int deck_id = index->row;

  if (deck_id < 0 || deck_id >= library_deck_count()) return;

  s_pending_deck = deck_id;

  if (library_deck_loaded(deck_id)) {
    card_window_push();
    return;
  }

  if (!app_phone_connected()) {
    deck_window_set_status("That deck is on your phone, and the phone is not connected.",
                           STATUS_CLEAR_MS);
    return;
  }

  deck_window_set_fetching();
  app_request_deck(deck_id);
}

static void apply_theme_to_menu(void) {
  if (s_menu == NULL) return;

  menu_layer_set_normal_colors(s_menu, theme_bg(), theme_fg());
  menu_layer_set_highlight_colors(s_menu, theme_accent(),
                                  gcolor_legible_over(theme_accent()));
}

static void window_load(Window *window) {
  Layer *root = window_get_root_layer(window);
  GRect bounds = layer_get_bounds(root);

  s_menu = menu_layer_create(bounds);
  menu_layer_set_callbacks(s_menu, NULL, (MenuLayerCallbacks) {
    .get_num_rows = menu_get_num_rows,
    .get_cell_height = menu_get_cell_height,
    .draw_row = menu_draw_row,
    .select_click = menu_select_click
  });
  menu_layer_set_click_config_onto_window(s_menu, window);
  apply_theme_to_menu();
  layer_add_child(root, menu_layer_get_layer(s_menu));

  s_status_layer = text_layer_create(GRect(12, 60, 176, 110));
  text_layer_set_background_color(s_status_layer, GColorClear);
  text_layer_set_text_color(s_status_layer, theme_fg());
  text_layer_set_font(s_status_layer, fonts_get_system_font(FONT_KEY_GOTHIC_18));
  text_layer_set_text_alignment(s_status_layer, GTextAlignmentCenter);
  text_layer_set_text(s_status_layer, s_status);
  layer_set_hidden(text_layer_get_layer(s_status_layer), s_status[0] == '\0');
  layer_add_child(root, text_layer_get_layer(s_status_layer));

  // An empty list with no message of its own would read as a broken app rather
  // than one still waiting on the phone.
  if (library_deck_count() == 0 && s_status[0] == '\0') {
    // No timeout on this one: with nothing in the list there is nothing to
    // clear back to, and the message is the whole screen's content.
    deck_window_set_status(app_phone_connected()
        ? "Loading your decks..."
        : "No decks yet. Connect your phone and open the app again.", 0);
  }
}

static void window_unload(Window *window) {
  if (s_status_timer != NULL) {
    app_timer_cancel(s_status_timer);
    s_status_timer = NULL;
  }

  menu_layer_destroy(s_menu);
  s_menu = NULL;
  text_layer_destroy(s_status_layer);
  s_status_layer = NULL;
  window_destroy(s_window);
  s_window = NULL;
}

void deck_window_push(void) {
  if (s_window == NULL) {
    s_window = window_create();
    window_set_window_handlers(s_window, (WindowHandlers) {
      .load = window_load,
      .unload = window_unload
    });
  }

  window_set_background_color(s_window, theme_bg());
  window_stack_push(s_window, true);
}

void deck_window_reload(void) {
  if (s_window == NULL) return;

  window_set_background_color(s_window, theme_bg());
  apply_theme_to_menu();

  if (s_menu != NULL) menu_layer_reload_data(s_menu);

  if (library_deck_count() > 0 && s_status[0] != '\0') deck_window_clear_status();
}

static void status_timer_fired(void *context) {
  s_status_timer = NULL;

  // A fetch that timed out owes the wearer an explanation before the list
  // returns; anything else has already said its piece.
  if (s_fetching) {
    s_fetching = false;
    deck_window_set_status("The deck did not arrive. Try again.", STATUS_CLEAR_MS);
    return;
  }

  if (library_deck_count() > 0) deck_window_clear_status();
}

void deck_window_set_status(const char *status, uint32_t clear_after_ms) {
  strncpy(s_status, status, STATUS_MAX);
  s_status[STATUS_MAX] = '\0';

  if (s_status_timer != NULL) {
    app_timer_cancel(s_status_timer);
    s_status_timer = NULL;
  }

  if (clear_after_ms > 0) {
    s_status_timer = app_timer_register(clear_after_ms, status_timer_fired, NULL);
  }

  if (s_status_layer == NULL) return;

  text_layer_set_text_color(s_status_layer, theme_fg());
  text_layer_set_text(s_status_layer, s_status);
  layer_set_hidden(text_layer_get_layer(s_status_layer), false);
  layer_set_hidden(menu_layer_get_layer(s_menu), true);
}

void deck_window_set_fetching(void) {
  deck_window_set_status("Fetching...", FETCH_TIMEOUT_MS);
  s_fetching = true;
}

void deck_window_clear_status(void) {
  s_status[0] = '\0';
  s_fetching = false;

  if (s_status_timer != NULL) {
    app_timer_cancel(s_status_timer);
    s_status_timer = NULL;
  }

  if (s_status_layer == NULL) return;

  layer_set_hidden(text_layer_get_layer(s_status_layer), true);
  layer_set_hidden(menu_layer_get_layer(s_menu), false);
}

int deck_window_pending_deck(void) {
  return s_pending_deck;
}
