#include <pebble.h>

// ---------------------------------------------------------------------------
// Timezone configuration
//
// Offsets are from UTC in minutes. Pebble has no timezone database, so DST
// is NOT applied automatically — update these offsets when clocks change:
//   Summer: DUB = +60 (BST),  NYC = -240 (EDT)
//   Winter: DUB =   0 (GMT),  NYC = -300 (EST)
// ---------------------------------------------------------------------------
#define NUM_EXTRA_TZ 3

typedef struct {
  const char *label;
  int utc_offset_minutes;
} Timezone;

static const Timezone EXTRA_TIMEZONES[NUM_EXTRA_TZ] = {
  { "UTC",    0 },   // Coordinated Universal Time
  { "DUB",   60 },   // Dublin / London — BST (UTC+1); change to 0 in winter
  { "NYC", -240 },   // New York — EDT (UTC-4); change to -300 in winter
};

// ---------------------------------------------------------------------------
// Weather icon types
// Integer values must match the ICON_* constants in src/pkjs/index.js
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

static WeatherIconType s_weather_icon_type = ICON_UNKNOWN;

// ---------------------------------------------------------------------------
// UI state
// ---------------------------------------------------------------------------
static Window *s_window;
static TextLayer *s_time_layer;
static TextLayer *s_date_layer;
static Layer *s_weather_icon_layer;
static TextLayer *s_weather_temp_layer;
static Layer *s_separator_layer;
static TextLayer *s_tz_label_layers[NUM_EXTRA_TZ];
static TextLayer *s_tz_time_layers[NUM_EXTRA_TZ];

// Text buffers — must outlive each text_layer_set_text call
static char s_time_buf[8];
static char s_date_buf[20];
static char s_weather_temp_buf[16];
static char s_tz_time_bufs[NUM_EXTRA_TZ][8];

// ---------------------------------------------------------------------------
// Icon drawing — all icons fit in a 20×20 px layer
// ---------------------------------------------------------------------------

// Sun: circle + 8 short rays
static void draw_clear(GContext *ctx) {
  graphics_draw_circle(ctx, GPoint(10, 10), 4);
  // Cardinal rays (from r=6 to r=9)
  graphics_draw_line(ctx, GPoint(10, 4),  GPoint(10, 1));
  graphics_draw_line(ctx, GPoint(10, 16), GPoint(10, 19));
  graphics_draw_line(ctx, GPoint(4,  10), GPoint(1,  10));
  graphics_draw_line(ctx, GPoint(16, 10), GPoint(19, 10));
  // Diagonal rays (45° offsets, from r≈6 to r≈9)
  graphics_draw_line(ctx, GPoint(14, 6),  GPoint(16, 4));
  graphics_draw_line(ctx, GPoint(6,  6),  GPoint(4,  4));
  graphics_draw_line(ctx, GPoint(14, 14), GPoint(16, 16));
  graphics_draw_line(ctx, GPoint(6,  14), GPoint(4,  16));
}

// Cloud: two filled circles (puffs) + filled rounded rect (base)
static void draw_cloud(GContext *ctx) {
  graphics_fill_circle(ctx, GPoint(7,  10), 5);
  graphics_fill_circle(ctx, GPoint(13,  8), 6);
  graphics_fill_rect(ctx, GRect(2, 12, 16, 6), 3, GCornersBottom);
}

// Fog: three horizontal dashes
static void draw_fog(GContext *ctx) {
  graphics_draw_line(ctx, GPoint(2, 5),  GPoint(18, 5));
  graphics_draw_line(ctx, GPoint(2, 10), GPoint(18, 10));
  graphics_draw_line(ctx, GPoint(2, 15), GPoint(18, 15));
}

// Rain: small cloud + three diagonal rain lines
static void draw_rain(GContext *ctx) {
  graphics_fill_circle(ctx, GPoint(7,  7), 4);
  graphics_fill_circle(ctx, GPoint(13, 5), 4);
  graphics_fill_rect(ctx, GRect(3, 8, 14, 4), 2, GCornersBottom);
  graphics_draw_line(ctx, GPoint(5,  13), GPoint(3,  19));
  graphics_draw_line(ctx, GPoint(10, 13), GPoint(8,  19));
  graphics_draw_line(ctx, GPoint(15, 13), GPoint(13, 19));
}

// Snow: 6-pointed snowflake (3 lines through centre at 0°, 60°, 120°)
static void draw_snow(GContext *ctx) {
  graphics_draw_line(ctx, GPoint(10, 2), GPoint(10, 18));  // vertical
  graphics_draw_line(ctx, GPoint(3, 14), GPoint(17, 6));   // 60°
  graphics_draw_line(ctx, GPoint(3,  6), GPoint(17, 14));  // 120°
}

// Storm: lightning bolt zigzag
static void draw_storm(GContext *ctx) {
  graphics_draw_line(ctx, GPoint(13, 1),  GPoint(7,  10));
  graphics_draw_line(ctx, GPoint(7,  10), GPoint(12, 10));
  graphics_draw_line(ctx, GPoint(12, 10), GPoint(6,  19));
}

static void weather_icon_update_proc(Layer *layer, GContext *ctx) {
  graphics_context_set_stroke_color(ctx, GColorWhite);
  graphics_context_set_fill_color(ctx, GColorWhite);
  graphics_context_set_stroke_width(ctx, 1);

  switch (s_weather_icon_type) {
    case ICON_CLEAR:  draw_clear(ctx); break;
    case ICON_CLOUDY: draw_cloud(ctx); break;
    case ICON_FOG:    draw_fog(ctx);   break;
    case ICON_RAIN:   draw_rain(ctx);  break;
    case ICON_SNOW:   draw_snow(ctx);  break;
    case ICON_STORM:  draw_storm(ctx); break;
    case ICON_UNKNOWN:
    default: break;  // blank whilst loading
  }
}

// ---------------------------------------------------------------------------
// Separator line drawing
// ---------------------------------------------------------------------------
static void separator_update_proc(Layer *layer, GContext *ctx) {
  GRect bounds = layer_get_bounds(layer);
  graphics_context_set_stroke_color(ctx, PBL_IF_COLOR_ELSE(GColorDarkGray, GColorWhite));
  graphics_draw_line(ctx, GPoint(8, 0), GPoint(bounds.size.w - 8, 0));
}

// ---------------------------------------------------------------------------
// Clock update (tick handler target)
// ---------------------------------------------------------------------------
static void update_clock(struct tm *local_tm, time_t utc) {
  strftime(s_time_buf, sizeof(s_time_buf), "%H:%M", local_tm);
  text_layer_set_text(s_time_layer, s_time_buf);

  strftime(s_date_buf, sizeof(s_date_buf), "%a, %d %b", local_tm);
  text_layer_set_text(s_date_layer, s_date_buf);

  for (int i = 0; i < NUM_EXTRA_TZ; i++) {
    time_t adjusted = utc + (time_t)(EXTRA_TIMEZONES[i].utc_offset_minutes * 60);
    struct tm *tz_tm = gmtime(&adjusted);
    strftime(s_tz_time_bufs[i], sizeof(s_tz_time_bufs[i]), "%H:%M", tz_tm);
    text_layer_set_text(s_tz_time_layers[i], s_tz_time_bufs[i]);
  }
}

static void tick_handler(struct tm *tick_time, TimeUnits units_changed) {
  update_clock(tick_time, time(NULL));
}

// ---------------------------------------------------------------------------
// AppMessage handler — receives weather from the phone
// ---------------------------------------------------------------------------
static void prv_inbox_received(DictionaryIterator *iter, void *context) {
  Tuple *temp_t = dict_find(iter, MESSAGE_KEY_WEATHER_TEMP);
  Tuple *icon_t = dict_find(iter, MESSAGE_KEY_WEATHER_ICON);

  if (temp_t) {
    // \xc2\xb0 is the UTF-8 degree sign (°)
    snprintf(s_weather_temp_buf, sizeof(s_weather_temp_buf),
             "%d\xc2\xb0""C", (int)temp_t->value->int32);
    text_layer_set_text(s_weather_temp_layer, s_weather_temp_buf);
  }

  if (icon_t) {
    s_weather_icon_type = (WeatherIconType)icon_t->value->int32;
    layer_mark_dirty(s_weather_icon_layer);
  }
}

static void prv_inbox_dropped(AppMessageResult reason, void *context) {
  APP_LOG(APP_LOG_LEVEL_WARNING, "AppMessage dropped, reason: %d", (int)reason);
}

// ---------------------------------------------------------------------------
// Window lifecycle
// ---------------------------------------------------------------------------
static void prv_window_load(Window *window) {
  Layer *root = window_get_root_layer(window);
  GRect bounds = layer_get_bounds(root);
  const int16_t w = bounds.size.w;

  window_set_background_color(window, GColorBlack);

  // ── Local time ─────────────────────────────────────────────────────────────
  // Layout (144×168): time y=4..54, date y=56..76, weather y=78..98,
  //   separator y=100, tz rows y=104/126/148..168
  s_time_layer = text_layer_create(GRect(0, 4, w, 50));
  text_layer_set_font(s_time_layer, fonts_get_system_font(FONT_KEY_BITHAM_42_BOLD));
  text_layer_set_text_alignment(s_time_layer, GTextAlignmentCenter);
  text_layer_set_background_color(s_time_layer, GColorClear);
  text_layer_set_text_color(s_time_layer, GColorWhite);
  layer_add_child(root, text_layer_get_layer(s_time_layer));

  // ── Date ───────────────────────────────────────────────────────────────────
  s_date_layer = text_layer_create(GRect(0, 56, w, 20));
  text_layer_set_font(s_date_layer, fonts_get_system_font(FONT_KEY_GOTHIC_18_BOLD));
  text_layer_set_text_alignment(s_date_layer, GTextAlignmentCenter);
  text_layer_set_background_color(s_date_layer, GColorClear);
  text_layer_set_text_color(s_date_layer, PBL_IF_COLOR_ELSE(GColorLightGray, GColorWhite));
  layer_add_child(root, text_layer_get_layer(s_date_layer));

  // ── Weather: icon (custom layer) + temperature (text), centred as a pair ──
  // Group: 20px icon + 6px gap + 50px temp text = 76px total
  const int16_t icon_w = 20;
  const int16_t temp_w = 50;
  const int16_t weather_gap = 6;
  const int16_t group_x = (w - icon_w - weather_gap - temp_w) / 2;

  s_weather_icon_layer = layer_create(GRect(group_x, 78, icon_w, 20));
  layer_set_update_proc(s_weather_icon_layer, weather_icon_update_proc);
  layer_add_child(root, s_weather_icon_layer);

  strncpy(s_weather_temp_buf, "--", sizeof(s_weather_temp_buf));
  s_weather_temp_layer = text_layer_create(
    GRect(group_x + icon_w + weather_gap, 78, temp_w, 20));
  text_layer_set_font(s_weather_temp_layer, fonts_get_system_font(FONT_KEY_GOTHIC_18_BOLD));
  text_layer_set_background_color(s_weather_temp_layer, GColorClear);
  text_layer_set_text_color(s_weather_temp_layer, GColorWhite);
  text_layer_set_text(s_weather_temp_layer, s_weather_temp_buf);
  layer_add_child(root, text_layer_get_layer(s_weather_temp_layer));

  // ── Separator ──────────────────────────────────────────────────────────────
  s_separator_layer = layer_create(GRect(0, 100, w, 2));
  layer_set_update_proc(s_separator_layer, separator_update_proc);
  layer_add_child(root, s_separator_layer);

  // ── Extra timezone rows ────────────────────────────────────────────────────
  for (int i = 0; i < NUM_EXTRA_TZ; i++) {
    const int16_t y = 104 + (int16_t)(i * 22);

    s_tz_label_layers[i] = text_layer_create(GRect(8, y, 48, 20));
    text_layer_set_font(s_tz_label_layers[i], fonts_get_system_font(FONT_KEY_GOTHIC_18_BOLD));
    text_layer_set_background_color(s_tz_label_layers[i], GColorClear);
    text_layer_set_text_color(s_tz_label_layers[i], PBL_IF_COLOR_ELSE(GColorDarkGray, GColorWhite));
    text_layer_set_text(s_tz_label_layers[i], EXTRA_TIMEZONES[i].label);
    layer_add_child(root, text_layer_get_layer(s_tz_label_layers[i]));

    s_tz_time_layers[i] = text_layer_create(GRect(56, y, w - 64, 20));
    text_layer_set_font(s_tz_time_layers[i], fonts_get_system_font(FONT_KEY_GOTHIC_18_BOLD));
    text_layer_set_background_color(s_tz_time_layers[i], GColorClear);
    text_layer_set_text_color(s_tz_time_layers[i], GColorWhite);
    text_layer_set_text_alignment(s_tz_time_layers[i], GTextAlignmentRight);
    layer_add_child(root, text_layer_get_layer(s_tz_time_layers[i]));
  }

  // Populate clock layers immediately so the face isn't blank on launch
  time_t utc = time(NULL);
  struct tm *local_tm = localtime(&utc);
  update_clock(local_tm, utc);
}

static void prv_window_unload(Window *window) {
  text_layer_destroy(s_time_layer);
  text_layer_destroy(s_date_layer);
  layer_destroy(s_weather_icon_layer);
  text_layer_destroy(s_weather_temp_layer);
  layer_destroy(s_separator_layer);
  for (int i = 0; i < NUM_EXTRA_TZ; i++) {
    text_layer_destroy(s_tz_label_layers[i]);
    text_layer_destroy(s_tz_time_layers[i]);
  }
}

// ---------------------------------------------------------------------------
// App lifecycle
// ---------------------------------------------------------------------------
static void prv_init(void) {
  s_window = window_create();
  window_set_window_handlers(s_window, (WindowHandlers) {
    .load = prv_window_load,
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
