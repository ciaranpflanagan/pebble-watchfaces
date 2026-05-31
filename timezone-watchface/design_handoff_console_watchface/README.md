# Handoff: Console Watchface (Pebble Time 2)

## Overview
A clean, high-contrast watchface for the **Pebble Time 2** (200 × 228 px, 64-color e-paper).
It shows, in priority order:
1. **Current time** (home zone, Seattle) — large 24-hour numerals, the dominant element.
2. **Date** — weekday, day, month (top-left).
3. **Weather** — temperature + condition icon (top-right).
4. **Second timezone** — Dublin, 24-hour (pinned footer).

"Console" direction = dark background, structured grid, hairline rules dividing header / time / second-zone.

## About the Design Files
The files in this bundle are **design references created in HTML/React** — a 1:1 prototype of the
intended look and behavior, **not** production code to copy. Your task is to **recreate this design in
your existing Pebble project** using its established patterns — the C SDK (TextLayer / Layer + GContext
drawing) or Rocky.js (JS + Canvas), whichever your project already uses.

> **The prototype is rendered at the true panel resolution (200 × 228).** Every pixel value in this doc
> is therefore a **real device pixel** — no scaling math needed. Top-left of the screen is (0, 0).

## Fidelity
**High-fidelity.** Colors, type sizes, spacing, and layout are final. Recreate it pixel-accurately,
subject only to the e-paper palette constraint noted under Design Tokens.

---

## Screen: Console Watchface

### Canvas
- **Size:** 200 (w) × 228 (h) px, origin top-left.
- **Background:** solid black `#000000` → `GColorBlack`.
- **Safe padding:** 16px left, 16px right, 16px top, 14px bottom. All content lives inside this box
  (content width = 168px, x-range 16–184).

### Layout (three vertical zones)
```
┌───────────────────────────── 200px ─────────────────┐
│ (pad 16)                                              │
│  SUN                        ☀☁  54°    ← HEADER       │
│  31 MAY                                               │
│                                                       │
│                                                       │
│            10:18              ← TIME (centered)       │
│                                                       │
│                                                       │
│  ─────────────────────────────────  ← hairline rule  │
│  ● DUBLIN                    18:18    ← FOOTER         │
│ (pad 14)                                              │
└───────────────────────────────────────────────────────┘
```
- **HEADER** is pinned to the top padding line (y ≈ 16).
- **TIME** is centered both horizontally and vertically in the space between header and footer
  (vertical center ≈ y 112).
- **FOOTER** is pinned to the bottom padding line.

### Components

**1. Weekday label** (header, top-left)
- Text: `SUN` (3-letter weekday, uppercase)
- Font: **Space Mono**, 10px
- Letter-spacing: +2px (Pebble: bake tracking into the font or add manual kerning; small bitmap fonts
  often can't letter-space, so this is a nice-to-have)
- Color: gray `#7C7C7C`
- Position: x = 16, y ≈ 16

**2. Date label** (header, top-left, below weekday)
- Text: `31 MAY` (day with leading zero + 3-letter month, uppercase)
- Font: **Space Mono**, 14px
- Letter-spacing: +1px
- Color: white `#FFFFFF`
- Position: x = 16, y ≈ 30 (2px gap under weekday)

**3. Weather group** (header, top-right, right-aligned to x = 184)
- **Icon** — partly-cloudy glyph, 26 × 26px (see Assets). Sits left of the temp, 6px gap.
- **Temperature** — text `54°`, Font: **Space Grotesk**, 20px, weight **600** (SemiBold), white.
- Vertically centered against the icon. Group baseline ≈ y 16–42.

**4. Main time** (center)
- Text: `10:18` — `HH:MM`, 24-hour, leading-zero hour.
- Font: **Space Grotesk**, **62px**, weight **600** (SemiBold)
- Letter-spacing: −1px; line-height 1.0
- **Tabular figures** — use the font's tabular/monospaced numerals so digits don't shift as the time
  ticks (critical for a watchface).
- Colors: digits white `#FFFFFF`; **the colon `:` is accent orange** `#FF5630`.
- Centered horizontally; vertical center of the header↔footer band (≈ y 112).

**5. Hairline rule** (above footer)
- 1px horizontal line, full content width (x 16 → 184)
- Color: `#2A2A2A` (very dark gray — visible but quiet on black)
- Position: y ≈ 179, with 10px gap below it before the footer row.

**6. Footer / second timezone**
- **Accent dot** — filled circle, 7px diameter, color `#FF5630`. x = 16, vertically centered in row.
- **Zone label** — text `DUBLIN`, Font: **Space Mono**, 11px, letter-spacing +2px, gray `#9A9A9A`.
  7px to the right of the dot.
- **Zone time** — text `18:18` (`HH:MM`, 24h), right-aligned to x = 184. Font: **Space Grotesk**,
  19px, weight **500** (Medium), tabular figures, white.
- Footer row vertically centered ≈ y 190.

---

## Interactions & Behavior
A watchface has minimal interaction; the "behavior" is keeping data live and cheap to redraw.

- **Time tick:** subscribe to the minute tick (`tick_timer_service_subscribe(MINUTE_UNIT, …)` in C, or
  the equivalent Rocky `minutechange` event). Redraw `HH:MM` for both zones and the date on each tick.
- **No animations, no transitions, no taps.** Keep it static for battery — e-paper + minute redraws only.
- **Backlight:** default system behavior; no custom handling needed.

## Data / State
Three pieces of live data:

1. **Home time (Seattle):** local time in `America/Los_Angeles`, 24-hour. If the watch is set to this
   timezone, just read local time. If not, treat it like the second zone below.

2. **Second time (Dublin):** `Europe/Dublin`, 24-hour. ⚠️ **Timezone gotcha:** the C SDK has no general
   tz database for arbitrary cities, and DST changes the offset (Dublin is UTC+1 in summer, UTC+0 in
   winter). Recommended approaches, in order of robustness:
   - **PebbleKit JS (preferred):** in the companion JS, compute the offset with the phone's
     `Intl.DateTimeFormat(..., { timeZone: 'Europe/Dublin' })`, send it to the watch via `AppMessage`,
     and re-send on DST changes / app launch. Watch applies offset to UTC (`time(NULL)`).
   - **Manual offset:** store a fixed UTC offset in settings; simplest but you (or the user) must adjust
     it twice a year.
   The prototype uses the browser's `Intl` with `timeZone: 'Europe/Dublin'`, which auto-handles DST —
   mirror that in the companion JS.

3. **Weather (temp + condition):** fetch on the phone via **PebbleKit JS** (e.g. OpenWeather or similar),
   send `temp` (int) and a `condition` enum to the watch via `AppMessage`, refresh every ~30 min and on
   launch. The prototype value (`54°`, partly-cloudy) is a **static placeholder** — wire it to your feed.
   Pick the temperature unit (°F shown) to match the user's locale setting.

---

## Design Tokens

### Colors
| Token            | Hex       | Usage                              | Nearest Pebble `GColor` (64-color) |
|------------------|-----------|------------------------------------|------------------------------------|
| Background       | `#000000` | screen background                  | `GColorBlack`                      |
| Primary text     | `#FFFFFF` | time, date, temp, Dublin time      | `GColorWhite`                      |
| Muted label      | `#7C7C7C` | weekday                            | `#AAAAAA` `GColorLightGray` (snap) |
| Muted label 2    | `#9A9A9A` | DUBLIN label                       | `#AAAAAA` `GColorLightGray`        |
| Hairline rule    | `#2A2A2A` | divider above footer               | `#555555` `GColorDarkGray` (snap)  |
| **Accent**       | `#FF5630` | time colon, footer dot             | `GColorOrange` `#FF5500` or `GColorSunsetOrange` `#FF5555` |

> **64-color constraint:** each RGB channel is 2-bit (only values 0, 85, 170, 255). Off-grid colors are
> snapped at build time. The grays (`#7C7C7C`, `#9A9A9A`, `#2A2A2A`) will snap toward `GColorLightGray`/
> `GColorDarkGray`; verify they still read as "quiet" on-device. For the accent, test both `GColorOrange`
> and `GColorSunsetOrange` and pick the warmer match to `#FF5630`.

### Typography
Two custom fonts must be bundled (the system Pebble font won't match). Add the TTFs to your project's
resources and declare each **size** you need (Pebble rasterizes a bitmap per size at build time).

| Role          | Family         | Size | Weight        |
|---------------|----------------|------|---------------|
| Main time     | Space Grotesk  | 62px | 600 SemiBold  |
| Temp          | Space Grotesk  | 20px | 600 SemiBold  |
| Dublin time   | Space Grotesk  | 19px | 500 Medium    |
| Date          | Space Mono     | 14px | 400 Regular   |
| DUBLIN label  | Space Mono     | 11px | 400 Regular   |
| Weekday       | Space Mono     | 10px | 400 Regular   |

- Fonts: **Space Grotesk** & **Space Mono** (both SIL Open Font License, free to embed) —
  https://fonts.google.com/specimen/Space+Grotesk · https://fonts.google.com/specimen/Space+Mono
- In `package.json` resources, add a `font` entry per size, e.g.
  `RESOURCE_ID_SPACE_GROTESK_62`, `..._20`, `..._19`, `RESOURCE_ID_SPACE_MONO_14`, `..._11`, `..._10`.
- **Tabular numerals:** Space Grotesk's digits are near-monospaced; if any digit jitter appears at minute
  ticks, generate the font with the tabular-figures feature applied, or right-align each numeral field.

### Spacing
- Screen padding: 16 (top/L/R), 14 (bottom)
- Weekday → date gap: 2px
- Icon → temp gap: 6px
- Dot → label gap: 7px
- Rule → footer gap: 10px
- Dot diameter: 7px

---

## Assets

**Weather icon — partly cloudy, 26 × 26px.** In the prototype it's built from primitive shapes, so you
can either **draw it with graphics primitives** or **bundle it as a PDC/PNG**.

Geometry (on a 100 × 100 grid, scale to 26px — multiply by 0.26):
- **Sun:** filled circle, center (36, 34), radius 14, color = accent orange.
- **Sun rays:** 8 short lines radiating from (36, 34) at 0/45/90/…/315°, from radius 20 to 27,
  ~5px stroke, rounded caps, accent orange.
- **Cloud (overlapping, drawn on top of sun):** in white —
  - rounded rect: x 30, y 58, w 56, h 26, corner radius 13
  - circle: center (48, 58), radius 16
  - circle: center (70, 60), radius 13

In C, use `graphics_fill_circle`, `graphics_draw_line` (or filled thin rects), and
`graphics_fill_rect` with `GCornerRadius`. Or export a 26px PDC and place it with `gdraw_command_*`.
If your weather feed has multiple conditions, build the matching simple glyphs (sun, cloud, rain) in the
same flat style.

---

## Files in this bundle
- `Pebble Time 2 Watchface.html` — the prototype. Open in a browser to see all three directions live.
- `watchfaces.jsx` — the React source. **The Console face is the `FaceConsole` component** — this is the
  one to implement. (`FaceStack` / `FacePaper` are the other two directions, ignore them.)
- `preview.png` — screenshot of all three (Console is the left one).

The `FaceConsole` component is the single source of truth for exact values; this README transcribes them.
