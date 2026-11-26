#pragma once

#include <pebble.h>

// Default accent, used until the phone sends one. 0x00AAFF is the exact RGB of
// GColorVividCerulean. Keep in step with DEFAULT_ACCENT in src/pkjs/accent.js.
#define ACCENT_DEFAULT_HEX 0x00AAFF

/** Restore the theme from persistent storage. Call once, before any window. */
void theme_load(void);

void theme_set_inverted(bool inverted);
void theme_set_accent_hex(int hex);

bool theme_inverted(void);

// The palette. Every window draws from these rather than naming colours, so
// that the light theme is one decision rather than one per screen.
GColor theme_accent(void);
GColor theme_bg(void);
GColor theme_fg(void);
GColor theme_muted(void);
GColor theme_hairline(void);
