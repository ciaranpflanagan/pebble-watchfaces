# timezone-watchface

A Pebble watchface written in C that displays your local time alongside three
configurable world clocks.

## Layout

```
        12:34
    Mon, 31 May
  ─────────────────
  UTC          19:34
  DUB          20:34
  NYC          15:34
```

- **Large time** — your local time as set on the Pebble
- **Date** — day and short date beneath the local clock
- **World clocks** — UTC, Dublin/London, and New York by default

## Customising timezones

Edit the `EXTRA_TIMEZONES` array near the top of `src/c/timezone-watchface.c`:

```c
static const Timezone EXTRA_TIMEZONES[NUM_EXTRA_TZ] = {
  { "UTC",    0 },   // Coordinated Universal Time
  { "DUB",   60 },   // Dublin / London — BST (UTC+1)
  { "NYC", -240 },   // New York — EDT (UTC-4)
};
```

Change the label (up to ~4 characters fits neatly) and the UTC offset in
minutes. `NUM_EXTRA_TZ` controls how many rows are shown (default 3).

### DST caveat

Pebble has no timezone database, so DST is **not** applied automatically.
Update the offsets by hand when clocks change:

| Zone          | Summer             | Winter             |
|---------------|--------------------|--------------------|
| Dublin/London | `60` (BST, UTC+1)  | `0` (GMT, UTC+0)   |
| New York      | `-240` (EDT, UTC-4)| `-300` (EST, UTC-5)|

## Building & running

```sh
cd timezone-watchface
pebble build                          # build for all targetPlatforms
pebble install --emulator emery       # install on the emery emulator
pebble install --phone <ip>           # sideload to a paired phone
```

## Target platforms

`targetPlatforms` in `package.json` controls which watches are built for.
Modern hardware: **emery** (Pebble Time 2), **gabbro** (Pebble Round 2),
**flint** (Pebble 2 Duo). Legacy platforms (aplite, basalt, chalk, diorite)
are included for backwards compatibility.

The face uses `PBL_IF_COLOR_ELSE` to render correctly on both colour and
black-and-white (aplite) displays.

## Documentation

Full SDK docs and API reference: <https://developer.repebble.com>
