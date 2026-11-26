#include "theme.h"
#include "persist.h"

// ---------------------------------------------------------------------------
// Theme.
//
// Two settings — a dark/light flip and an accent colour — held here rather than
// passed around, because every window needs them and none of them owns them.
// Both are persisted the moment they arrive: an app is launched and killed
// constantly, and a first frame drawn in the wrong colours before the phone
// answers would be a flicker on every single launch.
// ---------------------------------------------------------------------------

static bool   s_inverted = false;   // false = dark, matching the config default
static GColor s_accent;

void theme_load(void) {
  s_inverted = persist_exists(PERSIST_THEME) ? persist_read_bool(PERSIST_THEME) : false;

  int hex = persist_exists(PERSIST_ACCENT) ? persist_read_int(PERSIST_ACCENT)
                                           : ACCENT_DEFAULT_HEX;
  s_accent = GColorFromHEX(hex);
}

void theme_set_inverted(bool inverted) {
  s_inverted = inverted;
  persist_write_bool(PERSIST_THEME, inverted);
}

void theme_set_accent_hex(int hex) {
  s_accent = GColorFromHEX(hex);
  persist_write_int(PERSIST_ACCENT, hex);
}

bool theme_inverted(void) {
  return s_inverted;
}

GColor theme_accent(void) {
  return s_accent;
}

GColor theme_bg(void) {
  return s_inverted ? GColorWhite : GColorBlack;
}

GColor theme_fg(void) {
  return s_inverted ? GColorBlack : GColorWhite;
}

GColor theme_muted(void) {
  return s_inverted ? GColorDarkGray : GColorLightGray;
}

GColor theme_hairline(void) {
  return s_inverted ? GColorLightGray : GColorDarkGray;
}
