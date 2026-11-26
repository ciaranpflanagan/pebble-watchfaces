# Pebble Watchfaces

A collection of watchfaces for Pebble watches, written in C with a little
JavaScript on the phone side. Each folder is a standalone Pebble project with
its own README.

| Folder | Watchface | What it shows | Status |
|--------|-----------|---------------|--------|
| [`console-watchface`](console-watchface) | **Homezone** | Console-styled face: time, date, weather and a configurable bottom row (second timezone, steps, battery, heart rate or active calories) | v1.3.0, main project |
| [`whoop-watchface`](whoop-watchface) | **Whebble** | Time plus ring gauges for Whoop recovery, sleep and strain | v0.1.0, in progress |
| [`timezone-watchface`](timezone-watchface) | Timezone | Local time, three world clocks and weather | Early prototype, superseded by Homezone |

Homezone and Whebble are designed for the **Pebble Time 2 (emery)**.

## Getting started

You'll need the Pebble SDK. See <https://developer.repebble.com> for setup.

```sh
cd console-watchface                 # or any of the other folders
pebble build
pebble install --emulator emery      # run in the emulator
pebble install --phone <ip>          # sideload to a paired phone
```

The projects with tests (`console-watchface`, `whoop-watchface`) run them with
Node's built-in test runner:

```sh
npm install
npm test
```

## Forking

Feel free to fork and adapt these. A few things to know:

- **Change the UUID.** Each project's `package.json` has a `pebble.uuid`.
  Generate a new one for your fork, or your build will clash with the original
  on a watch that has both installed.
- **No secrets are bundled.** Weather comes from
  [Open-Meteo](https://open-meteo.com), which needs no API key. Any keys or
  credentials (e.g. Whebble's Whoop login) are entered by the user on the
  watchface's settings page at runtime.
- **Build output isn't committed.** `build/`, `node_modules/` and `*.pbw` are
  git-ignored, so run `pebble build` after cloning.

See each project's README for its layout, settings and design notes.

## Licence

The code is under the [MIT licence](LICENSE).

Homezone and Whebble bundle the [Space Grotesk](https://github.com/floriankarsten/space-grotesk)
and [Space Mono](https://github.com/googlefonts/spacemono) fonts, which are
under the SIL Open Font License 1.1, not MIT. Their licence text is in each
project's `resources/fonts/OFL.txt`.
