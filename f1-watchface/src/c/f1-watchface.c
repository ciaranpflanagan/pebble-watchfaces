#include <pebble.h>
#include <ctype.h>

// ---------------------------------------------------------------------------
// Pit Wall — an F1 timing board for the Pebble Time 2 (emery, 200 × 228).
//
// Two layouts, and the face picks between them by the calendar:
//
//   Board     — on the day of a session, the top three of that session, with
//               the clock demoted to the top right.
//   Countdown — every other day: the time, large, over a single row naming the
//               next race and the days it runs.
//
// The switch is the watch's own local date against the session date the phone
// sends. Doing it here rather than on the phone means the face changes over at
// local midnight on its own, instead of whenever the next refresh lands.
//
// Everything drawn is a string built on the phone by src/pkjs/board.js. That
// keeps lap-time arithmetic and the character subsetting of the fonts in one
// testable place, and leaves this file as layout, theme and persistence. The
// clock is the only thing computed here.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Design tokens
// ---------------------------------------------------------------------------
// Default accent, used until the phone sends one. 0xFF0000 is the exact RGB of
// GColorRed. Keep in step with DEFAULT_ACCENT in src/pkjs/accent.js.
#define ACCENT_DEFAULT_HEX  0xFF0000

// Screen geometry (emery: 200 × 228)
#define SCREEN_W  200
#define SCREEN_H  228
#define SAFE_L    16
#define SAFE_R    184

#define DOT_R   3
#define DOT_CX  (SAFE_L + DOT_R)

// ---------------------------------------------------------------------------
// Persistent storage keys
// ---------------------------------------------------------------------------
// The board is persisted as well as the settings: a watchface is unloaded and
// reloaded constantly, and redrawing "---" for the seconds it takes the phone
// to answer would make the face look broken every time it came back.
#define PERSIST_THEME        0
#define PERSIST_ACCENT       1
#define PERSIST_SESSION_DATE 2
#define PERSIST_EVENT        3
#define PERSIST_SESSION      4
#define PERSIST_NEXT_LABEL   5
#define PERSIST_NEXT_DATES   6
// Row i occupies PERSIST_ROW_BASE + i*3 .. +2 (position, code, time).
#define PERSIST_ROW_BASE     10

// ---------------------------------------------------------------------------
// Countdown layout — the geometry of the watchface this one grew out of
// ---------------------------------------------------------------------------
#define CD_WEEKDAY_Y   16
#define CD_WEEKDAY_H   18
#define CD_DATE_Y      32
#define CD_DATE_H      24
#define CD_TIME_Y      72
#define CD_TIME_H      92
#define CD_HAIRLINE_Y  179
#define CD_ROW_Y       190
#define CD_ROW_H       20
#define CD_DOT_CY      (CD_ROW_Y + 8)
#define CD_LABEL_X     (SAFE_L + 12)
// Nine characters of SPACE_MONO_14 (~8.4 px each), which is what
// MAX_NEXT_LABEL_CHARS allows. The dates are right-aligned in a box that starts
// before this one ends: only a nine-character circuit paired with a
// month-straddling date range brings them into contact, and both stay legible.
#define CD_LABEL_W     84
#define CD_DATES_X     96
#define CD_DATES_W     (SAFE_R - CD_DATES_X)

// ---------------------------------------------------------------------------
// Board layout — session days
// ---------------------------------------------------------------------------
#define BD_DATE_X      SAFE_L
#define BD_DATE_Y      20
// Six characters of SPACE_MONO_14. The clock beside it is set in SPACE_GROTESK_36
// and reaches back to about x=86, so the weekday the countdown layout can afford
// has to go here.
#define BD_DATE_W      70
#define BD_DATE_H      20
#define BD_CLOCK_Y     6
#define BD_CLOCK_H     44
#define BD_EVENT_Y     54
#define BD_EVENT_H     20
#define BD_DOT_CY      (BD_EVENT_Y + 10)
#define BD_EVENT_X     (SAFE_L + 12)
#define BD_EVENT_W     92
#define BD_SESSION_X   116
#define BD_SESSION_W   (SAFE_R - BD_SESSION_X)
#define BD_HAIRLINE_Y  78

#define ROW_COUNT      3
#define ROW0_Y         88
#define ROW_SPACING    42
#define ROW_H          34
#define POS_X          SAFE_L
#define POS_W          20
#define CODE_X         38
#define CODE_W         56
#define CODE_DY        5        // SPACE_MONO_20 sits higher than SPACE_GROTESK_26
#define TIME_X         84
#define TIME_W         (SAFE_R - TIME_X)

// ---------------------------------------------------------------------------
// Placeholders — must match VALUE_UNAVAILABLE / CODE_UNAVAILABLE in
// src/pkjs/board.js, which is what the phone sends for the same conditions.
// ---------------------------------------------------------------------------
#define VALUE_UNAVAILABLE "--"
#define CODE_UNAVAILABLE  "---"

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------
static Window    *s_window;
static Layer     *s_chrome_layer;

// Countdown layout
static TextLayer *s_weekday_layer;
static TextLayer *s_cd_date_layer;
static Layer     *s_cd_clock_layer;
static TextLayer *s_next_label_layer;
static TextLayer *s_next_dates_layer;

// Board layout
static TextLayer *s_bd_date_layer;
static Layer     *s_bd_clock_layer;
static TextLayer *s_event_layer;
static TextLayer *s_session_layer;
static TextLayer *s_pos_layers[ROW_COUNT];
static TextLayer *s_code_layers[ROW_COUNT];
static TextLayer *s_time_layers[ROW_COUNT];

static GFont s_font_grotesk_72;
static GFont s_font_grotesk_36;
static GFont s_font_grotesk_26;
static GFont s_font_mono_20;
static GFont s_font_mono_18;
static GFont s_font_mono_14;

static bool   s_inverted = false;   // false = dark, matching the config default
static GColor s_accent;             // set in prv_init

// The local date of the session on the board, as YYYYMMDD, or 0 when there is
// no session to show. The board layout appears only while this matches the
// watch's own date.
static int  s_session_date = 0;
static bool s_board_mode   = false;

static char s_weekday_buf[6];
static char s_cd_date_buf[12];
static char s_bd_date_buf[14];
static char s_hours_buf[3];
static char s_minutes_buf[3];
static char s_event_buf[16];
static char s_session_buf[10];
static char s_next_label_buf[14];
static char s_next_dates_buf[14];
static char s_pos_bufs[ROW_COUNT][4];
static char s_code_bufs[ROW_COUNT][6];
static char s_time_bufs[ROW_COUNT][12];

// ---------------------------------------------------------------------------
// Theme helpers
// ---------------------------------------------------------------------------
static GColor fg_color(void) {
  return s_inverted ? GColorBlack : GColorWhite;
}
static GColor muted_color(void) {
  return s_inverted ? GColorDarkGray : GColorLightGray;
}
static GColor hairline_color(void) {
  return s_inverted ? GColorLightGray : GColorDarkGray;
}

static void apply_theme(void) {
  window_set_background_color(s_window, s_inverted ? GColorWhite : GColorBlack);

  text_layer_set_text_color(s_weekday_layer,    muted_color());
  text_layer_set_text_color(s_cd_date_layer,    fg_color());
  text_layer_set_text_color(s_next_label_layer, muted_color());
  text_layer_set_text_color(s_next_dates_layer, fg_color());

  text_layer_set_text_color(s_bd_date_layer, muted_color());
  text_layer_set_text_color(s_event_layer,   fg_color());
  text_layer_set_text_color(s_session_layer, muted_color());

  for (int i = 0; i < ROW_COUNT; i++) {
    // The leader's position number carries the accent; the rest of the podium
    // is deliberately quieter, so the eye lands on P1 first.
    text_layer_set_text_color(s_pos_layers[i], i == 0 ? s_accent : muted_color());
    text_layer_set_text_color(s_code_layers[i], fg_color());
    text_layer_set_text_color(s_time_layers[i], fg_color());
  }

  layer_mark_dirty(s_cd_clock_layer);
  layer_mark_dirty(s_bd_clock_layer);
  layer_mark_dirty(s_chrome_layer);
}

// ---------------------------------------------------------------------------
// Layout switching
// ---------------------------------------------------------------------------

/** A local calendar date as YYYYMMDD, matching localDateNumber in board.js. */
static int date_number(struct tm *local_tm) {
  return (local_tm->tm_year + 1900) * 10000 +
         (local_tm->tm_mon + 1) * 100 +
         local_tm->tm_mday;
}

static void apply_mode(void) {
  bool board = s_board_mode;

  layer_set_hidden(text_layer_get_layer(s_weekday_layer),    board);
  layer_set_hidden(text_layer_get_layer(s_cd_date_layer),    board);
  layer_set_hidden(s_cd_clock_layer,                          board);
  layer_set_hidden(text_layer_get_layer(s_next_label_layer),  board);
  layer_set_hidden(text_layer_get_layer(s_next_dates_layer),  board);

  layer_set_hidden(text_layer_get_layer(s_bd_date_layer), !board);
  layer_set_hidden(s_bd_clock_layer,                       !board);
  layer_set_hidden(text_layer_get_layer(s_event_layer),   !board);
  layer_set_hidden(text_layer_get_layer(s_session_layer), !board);

  for (int i = 0; i < ROW_COUNT; i++) {
    layer_set_hidden(text_layer_get_layer(s_pos_layers[i]),  !board);
    layer_set_hidden(text_layer_get_layer(s_code_layers[i]), !board);
    layer_set_hidden(text_layer_get_layer(s_time_layers[i]), !board);
  }

  layer_mark_dirty(s_chrome_layer);
}

/**
 * Decide which layout to draw, and redraw if it has changed. Called from every
 * minute tick as well as on new data, so the face changes over by itself at
 * local midnight.
 */
static void update_mode(struct tm *local_tm) {
  bool board = (s_session_date != 0 && s_session_date == date_number(local_tm));

  if (board != s_board_mode) {
    s_board_mode = board;
    apply_mode();
  }
}

// ---------------------------------------------------------------------------
// Clocks
// ---------------------------------------------------------------------------

/**
 * Draw the time with an accent-coloured colon, measured at runtime so the
 * pieces sit flush however wide the font renders them. `align_right` puts the
 * minutes on the safe margin; otherwise the whole thing is centred.
 */
static void draw_clock(GContext *ctx, GFont font, int16_t height, bool align_right) {
  GRect measure = GRect(0, 0, SCREEN_W, height);

  GSize hh_sz    = graphics_text_layout_get_content_size(
    s_hours_buf,   font, measure, GTextOverflowModeWordWrap, GTextAlignmentLeft);
  GSize colon_sz = graphics_text_layout_get_content_size(
    ":",           font, measure, GTextOverflowModeWordWrap, GTextAlignmentLeft);
  GSize mm_sz    = graphics_text_layout_get_content_size(
    s_minutes_buf, font, measure, GTextOverflowModeWordWrap, GTextAlignmentLeft);

  int16_t total = hh_sz.w + colon_sz.w + mm_sz.w;
  int16_t x     = align_right ? (SAFE_R - total) : ((SCREEN_W - total) / 2);

  graphics_context_set_text_color(ctx, fg_color());
  graphics_draw_text(ctx, s_hours_buf, font,
    GRect(x, 0, hh_sz.w + 2, height), GTextOverflowModeWordWrap, GTextAlignmentLeft, NULL);
  x += hh_sz.w;

  graphics_context_set_text_color(ctx, s_accent);
  graphics_draw_text(ctx, ":", font,
    GRect(x, 0, colon_sz.w + 2, height), GTextOverflowModeWordWrap, GTextAlignmentLeft, NULL);
  x += colon_sz.w;

  graphics_context_set_text_color(ctx, fg_color());
  graphics_draw_text(ctx, s_minutes_buf, font,
    GRect(x, 0, mm_sz.w + 2, height), GTextOverflowModeWordWrap, GTextAlignmentLeft, NULL);
}

static void cd_clock_update_proc(Layer *layer, GContext *ctx) {
  draw_clock(ctx, s_font_grotesk_72, CD_TIME_H, false);
}

static void bd_clock_update_proc(Layer *layer, GContext *ctx) {
  draw_clock(ctx, s_font_grotesk_36, BD_CLOCK_H, true);
}

// ---------------------------------------------------------------------------
// Chrome — the hairline and the accent marker, wherever the current layout
// puts them
// ---------------------------------------------------------------------------
static void chrome_update_proc(Layer *layer, GContext *ctx) {
  int16_t hairline_y = s_board_mode ? BD_HAIRLINE_Y : CD_HAIRLINE_Y;
  int16_t dot_cy     = s_board_mode ? BD_DOT_CY     : CD_DOT_CY;

  graphics_context_set_stroke_color(ctx, hairline_color());
  graphics_context_set_stroke_width(ctx, 1);
  graphics_draw_line(ctx, GPoint(SAFE_L, hairline_y), GPoint(SAFE_R, hairline_y));

  graphics_context_set_fill_color(ctx, s_accent);
  graphics_fill_circle(ctx, GPoint(DOT_CX, dot_cy), DOT_R);
}

// ---------------------------------------------------------------------------
// Display update
// ---------------------------------------------------------------------------
static void str_upper(char *s) {
  for (; *s; s++) { *s = (char)toupper((unsigned char)*s); }
}

static void update_display(struct tm *local_tm) {
  strftime(s_weekday_buf, sizeof(s_weekday_buf), "%a", local_tm);
  str_upper(s_weekday_buf);
  text_layer_set_text(s_weekday_layer, s_weekday_buf);

  strftime(s_cd_date_buf, sizeof(s_cd_date_buf), "%d %b", local_tm);
  str_upper(s_cd_date_buf);
  text_layer_set_text(s_cd_date_layer, s_cd_date_buf);

  // No weekday here: the board's clock is large enough to need the room.
  strftime(s_bd_date_buf, sizeof(s_bd_date_buf), "%d %b", local_tm);
  str_upper(s_bd_date_buf);
  text_layer_set_text(s_bd_date_layer, s_bd_date_buf);

  strftime(s_hours_buf,   sizeof(s_hours_buf),   "%H", local_tm);
  strftime(s_minutes_buf, sizeof(s_minutes_buf), "%M", local_tm);
  layer_mark_dirty(s_cd_clock_layer);
  layer_mark_dirty(s_bd_clock_layer);

  update_mode(local_tm);
}

static void tick_handler(struct tm *tick_time, TimeUnits units_changed) {
  update_display(tick_time);
}

// ---------------------------------------------------------------------------
// AppMessage
// ---------------------------------------------------------------------------

/**
 * Copy a string tuple into its buffer and persist it, leaving the buffer alone
 * when the key was not in this message. Returns true when something changed, so
 * the caller can tell a board update from a settings-only one.
 */
static bool take_string(DictionaryIterator *iter, uint32_t key,
                        char *buf, size_t size, uint32_t persist_key) {
  Tuple *t = dict_find(iter, key);
  if (!t) return false;

  strncpy(buf, t->value->cstring, size - 1);
  buf[size - 1] = '\0';
  persist_write_string(persist_key, buf);
  return true;
}

static void prv_inbox_received(DictionaryIterator *iter, void *context) {
  Tuple *theme_t  = dict_find(iter, MESSAGE_KEY_SETTINGS_THEME);
  Tuple *accent_t = dict_find(iter, MESSAGE_KEY_SETTINGS_ACCENT);
  Tuple *date_t   = dict_find(iter, MESSAGE_KEY_F1_SESSION_DATE);

  if (theme_t) {
    s_inverted = (bool)theme_t->value->int32;
    persist_write_bool(PERSIST_THEME, s_inverted);
  }
  if (accent_t) {
    int hex = (int)accent_t->value->int32;
    s_accent = GColorFromHEX(hex);
    persist_write_int(PERSIST_ACCENT, hex);
  }
  if (theme_t || accent_t) {
    // Both repaint everything, including the accent-coloured leader row.
    apply_theme();
  }

  bool board_changed = false;

  if (date_t) {
    s_session_date = (int)date_t->value->int32;
    persist_write_int(PERSIST_SESSION_DATE, s_session_date);
    board_changed = true;
  }

  board_changed |= take_string(iter, MESSAGE_KEY_F1_EVENT,
                               s_event_buf, sizeof(s_event_buf), PERSIST_EVENT);
  board_changed |= take_string(iter, MESSAGE_KEY_F1_SESSION,
                               s_session_buf, sizeof(s_session_buf), PERSIST_SESSION);
  board_changed |= take_string(iter, MESSAGE_KEY_F1_NEXT_LABEL,
                               s_next_label_buf, sizeof(s_next_label_buf),
                               PERSIST_NEXT_LABEL);
  board_changed |= take_string(iter, MESSAGE_KEY_F1_NEXT_DATES,
                               s_next_dates_buf, sizeof(s_next_dates_buf),
                               PERSIST_NEXT_DATES);

  // The nine row keys are grouped by row so they can be walked rather than
  // spelled out three times over. Not static: the SDK generates the
  // MESSAGE_KEY_* symbols as variables, not compile-time constants, so this
  // table has to be built on the stack each time.
  const uint32_t ROW_KEYS[ROW_COUNT][3] = {
    { MESSAGE_KEY_F1_P1_POS, MESSAGE_KEY_F1_P1_CODE, MESSAGE_KEY_F1_P1_TIME },
    { MESSAGE_KEY_F1_P2_POS, MESSAGE_KEY_F1_P2_CODE, MESSAGE_KEY_F1_P2_TIME },
    { MESSAGE_KEY_F1_P3_POS, MESSAGE_KEY_F1_P3_CODE, MESSAGE_KEY_F1_P3_TIME }
  };

  for (int i = 0; i < ROW_COUNT; i++) {
    uint32_t base = PERSIST_ROW_BASE + (uint32_t)(i * 3);
    board_changed |= take_string(iter, ROW_KEYS[i][0],
                                 s_pos_bufs[i],  sizeof(s_pos_bufs[i]),  base);
    board_changed |= take_string(iter, ROW_KEYS[i][1],
                                 s_code_bufs[i], sizeof(s_code_bufs[i]), base + 1);
    board_changed |= take_string(iter, ROW_KEYS[i][2],
                                 s_time_bufs[i], sizeof(s_time_bufs[i]), base + 2);
  }

  if (board_changed) {
    // The layers point at the buffers, so the text has already changed
    // underneath them; this is what makes them notice.
    text_layer_set_text(s_event_layer,      s_event_buf);
    text_layer_set_text(s_session_layer,    s_session_buf);
    text_layer_set_text(s_next_label_layer, s_next_label_buf);
    text_layer_set_text(s_next_dates_layer, s_next_dates_buf);
    for (int i = 0; i < ROW_COUNT; i++) {
      text_layer_set_text(s_pos_layers[i],  s_pos_bufs[i]);
      text_layer_set_text(s_code_layers[i], s_code_bufs[i]);
      text_layer_set_text(s_time_layers[i], s_time_bufs[i]);
    }

    time_t utc = time(NULL);
    update_mode(localtime(&utc));
  }
}

static void prv_inbox_dropped(AppMessageResult reason, void *context) {
  APP_LOG(APP_LOG_LEVEL_WARNING, "AppMessage dropped: %d", (int)reason);
}

// ---------------------------------------------------------------------------
// Window lifecycle
// ---------------------------------------------------------------------------
static TextLayer *make_text_layer(Layer *root, GRect frame, GFont font,
                                  GTextAlignment alignment, const char *text) {
  TextLayer *layer = text_layer_create(frame);
  text_layer_set_font(layer, font);
  text_layer_set_background_color(layer, GColorClear);
  text_layer_set_text_alignment(layer, alignment);
  text_layer_set_text(layer, text);
  layer_add_child(root, text_layer_get_layer(layer));
  return layer;
}

static void prv_window_load(Window *window) {
  Layer *root = window_get_root_layer(window);

  s_font_grotesk_72 = fonts_load_custom_font(resource_get_handle(RESOURCE_ID_SPACE_GROTESK_72));
  s_font_grotesk_36 = fonts_load_custom_font(resource_get_handle(RESOURCE_ID_SPACE_GROTESK_36));
  s_font_grotesk_26 = fonts_load_custom_font(resource_get_handle(RESOURCE_ID_SPACE_GROTESK_26));
  s_font_mono_20    = fonts_load_custom_font(resource_get_handle(RESOURCE_ID_SPACE_MONO_20));
  s_font_mono_18    = fonts_load_custom_font(resource_get_handle(RESOURCE_ID_SPACE_MONO_18));
  s_font_mono_14    = fonts_load_custom_font(resource_get_handle(RESOURCE_ID_SPACE_MONO_14));

  // Chrome first, so the hairline sits behind everything else.
  s_chrome_layer = layer_create(GRect(0, 0, SCREEN_W, SCREEN_H));
  layer_set_update_proc(s_chrome_layer, chrome_update_proc);
  layer_add_child(root, s_chrome_layer);

  strncpy(s_hours_buf,   VALUE_UNAVAILABLE, sizeof(s_hours_buf));
  strncpy(s_minutes_buf, VALUE_UNAVAILABLE, sizeof(s_minutes_buf));

  // --- Countdown layout ---
  s_weekday_layer = make_text_layer(root, GRect(SAFE_L, CD_WEEKDAY_Y, 100, CD_WEEKDAY_H),
                                    s_font_mono_14, GTextAlignmentLeft, s_weekday_buf);
  s_cd_date_layer = make_text_layer(root, GRect(SAFE_L, CD_DATE_Y, 130, CD_DATE_H),
                                    s_font_mono_18, GTextAlignmentLeft, s_cd_date_buf);

  s_cd_clock_layer = layer_create(GRect(0, CD_TIME_Y, SCREEN_W, CD_TIME_H));
  layer_set_update_proc(s_cd_clock_layer, cd_clock_update_proc);
  layer_add_child(root, s_cd_clock_layer);

  s_next_label_layer = make_text_layer(root,
    GRect(CD_LABEL_X, CD_ROW_Y, CD_LABEL_W, CD_ROW_H),
    s_font_mono_14, GTextAlignmentLeft, s_next_label_buf);
  s_next_dates_layer = make_text_layer(root,
    GRect(CD_DATES_X, CD_ROW_Y, CD_DATES_W, CD_ROW_H),
    s_font_mono_14, GTextAlignmentRight, s_next_dates_buf);

  // --- Board layout ---
  s_bd_date_layer = make_text_layer(root, GRect(BD_DATE_X, BD_DATE_Y, BD_DATE_W, BD_DATE_H),
                                    s_font_mono_14, GTextAlignmentLeft, s_bd_date_buf);

  s_bd_clock_layer = layer_create(GRect(0, BD_CLOCK_Y, SCREEN_W, BD_CLOCK_H));
  layer_set_update_proc(s_bd_clock_layer, bd_clock_update_proc);
  layer_add_child(root, s_bd_clock_layer);

  s_event_layer = make_text_layer(root, GRect(BD_EVENT_X, BD_EVENT_Y, BD_EVENT_W, BD_EVENT_H),
                                  s_font_mono_14, GTextAlignmentLeft, s_event_buf);
  s_session_layer = make_text_layer(root,
    GRect(BD_SESSION_X, BD_EVENT_Y, BD_SESSION_W, BD_EVENT_H),
    s_font_mono_14, GTextAlignmentRight, s_session_buf);

  for (int i = 0; i < ROW_COUNT; i++) {
    int y = ROW0_Y + i * ROW_SPACING;

    s_pos_layers[i]  = make_text_layer(root, GRect(POS_X, y + CODE_DY, POS_W, ROW_H),
                                       s_font_mono_20, GTextAlignmentLeft, s_pos_bufs[i]);
    s_code_layers[i] = make_text_layer(root, GRect(CODE_X, y + CODE_DY, CODE_W, ROW_H),
                                       s_font_mono_20, GTextAlignmentLeft, s_code_bufs[i]);
    s_time_layers[i] = make_text_layer(root, GRect(TIME_X, y, TIME_W, ROW_H),
                                       s_font_grotesk_26, GTextAlignmentRight, s_time_bufs[i]);
  }

  apply_theme();
  time_t utc = time(NULL);
  struct tm *local_tm = localtime(&utc);
  s_board_mode = (s_session_date != 0 && s_session_date == date_number(local_tm));
  apply_mode();
  update_display(local_tm);
}

static void prv_window_unload(Window *window) {
  layer_destroy(s_chrome_layer);

  text_layer_destroy(s_weekday_layer);
  text_layer_destroy(s_cd_date_layer);
  layer_destroy(s_cd_clock_layer);
  text_layer_destroy(s_next_label_layer);
  text_layer_destroy(s_next_dates_layer);

  text_layer_destroy(s_bd_date_layer);
  layer_destroy(s_bd_clock_layer);
  text_layer_destroy(s_event_layer);
  text_layer_destroy(s_session_layer);
  for (int i = 0; i < ROW_COUNT; i++) {
    text_layer_destroy(s_pos_layers[i]);
    text_layer_destroy(s_code_layers[i]);
    text_layer_destroy(s_time_layers[i]);
  }

  fonts_unload_custom_font(s_font_grotesk_72);
  fonts_unload_custom_font(s_font_grotesk_36);
  fonts_unload_custom_font(s_font_grotesk_26);
  fonts_unload_custom_font(s_font_mono_20);
  fonts_unload_custom_font(s_font_mono_18);
  fonts_unload_custom_font(s_font_mono_14);
}

// ---------------------------------------------------------------------------
// App lifecycle
// ---------------------------------------------------------------------------

/** Read a persisted string, or leave the fallback in place if there is none. */
static void restore_string(uint32_t key, char *buf, size_t size, const char *fallback) {
  if (persist_exists(key)) {
    persist_read_string(key, buf, size);
  } else {
    strncpy(buf, fallback, size - 1);
    buf[size - 1] = '\0';
  }
}

static void prv_init(void) {
  s_inverted = persist_exists(PERSIST_THEME) ? persist_read_bool(PERSIST_THEME) : false;
  s_accent   = GColorFromHEX(persist_exists(PERSIST_ACCENT)
                               ? persist_read_int(PERSIST_ACCENT) : ACCENT_DEFAULT_HEX);
  s_session_date = persist_exists(PERSIST_SESSION_DATE)
                     ? persist_read_int(PERSIST_SESSION_DATE) : 0;

  restore_string(PERSIST_EVENT,      s_event_buf,      sizeof(s_event_buf),      "");
  restore_string(PERSIST_SESSION,    s_session_buf,    sizeof(s_session_buf),    "");
  restore_string(PERSIST_NEXT_LABEL, s_next_label_buf, sizeof(s_next_label_buf), "");
  restore_string(PERSIST_NEXT_DATES, s_next_dates_buf, sizeof(s_next_dates_buf),
                 VALUE_UNAVAILABLE);

  for (int i = 0; i < ROW_COUNT; i++) {
    uint32_t base = PERSIST_ROW_BASE + (uint32_t)(i * 3);
    char position[4];
    snprintf(position, sizeof(position), "%d", i + 1);

    restore_string(base,     s_pos_bufs[i],  sizeof(s_pos_bufs[i]),  position);
    restore_string(base + 1, s_code_bufs[i], sizeof(s_code_bufs[i]), CODE_UNAVAILABLE);
    restore_string(base + 2, s_time_bufs[i], sizeof(s_time_bufs[i]), VALUE_UNAVAILABLE);
  }

  s_window = window_create();
  window_set_window_handlers(s_window, (WindowHandlers){
    .load   = prv_window_load,
    .unload = prv_window_unload,
  });
  window_stack_push(s_window, true);

  tick_timer_service_subscribe(MINUTE_UNIT, tick_handler);

  app_message_register_inbox_received(prv_inbox_received);
  app_message_register_inbox_dropped(prv_inbox_dropped);
  app_message_open(app_message_inbox_size_maximum(), app_message_outbox_size_maximum());
}

static void prv_deinit(void) {
  tick_timer_service_unsubscribe();
  window_destroy(s_window);
}

int main(void) {
  prv_init();
  app_event_loop();
  prv_deinit();
}
