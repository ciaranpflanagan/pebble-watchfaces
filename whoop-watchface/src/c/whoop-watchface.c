#include <pebble.h>
#include <ctype.h>

// ---------------------------------------------------------------------------
// Design tokens
// ---------------------------------------------------------------------------
// Default accent, used until the phone sends one. 0x55AAFF is GColorPictonBlue.
// Keep in step with DEFAULT_ACCENT in src/pkjs/accent.js.
#define ACCENT_DEFAULT_HEX  0x55AAFF

// Recovery zones, as Whoop defines them. Keep in step with RECOVERY_GREEN_MIN /
// RECOVERY_YELLOW_MIN in src/pkjs/whoop.js.
#define RECOVERY_GREEN_MIN   67
#define RECOVERY_YELLOW_MIN  34
#define COLOR_RECOVERY_GREEN   GColorJaegerGreen     // 0x00AA55
#define COLOR_RECOVERY_YELLOW  GColorChromeYellow    // 0xFFAA00
#define COLOR_RECOVERY_RED     GColorFolly           // 0xFF0055
#define COLOR_SLEEP            GColorVeryLightBlue   // 0x5555FF

// Readings older than this are drawn muted: the phone has stopped syncing.
#define STALE_AFTER_SECS  (3 * 60 * 60)

// Strain is on Whoop's 0–21 scale, sent in tenths.
#define STRAIN_MAX_TENTHS 210

// Screen geometry (emery: 200 × 228)
#define SCREEN_W  200
#define SAFE_L  16
#define SAFE_R  184
#define SAFE_T  16
#define SAFE_B  214

// ---------------------------------------------------------------------------
// Persistent storage keys
// ---------------------------------------------------------------------------
#define PERSIST_THEME         0
#define PERSIST_TEMP_UNIT     1
#define PERSIST_ACCENT        2
#define PERSIST_WEATHER_TEMP  3
#define PERSIST_WEATHER_ICON  4
#define PERSIST_RECOVERY      5
#define PERSIST_SLEEP_PERF    6
#define PERSIST_SLEEP_MINS    7
#define PERSIST_STRAIN        8
#define PERSIST_SYNC_TIME     9

// ---------------------------------------------------------------------------
// Layout
// ---------------------------------------------------------------------------
#define WEEKDAY_Y   SAFE_T
#define WEEKDAY_H   16
#define DATE_Y      30
#define DATE_H      22

// Weather: icon and temperature share one layer, right-aligned to SAFE_R.
#define WX_X        96
#define WX_Y        (SAFE_T + 2)
#define WX_W        (SAFE_R - WX_X)
#define WX_H        24
#define WX_ICON     20      // glyph box, px (glyphs are designed on a 26 grid)
#define WX_GAP      5
#define WX_TEXT_NUDGE 5     // Pebble fonts carry top padding above the glyphs

#define TIME_Y      48
#define TIME_H      70

#define HAIRLINE_Y  116

// Three ring gauges across the safe width.
#define RING_D      50
#define RING_T      4       // stroke thickness
#define RING_GAP    ((SAFE_R - SAFE_L - 3 * RING_D) / 2)
#define RING_Y      124
#define RING_TEXT_NUDGE 4
#define RING_LABEL_Y   (RING_Y + RING_D + 4)
#define RING_LABEL_H   14

#define FOOTER_Y    202
#define FOOTER_H    14

// ---------------------------------------------------------------------------
// Weather icon enum — matches ICON_* in src/pkjs/weather.js
// ---------------------------------------------------------------------------
typedef enum {
  ICON_CLEAR   = 0,
  ICON_CLOUDY  = 1,
  ICON_FOG     = 2,
  ICON_RAIN    = 3,
  ICON_SNOW    = 4,
  ICON_STORM   = 5,
  ICON_UNKNOWN = 6,
} WeatherIconType;

// ---------------------------------------------------------------------------
// The three gauges, left to right
// ---------------------------------------------------------------------------
typedef enum {
  METRIC_SLEEP    = 0,
  METRIC_RECOVERY = 1,
  METRIC_STRAIN   = 2,
  METRIC_COUNT
} Metric;

static const char * const METRIC_LABELS[METRIC_COUNT] = {
  "SLEEP", "RECOVERY", "STRAIN"
};

// Shown whenever there is no reading: never synced, or Whoop has not scored it.
#define VALUE_UNAVAILABLE "--"

// Sentinel for "no reading" in every Whoop value below.
#define NO_VALUE (-1)

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------
static Window    *s_window;
static TextLayer *s_weekday_layer;
static TextLayer *s_date_layer;
static Layer     *s_weather_layer;
static Layer     *s_time_layer;
static Layer     *s_rings_layer;
static TextLayer *s_footer_left_layer;
static TextLayer *s_footer_right_layer;

static GFont s_font_grotesk_56;
static GFont s_font_grotesk_18;
static GFont s_font_mono_18;
static GFont s_font_mono_13;
static GFont s_font_mono_11;

static bool   s_light_theme    = false;
static bool   s_use_fahrenheit = false;
static GColor s_accent;                         // set in prv_init

static int32_t         s_weather_temp = 0;
static bool            s_have_weather = false;
static WeatherIconType s_weather_icon = ICON_UNKNOWN;

static int32_t s_recovery     = NO_VALUE;       // 0–100 %
static int32_t s_sleep_perf   = NO_VALUE;       // 0–100 %
static int32_t s_sleep_mins   = NO_VALUE;       // minutes asleep
static int32_t s_strain_tenths = NO_VALUE;      // 0–210
static int32_t s_sync_time    = 0;              // epoch secs of the last sync

static char s_weekday_buf[6];
static char s_date_buf[12];
static char s_weather_buf[12];
static char s_hours_buf[3];
static char s_minutes_buf[3];
static char s_footer_left_buf[24];
static char s_footer_right_buf[16];

// ---------------------------------------------------------------------------
// Theme helpers
// ---------------------------------------------------------------------------
static GColor bg_color(void)       { return s_light_theme ? GColorWhite : GColorBlack; }
static GColor fg_color(void)       { return s_light_theme ? GColorBlack : GColorWhite; }
static GColor muted_color(void)    { return s_light_theme ? GColorDarkGray : GColorLightGray; }
static GColor hairline_color(void) { return s_light_theme ? GColorLightGray : GColorDarkGray; }

static bool is_stale(void) {
  return s_sync_time <= 0 || (time(NULL) - (time_t)s_sync_time) > STALE_AFTER_SECS;
}

static void apply_theme(void) {
  window_set_background_color(s_window, bg_color());
  text_layer_set_text_color(s_weekday_layer,      muted_color());
  text_layer_set_text_color(s_date_layer,         fg_color());
  text_layer_set_text_color(s_footer_left_layer,  muted_color());
  text_layer_set_text_color(s_footer_right_layer, muted_color());
  layer_mark_dirty(s_weather_layer);
  layer_mark_dirty(s_time_layer);
  layer_mark_dirty(s_rings_layer);
}

// ---------------------------------------------------------------------------
// Weather icons — flat single-colour glyphs designed on a 26 px grid and
// scaled to WX_ICON. `o` is the glyph's top-left corner.
// ---------------------------------------------------------------------------
#define S(v)        ((int16_t)(((v) * WX_ICON) / 26))
#define P(o, px, py)  GPoint((o).x + S(px), (o).y + S(py))

static const int8_t SUN_DX1[] = { 7,  5, 0, -5, -7, -5,  0,  5};
static const int8_t SUN_DY1[] = { 0,  5, 7,  5,  0, -5, -7, -5};
static const int8_t SUN_DX2[] = {11,  8, 0, -8,-11, -8,  0,  8};
static const int8_t SUN_DY2[] = { 0,  8,11,  8,  0, -8,-11, -8};

static void draw_weather_icon(GContext *ctx, GPoint o) {
  graphics_context_set_fill_color(ctx, fg_color());
  graphics_context_set_stroke_color(ctx, fg_color());
  graphics_context_set_stroke_width(ctx, 2);

  switch (s_weather_icon) {
    case ICON_CLEAR:
      graphics_fill_circle(ctx, P(o, 13, 13), S(5));
      for (int i = 0; i < 8; i++) {
        graphics_draw_line(ctx, P(o, 13 + SUN_DX1[i], 13 + SUN_DY1[i]),
                                P(o, 13 + SUN_DX2[i], 13 + SUN_DY2[i]));
      }
      break;
    case ICON_CLOUDY:
      graphics_fill_circle(ctx, P(o, 8, 11), S(6));
      graphics_fill_circle(ctx, P(o, 16, 9), S(7));
      graphics_fill_rect(ctx, GRect(o.x + S(2), o.y + S(13), S(22), S(9)), 3, GCornersBottom);
      break;
    case ICON_FOG:
      graphics_draw_line(ctx, P(o, 4,  6), P(o, 22,  6));
      graphics_draw_line(ctx, P(o, 4, 13), P(o, 22, 13));
      graphics_draw_line(ctx, P(o, 4, 20), P(o, 22, 20));
      break;
    case ICON_RAIN:
      graphics_fill_circle(ctx, P(o, 8, 7), S(5));
      graphics_fill_circle(ctx, P(o, 17, 6), S(4));
      graphics_fill_rect(ctx, GRect(o.x + S(3), o.y + S(9), S(20), S(6)), 2, GCornersBottom);
      graphics_draw_line(ctx, P(o, 7,  16), P(o, 5,  23));
      graphics_draw_line(ctx, P(o, 13, 16), P(o, 11, 23));
      graphics_draw_line(ctx, P(o, 19, 16), P(o, 17, 23));
      break;
    case ICON_SNOW:
      graphics_draw_line(ctx, P(o, 13, 2), P(o, 13, 24));
      graphics_draw_line(ctx, P(o, 4,  8), P(o, 22, 18));
      graphics_draw_line(ctx, P(o, 4, 18), P(o, 22,  8));
      break;
    case ICON_STORM:
      graphics_draw_line(ctx, P(o, 16,  2), P(o, 9,  13));
      graphics_draw_line(ctx, P(o, 9,  13), P(o, 15, 13));
      graphics_draw_line(ctx, P(o, 15, 13), P(o, 8,  24));
      break;
    case ICON_UNKNOWN:
    default:
      break;
  }
}

/** Temperature right-aligned to the layer edge, with the glyph to its left. */
static void weather_update_proc(Layer *layer, GContext *ctx) {
  GRect bounds = layer_get_bounds(layer);

  if (s_have_weather) {
    snprintf(s_weather_buf, sizeof(s_weather_buf), "%d\xc2\xb0%c",
             (int)s_weather_temp, s_use_fahrenheit ? 'F' : 'C');
  } else {
    snprintf(s_weather_buf, sizeof(s_weather_buf), "%s", VALUE_UNAVAILABLE);
  }

  GSize text_sz = graphics_text_layout_get_content_size(
    s_weather_buf, s_font_grotesk_18, bounds, GTextOverflowModeFill, GTextAlignmentRight);

  graphics_context_set_text_color(ctx, fg_color());
  graphics_draw_text(ctx, s_weather_buf, s_font_grotesk_18,
    GRect(0, -WX_TEXT_NUDGE, bounds.size.w, bounds.size.h + WX_TEXT_NUDGE),
    GTextOverflowModeFill, GTextAlignmentRight, NULL);

  int16_t icon_x = bounds.size.w - text_sz.w - WX_GAP - WX_ICON;
  draw_weather_icon(ctx, GPoint(icon_x, (bounds.size.h - WX_ICON) / 2));
}

// ---------------------------------------------------------------------------
// Main time — measured and centred at runtime, accent-coloured colon
// ---------------------------------------------------------------------------
static void time_layer_update_proc(Layer *layer, GContext *ctx) {
  GRect measure = GRect(0, 0, SCREEN_W, TIME_H);

  GSize hh_sz    = graphics_text_layout_get_content_size(
    s_hours_buf,   s_font_grotesk_56, measure, GTextOverflowModeWordWrap, GTextAlignmentLeft);
  GSize colon_sz = graphics_text_layout_get_content_size(
    ":",           s_font_grotesk_56, measure, GTextOverflowModeWordWrap, GTextAlignmentLeft);
  GSize mm_sz    = graphics_text_layout_get_content_size(
    s_minutes_buf, s_font_grotesk_56, measure, GTextOverflowModeWordWrap, GTextAlignmentLeft);

  int16_t x = (SCREEN_W - hh_sz.w - colon_sz.w - mm_sz.w) / 2;

  graphics_context_set_text_color(ctx, fg_color());
  graphics_draw_text(ctx, s_hours_buf, s_font_grotesk_56,
    GRect(x, 0, hh_sz.w + 2, TIME_H), GTextOverflowModeWordWrap, GTextAlignmentLeft, NULL);
  x += hh_sz.w;

  graphics_context_set_text_color(ctx, s_accent);
  graphics_draw_text(ctx, ":", s_font_grotesk_56,
    GRect(x, 0, colon_sz.w + 2, TIME_H), GTextOverflowModeWordWrap, GTextAlignmentLeft, NULL);
  x += colon_sz.w;

  graphics_context_set_text_color(ctx, fg_color());
  graphics_draw_text(ctx, s_minutes_buf, s_font_grotesk_56,
    GRect(x, 0, mm_sz.w + 2, TIME_H), GTextOverflowModeWordWrap, GTextAlignmentLeft, NULL);
}

// ---------------------------------------------------------------------------
// Ring gauges
// ---------------------------------------------------------------------------
static GColor recovery_color(int32_t score) {
  if (score >= RECOVERY_GREEN_MIN)  return COLOR_RECOVERY_GREEN;
  if (score >= RECOVERY_YELLOW_MIN) return COLOR_RECOVERY_YELLOW;
  return COLOR_RECOVERY_RED;
}

/** Progress as a fraction of TRIG_MAX_ANGLE, or -1 when there is no reading. */
static int32_t metric_angle(Metric m) {
  int32_t value, max;
  switch (m) {
    case METRIC_RECOVERY: value = s_recovery;     max = 100;               break;
    case METRIC_SLEEP:    value = s_sleep_perf;   max = 100;               break;
    case METRIC_STRAIN:   value = s_strain_tenths; max = STRAIN_MAX_TENTHS; break;
    default: return NO_VALUE;
  }
  if (value < 0) return NO_VALUE;
  if (value > max) value = max;
  return (TRIG_MAX_ANGLE * value) / max;
}

static GColor metric_color(Metric m) {
  if (is_stale()) return muted_color();
  switch (m) {
    case METRIC_RECOVERY: return recovery_color(s_recovery);
    case METRIC_SLEEP:    return COLOR_SLEEP;
    case METRIC_STRAIN:   return s_accent;
    default:              return fg_color();
  }
}

static void format_metric(Metric m, char *buf, size_t size) {
  switch (m) {
    case METRIC_RECOVERY:
    case METRIC_SLEEP: {
      int32_t v = (m == METRIC_RECOVERY) ? s_recovery : s_sleep_perf;
      if (v < 0) snprintf(buf, size, "%s", VALUE_UNAVAILABLE);
      else       snprintf(buf, size, "%d", (int)v);
      break;
    }
    case METRIC_STRAIN:
      if (s_strain_tenths < 0) snprintf(buf, size, "%s", VALUE_UNAVAILABLE);
      else snprintf(buf, size, "%d.%d", (int)(s_strain_tenths / 10), (int)(s_strain_tenths % 10));
      break;
    default:
      snprintf(buf, size, "%s", VALUE_UNAVAILABLE);
      break;
  }
}

/** A round dot on the ring's centre line, used to cap the progress arc. */
static void fill_ring_cap(GContext *ctx, GPoint c, int32_t angle) {
  int32_t r = RING_D / 2 - RING_T / 2;
  GPoint p = GPoint(c.x + (int16_t)((sin_lookup(angle) * r) / TRIG_MAX_RATIO),
                    c.y - (int16_t)((cos_lookup(angle) * r) / TRIG_MAX_RATIO));
  graphics_fill_circle(ctx, p, RING_T / 2);
}

// The rings layer starts at the hairline, so rings sit RING_TOP below its top.
#define RING_TOP  (RING_Y - HAIRLINE_Y)

static void draw_ring(GContext *ctx, Metric m, int16_t x) {
  GRect box = GRect(x, RING_TOP, RING_D, RING_D);
  GPoint c  = GPoint(x + RING_D / 2, RING_TOP + RING_D / 2);

  // Track
  graphics_context_set_fill_color(ctx, hairline_color());
  graphics_fill_radial(ctx, box, GOvalScaleModeFitCircle, RING_T, 0, TRIG_MAX_ANGLE);

  // Progress, clockwise from 12 o'clock with rounded ends
  int32_t angle = metric_angle(m);
  if (angle > 0) {
    graphics_context_set_fill_color(ctx, metric_color(m));
    graphics_fill_radial(ctx, box, GOvalScaleModeFitCircle, RING_T, 0, angle);
    if (angle < TRIG_MAX_ANGLE) {
      fill_ring_cap(ctx, c, 0);
      fill_ring_cap(ctx, c, angle);
    }
  }

  // Value, centred in the ring
  char value[8];
  format_metric(m, value, sizeof(value));
  GSize sz = graphics_text_layout_get_content_size(
    value, s_font_grotesk_18, box, GTextOverflowModeFill, GTextAlignmentCenter);
  graphics_context_set_text_color(ctx, is_stale() ? muted_color() : fg_color());
  graphics_draw_text(ctx, value, s_font_grotesk_18,
    GRect(x, RING_TOP + (RING_D - sz.h) / 2 - RING_TEXT_NUDGE, RING_D, sz.h + RING_TEXT_NUDGE),
    GTextOverflowModeFill, GTextAlignmentCenter, NULL);

  // Label beneath
  graphics_context_set_text_color(ctx, muted_color());
  graphics_draw_text(ctx, METRIC_LABELS[m], s_font_mono_11,
    GRect(x - RING_GAP / 2, RING_LABEL_Y - HAIRLINE_Y, RING_D + RING_GAP, RING_LABEL_H),
    GTextOverflowModeFill, GTextAlignmentCenter, NULL);
}

static void rings_update_proc(Layer *layer, GContext *ctx) {
  // Hairline along the top of the layer
  graphics_context_set_stroke_color(ctx, hairline_color());
  graphics_context_set_stroke_width(ctx, 1);
  graphics_draw_line(ctx, GPoint(SAFE_L, 0), GPoint(SAFE_R, 0));

  for (int m = 0; m < METRIC_COUNT; m++) {
    draw_ring(ctx, (Metric)m, SAFE_L + m * (RING_D + RING_GAP));
  }
}

// ---------------------------------------------------------------------------
// Footer: hours slept on the left, last sync on the right
// ---------------------------------------------------------------------------
static void render_footer(void) {
  if (!s_footer_left_layer) return;

  if (s_sleep_mins >= 0) {
    snprintf(s_footer_left_buf, sizeof(s_footer_left_buf), "SLEPT %dH %02dM",
             (int)(s_sleep_mins / 60), (int)(s_sleep_mins % 60));
  } else {
    snprintf(s_footer_left_buf, sizeof(s_footer_left_buf), "SLEPT %s", VALUE_UNAVAILABLE);
  }
  text_layer_set_text(s_footer_left_layer, s_footer_left_buf);

  if (s_sync_time > 0) {
    time_t t = (time_t)s_sync_time;
    char hhmm[6];
    strftime(hhmm, sizeof(hhmm), "%H:%M", localtime(&t));
    snprintf(s_footer_right_buf, sizeof(s_footer_right_buf), "SYNC %s", hhmm);
  } else {
    snprintf(s_footer_right_buf, sizeof(s_footer_right_buf), "NOT SYNCED");
  }
  text_layer_set_text(s_footer_right_layer, s_footer_right_buf);
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

  strftime(s_date_buf, sizeof(s_date_buf), "%d %b", local_tm);
  str_upper(s_date_buf);
  text_layer_set_text(s_date_layer, s_date_buf);

  strftime(s_hours_buf,   sizeof(s_hours_buf),   "%H", local_tm);
  strftime(s_minutes_buf, sizeof(s_minutes_buf), "%M", local_tm);
  layer_mark_dirty(s_time_layer);

  // Staleness is time-based, so the rings are re-evaluated every minute.
  layer_mark_dirty(s_rings_layer);
  render_footer();
}

static void tick_handler(struct tm *tick_time, TimeUnits units_changed) {
  update_display(tick_time);
}

// ---------------------------------------------------------------------------
// AppMessage
// ---------------------------------------------------------------------------
/** Read an int tuple into *dest and persist it. Returns true if present. */
static bool take_int(DictionaryIterator *iter, uint32_t key, int32_t *dest, uint32_t persist_key) {
  Tuple *t = dict_find(iter, key);
  if (!t) return false;
  *dest = t->value->int32;
  persist_write_int(persist_key, *dest);
  return true;
}

static void prv_inbox_received(DictionaryIterator *iter, void *context) {
  // Settings first, so data arriving in the same message renders with them.
  Tuple *unit_t   = dict_find(iter, MESSAGE_KEY_SETTINGS_TEMP_UNIT);
  Tuple *theme_t  = dict_find(iter, MESSAGE_KEY_SETTINGS_THEME);
  Tuple *accent_t = dict_find(iter, MESSAGE_KEY_SETTINGS_ACCENT);

  if (unit_t) {
    s_use_fahrenheit = (bool)unit_t->value->int32;
    persist_write_bool(PERSIST_TEMP_UNIT, s_use_fahrenheit);
  }
  if (theme_t) {
    s_light_theme = (bool)theme_t->value->int32;
    persist_write_bool(PERSIST_THEME, s_light_theme);
    apply_theme();
  }
  if (accent_t) {
    int hex = (int)accent_t->value->int32;
    s_accent = GColorFromHEX(hex);
    persist_write_int(PERSIST_ACCENT, hex);
  }

  if (take_int(iter, MESSAGE_KEY_WEATHER_TEMP, &s_weather_temp, PERSIST_WEATHER_TEMP)) {
    s_have_weather = true;
  }
  int32_t icon;
  if (take_int(iter, MESSAGE_KEY_WEATHER_ICON, &icon, PERSIST_WEATHER_ICON)) {
    s_weather_icon = (icon >= ICON_CLEAR && icon <= ICON_UNKNOWN)
                       ? (WeatherIconType)icon : ICON_UNKNOWN;
  }

  take_int(iter, MESSAGE_KEY_WHOOP_RECOVERY,   &s_recovery,     PERSIST_RECOVERY);
  take_int(iter, MESSAGE_KEY_WHOOP_SLEEP_PERF, &s_sleep_perf,   PERSIST_SLEEP_PERF);
  take_int(iter, MESSAGE_KEY_WHOOP_SLEEP_MINS, &s_sleep_mins,   PERSIST_SLEEP_MINS);
  take_int(iter, MESSAGE_KEY_WHOOP_STRAIN,     &s_strain_tenths, PERSIST_STRAIN);
  take_int(iter, MESSAGE_KEY_WHOOP_SYNC_TIME,  &s_sync_time,    PERSIST_SYNC_TIME);

  // Redraw once, rather than after each tuple.
  layer_mark_dirty(s_weather_layer);
  layer_mark_dirty(s_time_layer);
  layer_mark_dirty(s_rings_layer);
  render_footer();
}

static void prv_inbox_dropped(AppMessageResult reason, void *context) {
  APP_LOG(APP_LOG_LEVEL_WARNING, "AppMessage dropped: %d", (int)reason);
}

// ---------------------------------------------------------------------------
// Window lifecycle
// ---------------------------------------------------------------------------
static TextLayer *make_text_layer(Layer *root, GRect frame, GFont font, GTextAlignment align) {
  TextLayer *tl = text_layer_create(frame);
  text_layer_set_font(tl, font);
  text_layer_set_background_color(tl, GColorClear);
  text_layer_set_text_alignment(tl, align);
  layer_add_child(root, text_layer_get_layer(tl));
  return tl;
}

static void prv_window_load(Window *window) {
  Layer *root = window_get_root_layer(window);

  s_font_grotesk_56 = fonts_load_custom_font(resource_get_handle(RESOURCE_ID_SPACE_GROTESK_56));
  s_font_grotesk_18 = fonts_load_custom_font(resource_get_handle(RESOURCE_ID_SPACE_GROTESK_18));
  s_font_mono_18    = fonts_load_custom_font(resource_get_handle(RESOURCE_ID_SPACE_MONO_18));
  s_font_mono_13    = fonts_load_custom_font(resource_get_handle(RESOURCE_ID_SPACE_MONO_13));
  s_font_mono_11    = fonts_load_custom_font(resource_get_handle(RESOURCE_ID_SPACE_MONO_11));

  s_weekday_layer = make_text_layer(root, GRect(SAFE_L, WEEKDAY_Y, 80, WEEKDAY_H),
                                    s_font_mono_13, GTextAlignmentLeft);
  s_date_layer    = make_text_layer(root, GRect(SAFE_L, DATE_Y, 100, DATE_H),
                                    s_font_mono_18, GTextAlignmentLeft);

  s_weather_layer = layer_create(GRect(WX_X, WX_Y, WX_W, WX_H));
  layer_set_update_proc(s_weather_layer, weather_update_proc);
  layer_add_child(root, s_weather_layer);

  strncpy(s_hours_buf,   "--", sizeof(s_hours_buf));
  strncpy(s_minutes_buf, "--", sizeof(s_minutes_buf));
  s_time_layer = layer_create(GRect(0, TIME_Y, SCREEN_W, TIME_H));
  layer_set_update_proc(s_time_layer, time_layer_update_proc);
  layer_add_child(root, s_time_layer);

  // The rings layer runs from the hairline down to the bottom of the labels.
  s_rings_layer = layer_create(
    GRect(0, HAIRLINE_Y, SCREEN_W, RING_LABEL_Y + RING_LABEL_H - HAIRLINE_Y));
  layer_set_update_proc(s_rings_layer, rings_update_proc);
  layer_add_child(root, s_rings_layer);

  s_footer_left_layer  = make_text_layer(root, GRect(SAFE_L, FOOTER_Y, 100, FOOTER_H),
                                         s_font_mono_11, GTextAlignmentLeft);
  s_footer_right_layer = make_text_layer(root, GRect(SAFE_R - 80, FOOTER_Y, 80, FOOTER_H),
                                         s_font_mono_11, GTextAlignmentRight);

  apply_theme();
  time_t utc = time(NULL);
  update_display(localtime(&utc));
}

static void prv_window_unload(Window *window) {
  text_layer_destroy(s_weekday_layer);
  text_layer_destroy(s_date_layer);
  layer_destroy(s_weather_layer);
  layer_destroy(s_time_layer);
  layer_destroy(s_rings_layer);
  text_layer_destroy(s_footer_left_layer);
  text_layer_destroy(s_footer_right_layer);
  s_footer_left_layer  = NULL;
  s_footer_right_layer = NULL;

  fonts_unload_custom_font(s_font_grotesk_56);
  fonts_unload_custom_font(s_font_grotesk_18);
  fonts_unload_custom_font(s_font_mono_18);
  fonts_unload_custom_font(s_font_mono_13);
  fonts_unload_custom_font(s_font_mono_11);
}

// ---------------------------------------------------------------------------
// App lifecycle
// ---------------------------------------------------------------------------
static int32_t read_int_or(uint32_t key, int32_t fallback) {
  return persist_exists(key) ? persist_read_int(key) : fallback;
}

static void prv_init(void) {
  // Restore settings and the last readings, so the face is complete straight
  // after a restart instead of waiting on the phone.
  s_light_theme    = persist_exists(PERSIST_THEME)     && persist_read_bool(PERSIST_THEME);
  s_use_fahrenheit = persist_exists(PERSIST_TEMP_UNIT) && persist_read_bool(PERSIST_TEMP_UNIT);
  s_accent         = GColorFromHEX(read_int_or(PERSIST_ACCENT, ACCENT_DEFAULT_HEX));

  s_have_weather   = persist_exists(PERSIST_WEATHER_TEMP);
  s_weather_temp   = read_int_or(PERSIST_WEATHER_TEMP, 0);
  int32_t icon     = read_int_or(PERSIST_WEATHER_ICON, ICON_UNKNOWN);
  s_weather_icon   = (icon >= ICON_CLEAR && icon <= ICON_UNKNOWN)
                       ? (WeatherIconType)icon : ICON_UNKNOWN;

  s_recovery       = read_int_or(PERSIST_RECOVERY,   NO_VALUE);
  s_sleep_perf     = read_int_or(PERSIST_SLEEP_PERF, NO_VALUE);
  s_sleep_mins     = read_int_or(PERSIST_SLEEP_MINS, NO_VALUE);
  s_strain_tenths  = read_int_or(PERSIST_STRAIN,     NO_VALUE);
  s_sync_time      = read_int_or(PERSIST_SYNC_TIME,  0);

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
