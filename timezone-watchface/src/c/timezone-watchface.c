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
// UI state
// ---------------------------------------------------------------------------
static Window *s_window;
static TextLayer *s_time_layer;
static TextLayer *s_date_layer;
static Layer *s_separator_layer;
static TextLayer *s_tz_label_layers[NUM_EXTRA_TZ];
static TextLayer *s_tz_time_layers[NUM_EXTRA_TZ];

static char s_time_buf[8];                       // "HH:MM\0"
static char s_date_buf[20];                      // "Mon, 31 May\0"
static char s_tz_time_bufs[NUM_EXTRA_TZ][8];    // one "HH:MM\0" per zone

// ---------------------------------------------------------------------------
// Drawing
// ---------------------------------------------------------------------------
static void separator_update_proc(Layer *layer, GContext *ctx) {
  GRect bounds = layer_get_bounds(layer);
  graphics_context_set_stroke_color(ctx, PBL_IF_COLOR_ELSE(GColorDarkGray, GColorWhite));
  graphics_draw_line(ctx, GPoint(8, 0), GPoint(bounds.size.w - 8, 0));
}

static void update_display(struct tm *local_tm, time_t utc) {
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

// ---------------------------------------------------------------------------
// Tick handler — fires every minute
// ---------------------------------------------------------------------------
static void tick_handler(struct tm *tick_time, TimeUnits units_changed) {
  update_display(tick_time, time(NULL));
}

// ---------------------------------------------------------------------------
// Window lifecycle
// ---------------------------------------------------------------------------
static void prv_window_load(Window *window) {
  Layer *root = window_get_root_layer(window);
  GRect bounds = layer_get_bounds(root);
  const int16_t w = bounds.size.w;

  window_set_background_color(window, GColorBlack);

  // Large local time — centred, top third of screen
  s_time_layer = text_layer_create(GRect(0, 10, w, 52));
  text_layer_set_font(s_time_layer, fonts_get_system_font(FONT_KEY_BITHAM_42_BOLD));
  text_layer_set_text_alignment(s_time_layer, GTextAlignmentCenter);
  text_layer_set_background_color(s_time_layer, GColorClear);
  text_layer_set_text_color(s_time_layer, GColorWhite);
  layer_add_child(root, text_layer_get_layer(s_time_layer));

  // Date line directly beneath the time
  s_date_layer = text_layer_create(GRect(0, 62, w, 22));
  text_layer_set_font(s_date_layer, fonts_get_system_font(FONT_KEY_GOTHIC_18_BOLD));
  text_layer_set_text_alignment(s_date_layer, GTextAlignmentCenter);
  text_layer_set_background_color(s_date_layer, GColorClear);
  text_layer_set_text_color(s_date_layer, PBL_IF_COLOR_ELSE(GColorLightGray, GColorWhite));
  layer_add_child(root, text_layer_get_layer(s_date_layer));

  // Horizontal separator between local and world times
  s_separator_layer = layer_create(GRect(0, 88, w, 2));
  layer_set_update_proc(s_separator_layer, separator_update_proc);
  layer_add_child(root, s_separator_layer);

  // Extra timezone rows — label on the left, time on the right
  for (int i = 0; i < NUM_EXTRA_TZ; i++) {
    const int16_t y = 92 + (int16_t)(i * 26);

    s_tz_label_layers[i] = text_layer_create(GRect(8, y, 48, 22));
    text_layer_set_font(s_tz_label_layers[i], fonts_get_system_font(FONT_KEY_GOTHIC_18_BOLD));
    text_layer_set_background_color(s_tz_label_layers[i], GColorClear);
    text_layer_set_text_color(s_tz_label_layers[i], PBL_IF_COLOR_ELSE(GColorDarkGray, GColorWhite));
    text_layer_set_text(s_tz_label_layers[i], EXTRA_TIMEZONES[i].label);
    layer_add_child(root, text_layer_get_layer(s_tz_label_layers[i]));

    s_tz_time_layers[i] = text_layer_create(GRect(56, y, w - 64, 22));
    text_layer_set_font(s_tz_time_layers[i], fonts_get_system_font(FONT_KEY_GOTHIC_18_BOLD));
    text_layer_set_background_color(s_tz_time_layers[i], GColorClear);
    text_layer_set_text_color(s_tz_time_layers[i], GColorWhite);
    text_layer_set_text_alignment(s_tz_time_layers[i], GTextAlignmentRight);
    layer_add_child(root, text_layer_get_layer(s_tz_time_layers[i]));
  }

  // Populate all text layers immediately so the face isn't blank on launch
  time_t utc = time(NULL);
  struct tm *local_tm = localtime(&utc);
  update_display(local_tm, utc);
}

static void prv_window_unload(Window *window) {
  text_layer_destroy(s_time_layer);
  text_layer_destroy(s_date_layer);
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
