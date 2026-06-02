#include <pebble.h>
#include <ctype.h>

// ---------------------------------------------------------------------------
// Design tokens
// ---------------------------------------------------------------------------
#define COLOR_ACCENT     GColorSunsetOrange   // same in both themes
#define PERSIST_KEY_INVERTED  0               // persistent storage key

// Screen geometry (emery: 200 × 228)
#define SAFE_L  16
#define SAFE_R  184
#define SAFE_T  16
#define SAFE_B  214   // 228 − 14 bottom padding

// ---------------------------------------------------------------------------
// Layout
// ---------------------------------------------------------------------------

// Header
#define WEEKDAY_Y   SAFE_T   // 16
#define WEEKDAY_H   18
#define DATE_Y      32
#define DATE_H      24

// Weather group — icon 26×26 | 6px gap | temp right-aligned to SAFE_R
#define WX_ICON_W   26
#define WX_ICON_H   26
#define WX_TEMP_W   50
#define WX_GAP      6
#define WX_ICON_X   (SAFE_R - WX_TEMP_W - WX_GAP - WX_ICON_W + 16)  // 118
#define WX_ICON_Y   (SAFE_T + 4)                                       // 20
#define WX_TEMP_X   (WX_ICON_X + WX_ICON_W + WX_GAP)
#define WX_TEMP_Y   20
#define WX_TEMP_H   28

// Main time — full-width custom layer; text measured and centred at runtime.
// At 72px SpaceGrotesk tabular, "HH:MM" ≈ 196px — nearly edge-to-edge.
// Vertical target: centre ≈ y 112. With TIME_H=92 and font ascender ~40px
// from top of layer: visual centre ≈ TIME_Y + 40 ≈ 72 + 40 = 112. ✓
#define TIME_Y   72
#define TIME_H   92

// Footer chrome
#define HAIRLINE_Y    179
#define CHROME_H      (SAFE_B - HAIRLINE_Y)    // 35
#define DOT_R         3                         // diameter 7px
#define DOT_X         (SAFE_L + DOT_R + 0)     // 19
#define DOT_Y_LOCAL   22     // in chrome-layer coords → absolute y = 201
#define FOOTER_LABEL_X   (SAFE_L + (DOT_R*2+1) + 7)   // 30
#define FOOTER_LABEL_Y   194
#define FOOTER_LABEL_H   16
#define FOOTER_TIME_X    100
#define FOOTER_TIME_Y    190
#define FOOTER_TIME_W    (SAFE_R - FOOTER_TIME_X)      // 84
#define FOOTER_TIME_H    24

// ---------------------------------------------------------------------------
// Weather icon enum — matches ICON_* in src/pkjs/index.js
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
// State
// ---------------------------------------------------------------------------
static Window    *s_window;
static TextLayer *s_weekday_layer;
static TextLayer *s_date_layer;
static Layer     *s_weather_icon_layer;
static TextLayer *s_weather_temp_layer;
static Layer     *s_time_layer;
static Layer     *s_chrome_layer;
static TextLayer *s_dublin_label_layer;
static TextLayer *s_dublin_time_layer;

static GFont s_font_grotesk_72;
static GFont s_font_grotesk_24;
static GFont s_font_grotesk_22;
static GFont s_font_mono_18;
static GFont s_font_mono_14;
static GFont s_font_mono_13;

static WeatherIconType s_weather_icon  = ICON_UNKNOWN;
static int             s_dublin_offset = 60;
static bool            s_inverted      = true;    // light/dark toggle

static char s_weekday_buf[6];
static char s_date_buf[12];
static char s_weather_temp_buf[16];
static char s_hours_buf[3];
static char s_minutes_buf[3];
static char s_dublin_time_buf[6];

// ---------------------------------------------------------------------------
// Theme helpers — all colour decisions go through these
// ---------------------------------------------------------------------------
static GColor fg_color(void) {
  return s_inverted ? GColorBlack : GColorWhite;
}
static GColor muted_color(void) {
  return s_inverted ? GColorDarkGray : GColorLightGray;
}
static GColor hairline_color(void) {
  // Visible but quiet on both backgrounds
  return s_inverted ? GColorLightGray : GColorDarkGray;
}

// Recolours every layer and redraws custom layers.
// Call once after window load and again on each toggle.
static void apply_theme(void) {
  GColor bg = s_inverted ? GColorWhite : GColorBlack;
  window_set_background_color(s_window, bg);

  text_layer_set_text_color(s_weekday_layer,      muted_color());
  text_layer_set_text_color(s_date_layer,          fg_color());
  text_layer_set_text_color(s_weather_temp_layer,  fg_color());
  text_layer_set_text_color(s_dublin_label_layer,  muted_color());
  text_layer_set_text_color(s_dublin_time_layer,   fg_color());

  // Custom-drawn layers pick up theme via fg_color() / hairline_color()
  layer_mark_dirty(s_weather_icon_layer);
  layer_mark_dirty(s_time_layer);
  layer_mark_dirty(s_chrome_layer);
}

// ---------------------------------------------------------------------------
// Weather icons — flat single-colour glyphs, 26×26 px
// ---------------------------------------------------------------------------
static const int8_t SUN_DX1[] = { 7,  5, 0, -5, -7, -5,  0,  5};
static const int8_t SUN_DY1[] = { 0,  5, 7,  5,  0, -5, -7, -5};
static const int8_t SUN_DX2[] = {11,  8, 0, -8,-11, -8,  0,  8};
static const int8_t SUN_DY2[] = { 0,  8,11,  8,  0, -8,-11, -8};

static void draw_icon_clear(GContext *ctx) {
  GPoint c = GPoint(13, 13);
  graphics_context_set_fill_color(ctx, fg_color());
  graphics_fill_circle(ctx, c, 5);
  graphics_context_set_stroke_color(ctx, fg_color());
  graphics_context_set_stroke_width(ctx, 2);
  for (int i = 0; i < 8; i++) {
    graphics_draw_line(ctx,
      GPoint(c.x + SUN_DX1[i], c.y + SUN_DY1[i]),
      GPoint(c.x + SUN_DX2[i], c.y + SUN_DY2[i]));
  }
}

static void draw_icon_cloudy(GContext *ctx) {
  graphics_context_set_fill_color(ctx, fg_color());
  graphics_fill_circle(ctx, GPoint(8,  11), 6);
  graphics_fill_circle(ctx, GPoint(16,  9), 7);
  graphics_fill_rect(ctx, GRect(2, 13, 22, 9), 4, GCornersBottom);
}

static void draw_icon_fog(GContext *ctx) {
  graphics_context_set_stroke_color(ctx, fg_color());
  graphics_context_set_stroke_width(ctx, 2);
  graphics_draw_line(ctx, GPoint(4,  6), GPoint(22,  6));
  graphics_draw_line(ctx, GPoint(4, 13), GPoint(22, 13));
  graphics_draw_line(ctx, GPoint(4, 20), GPoint(22, 20));
}

static void draw_icon_rain(GContext *ctx) {
  graphics_context_set_fill_color(ctx, fg_color());
  graphics_fill_circle(ctx, GPoint(8,  7), 5);
  graphics_fill_circle(ctx, GPoint(17, 6), 4);
  graphics_fill_rect(ctx, GRect(3, 9, 20, 6), 3, GCornersBottom);
  graphics_context_set_stroke_color(ctx, fg_color());
  graphics_context_set_stroke_width(ctx, 2);
  graphics_draw_line(ctx, GPoint(7,  16), GPoint(5,  23));
  graphics_draw_line(ctx, GPoint(13, 16), GPoint(11, 23));
  graphics_draw_line(ctx, GPoint(19, 16), GPoint(17, 23));
}

static void draw_icon_snow(GContext *ctx) {
  graphics_context_set_stroke_color(ctx, fg_color());
  graphics_context_set_stroke_width(ctx, 2);
  graphics_draw_line(ctx, GPoint(13,  2), GPoint(13, 24));
  graphics_draw_line(ctx, GPoint(4,   8), GPoint(22, 18));
  graphics_draw_line(ctx, GPoint(4,  18), GPoint(22,  8));
}

static void draw_icon_storm(GContext *ctx) {
  graphics_context_set_stroke_color(ctx, fg_color());
  graphics_context_set_stroke_width(ctx, 2);
  graphics_draw_line(ctx, GPoint(16,  2), GPoint(9,  13));
  graphics_draw_line(ctx, GPoint(9,  13), GPoint(15, 13));
  graphics_draw_line(ctx, GPoint(15, 13), GPoint(8,  24));
}

static void weather_icon_update_proc(Layer *layer, GContext *ctx) {
  switch (s_weather_icon) {
    case ICON_CLEAR:  draw_icon_clear(ctx);  break;
    case ICON_CLOUDY: draw_icon_cloudy(ctx); break;
    case ICON_FOG:    draw_icon_fog(ctx);    break;
    case ICON_RAIN:   draw_icon_rain(ctx);   break;
    case ICON_SNOW:   draw_icon_snow(ctx);   break;
    case ICON_STORM:  draw_icon_storm(ctx);  break;
    case ICON_UNKNOWN:
    default: break;
  }
}

// ---------------------------------------------------------------------------
// Main time — measured and centred at runtime
// ---------------------------------------------------------------------------
static void time_layer_update_proc(Layer *layer, GContext *ctx) {
  GRect measure = GRect(0, 0, 200, TIME_H);

  GSize hh_sz    = graphics_text_layout_get_content_size(
    s_hours_buf,   s_font_grotesk_72, measure, GTextOverflowModeWordWrap, GTextAlignmentLeft);
  GSize colon_sz = graphics_text_layout_get_content_size(
    ":",           s_font_grotesk_72, measure, GTextOverflowModeWordWrap, GTextAlignmentLeft);
  GSize mm_sz    = graphics_text_layout_get_content_size(
    s_minutes_buf, s_font_grotesk_72, measure, GTextOverflowModeWordWrap, GTextAlignmentLeft);

  int16_t total_w = hh_sz.w + colon_sz.w + mm_sz.w;
  int16_t x       = (200 - total_w) / 2;

  graphics_context_set_text_color(ctx, fg_color());
  graphics_draw_text(ctx, s_hours_buf, s_font_grotesk_72,
    GRect(x, 0, hh_sz.w + 2, TIME_H), GTextOverflowModeWordWrap, GTextAlignmentLeft, NULL);
  x += hh_sz.w;

  graphics_context_set_text_color(ctx, COLOR_ACCENT);
  graphics_draw_text(ctx, ":", s_font_grotesk_72,
    GRect(x, 0, colon_sz.w + 2, TIME_H), GTextOverflowModeWordWrap, GTextAlignmentLeft, NULL);
  x += colon_sz.w;

  graphics_context_set_text_color(ctx, fg_color());
  graphics_draw_text(ctx, s_minutes_buf, s_font_grotesk_72,
    GRect(x, 0, mm_sz.w + 2, TIME_H), GTextOverflowModeWordWrap, GTextAlignmentLeft, NULL);
}

// ---------------------------------------------------------------------------
// Footer chrome: hairline + accent dot
// ---------------------------------------------------------------------------
static void chrome_update_proc(Layer *layer, GContext *ctx) {
  graphics_context_set_stroke_color(ctx, hairline_color());
  graphics_context_set_stroke_width(ctx, 1);
  graphics_draw_line(ctx, GPoint(SAFE_L, 0), GPoint(SAFE_R, 0));

  graphics_context_set_fill_color(ctx, COLOR_ACCENT);
  graphics_fill_circle(ctx, GPoint(DOT_X, DOT_Y_LOCAL), DOT_R);
}

// ---------------------------------------------------------------------------
// Display update
// ---------------------------------------------------------------------------
static void str_upper(char *s) {
  for (; *s; s++) { *s = (char)toupper((unsigned char)*s); }
}

static void update_display(struct tm *local_tm, time_t utc) {
  strftime(s_weekday_buf, sizeof(s_weekday_buf), "%a", local_tm);
  str_upper(s_weekday_buf);
  text_layer_set_text(s_weekday_layer, s_weekday_buf);

  strftime(s_date_buf, sizeof(s_date_buf), "%d %b", local_tm);
  str_upper(s_date_buf);
  text_layer_set_text(s_date_layer, s_date_buf);

  strftime(s_hours_buf,   sizeof(s_hours_buf),   "%H", local_tm);
  strftime(s_minutes_buf, sizeof(s_minutes_buf), "%M", local_tm);
  layer_mark_dirty(s_time_layer);

  time_t dub_utc = utc + (time_t)(s_dublin_offset * 60);
  struct tm *dub_tm = gmtime(&dub_utc);
  strftime(s_dublin_time_buf, sizeof(s_dublin_time_buf), "%H:%M", dub_tm);
  text_layer_set_text(s_dublin_time_layer, s_dublin_time_buf);
}

static void tick_handler(struct tm *tick_time, TimeUnits units_changed) {
  update_display(tick_time, time(NULL));
}

// ---------------------------------------------------------------------------
// Theme toggle — SELECT button cycles dark ↔ light
// ---------------------------------------------------------------------------
static void select_click_handler(ClickRecognizerRef recognizer, void *context) {
  s_inverted = !s_inverted;
  persist_write_bool(PERSIST_KEY_INVERTED, s_inverted);
  apply_theme();
}

static void click_config_provider(void *context) {
  // Single clicks on UP/DOWN/SELECT are claimed by the system in watchface mode
  // (timeline and quick launch). Long-press DOWN is the only reliable hook.
  window_long_click_subscribe(BUTTON_ID_DOWN, 700, select_click_handler, NULL);
}

// ---------------------------------------------------------------------------
// AppMessage
// ---------------------------------------------------------------------------
static void prv_inbox_received(DictionaryIterator *iter, void *context) {
  Tuple *temp_t   = dict_find(iter, MESSAGE_KEY_WEATHER_TEMP);
  Tuple *icon_t   = dict_find(iter, MESSAGE_KEY_WEATHER_ICON);
  Tuple *offset_t = dict_find(iter, MESSAGE_KEY_DUBLIN_OFFSET);

  if (temp_t) {
    snprintf(s_weather_temp_buf, sizeof(s_weather_temp_buf),
             "%d\xc2\xb0", (int)temp_t->value->int32);
    text_layer_set_text(s_weather_temp_layer, s_weather_temp_buf);
  }
  if (icon_t) {
    s_weather_icon = (WeatherIconType)icon_t->value->int32;
    layer_mark_dirty(s_weather_icon_layer);
  }
  if (offset_t) {
    s_dublin_offset = (int)offset_t->value->int32;
    time_t utc = time(NULL);
    update_display(localtime(&utc), utc);
  }
}

static void prv_inbox_dropped(AppMessageResult reason, void *context) {
  APP_LOG(APP_LOG_LEVEL_WARNING, "AppMessage dropped: %d", (int)reason);
}

// ---------------------------------------------------------------------------
// Window lifecycle
// ---------------------------------------------------------------------------
static void prv_window_load(Window *window) {
  Layer *root = window_get_root_layer(window);

  s_font_grotesk_72 = fonts_load_custom_font(resource_get_handle(RESOURCE_ID_SPACE_GROTESK_72));
  s_font_grotesk_24 = fonts_load_custom_font(resource_get_handle(RESOURCE_ID_SPACE_GROTESK_24));
  s_font_grotesk_22 = fonts_load_custom_font(resource_get_handle(RESOURCE_ID_SPACE_GROTESK_22));
  s_font_mono_18    = fonts_load_custom_font(resource_get_handle(RESOURCE_ID_SPACE_MONO_18));
  s_font_mono_14    = fonts_load_custom_font(resource_get_handle(RESOURCE_ID_SPACE_MONO_14));
  s_font_mono_13    = fonts_load_custom_font(resource_get_handle(RESOURCE_ID_SPACE_MONO_13));

  // Weekday
  s_weekday_layer = text_layer_create(GRect(SAFE_L, WEEKDAY_Y, 100, WEEKDAY_H));
  text_layer_set_font(s_weekday_layer, s_font_mono_13);
  text_layer_set_background_color(s_weekday_layer, GColorClear);
  layer_add_child(root, text_layer_get_layer(s_weekday_layer));

  // Date
  s_date_layer = text_layer_create(GRect(SAFE_L, DATE_Y, 130, DATE_H));
  text_layer_set_font(s_date_layer, s_font_mono_18);
  text_layer_set_background_color(s_date_layer, GColorClear);
  layer_add_child(root, text_layer_get_layer(s_date_layer));

  // Weather icon
  s_weather_icon_layer = layer_create(GRect(WX_ICON_X, WX_ICON_Y, WX_ICON_W, WX_ICON_H));
  layer_set_update_proc(s_weather_icon_layer, weather_icon_update_proc);
  layer_add_child(root, s_weather_icon_layer);

  // Weather temp
  strncpy(s_weather_temp_buf, "--", sizeof(s_weather_temp_buf));
  s_weather_temp_layer = text_layer_create(GRect(WX_TEMP_X, WX_TEMP_Y, WX_TEMP_W, WX_TEMP_H));
  text_layer_set_font(s_weather_temp_layer, s_font_grotesk_24);
  text_layer_set_background_color(s_weather_temp_layer, GColorClear);
  text_layer_set_text(s_weather_temp_layer, s_weather_temp_buf);
  layer_add_child(root, text_layer_get_layer(s_weather_temp_layer));

  // Main time
  strncpy(s_hours_buf,   "--", sizeof(s_hours_buf));
  strncpy(s_minutes_buf, "--", sizeof(s_minutes_buf));
  s_time_layer = layer_create(GRect(0, TIME_Y, 200, TIME_H));
  layer_set_update_proc(s_time_layer, time_layer_update_proc);
  layer_add_child(root, s_time_layer);

  // Footer chrome
  s_chrome_layer = layer_create(GRect(0, HAIRLINE_Y, 200, CHROME_H));
  layer_set_update_proc(s_chrome_layer, chrome_update_proc);
  layer_add_child(root, s_chrome_layer);

  // DUBLIN label
  s_dublin_label_layer = text_layer_create(
    GRect(FOOTER_LABEL_X, FOOTER_LABEL_Y, 80, FOOTER_LABEL_H));
  text_layer_set_font(s_dublin_label_layer, s_font_mono_14);
  text_layer_set_background_color(s_dublin_label_layer, GColorClear);
  text_layer_set_text(s_dublin_label_layer, "DUBLIN");
  layer_add_child(root, text_layer_get_layer(s_dublin_label_layer));

  // Dublin time
  s_dublin_time_layer = text_layer_create(
    GRect(FOOTER_TIME_X, FOOTER_TIME_Y, FOOTER_TIME_W, FOOTER_TIME_H));
  text_layer_set_font(s_dublin_time_layer, s_font_grotesk_22);
  text_layer_set_background_color(s_dublin_time_layer, GColorClear);
  text_layer_set_text_alignment(s_dublin_time_layer, GTextAlignmentRight);
  layer_add_child(root, text_layer_get_layer(s_dublin_time_layer));

  // Apply saved theme, then populate text
  apply_theme();
  time_t utc = time(NULL);
  update_display(localtime(&utc), utc);
}

static void prv_window_unload(Window *window) {
  text_layer_destroy(s_weekday_layer);
  text_layer_destroy(s_date_layer);
  layer_destroy(s_weather_icon_layer);
  text_layer_destroy(s_weather_temp_layer);
  layer_destroy(s_time_layer);
  layer_destroy(s_chrome_layer);
  text_layer_destroy(s_dublin_label_layer);
  text_layer_destroy(s_dublin_time_layer);

  fonts_unload_custom_font(s_font_grotesk_72);
  fonts_unload_custom_font(s_font_grotesk_24);
  fonts_unload_custom_font(s_font_grotesk_22);
  fonts_unload_custom_font(s_font_mono_18);
  fonts_unload_custom_font(s_font_mono_14);
  fonts_unload_custom_font(s_font_mono_13);
}

// ---------------------------------------------------------------------------
// App lifecycle
// ---------------------------------------------------------------------------
static void prv_init(void) {
  // Restore saved theme preference
  if (persist_exists(PERSIST_KEY_INVERTED)) {
    s_inverted = persist_read_bool(PERSIST_KEY_INVERTED);
  }

  s_window = window_create();
  window_set_click_config_provider(s_window, click_config_provider);
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
