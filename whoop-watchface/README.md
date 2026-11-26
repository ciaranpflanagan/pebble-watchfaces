# Triad

A Whoop watchface for the **Pebble Time 2 (emery)**, in the same clean style as
[Homezone](../console-watchface). The time sits up top; below it are three ring
gauges for Whoop's core metrics: **recovery**, **sleep** and **strain**.

<p align="center">
  <img src="design-preview.png" alt="Design preview of Triad in five states">
</p>

> The preview is a browser render of the layout using the real fonts, not an
> emulator screenshot. Check the final positions in the emulator: Pebble's text
> offsets differ slightly from a browser's.

## Status

**Phase 3 of 4: live Whoop data.** The face shows your real recovery, sleep and
strain, fetched every 15 minutes. Connecting works in the emulator only for
now: a real phone needs the callback page hosted on https (see below). Set
`USE_MOCK_WHOOP` in `src/pkjs/index.js` to `true` to draw a fixed sample
snapshot instead, for design work without an account.

| Phase | Scope | Status |
|-------|-------|--------|
| 1 | Layout, weather, settings, sample Whoop data | ✅ |
| 2 | Whoop credentials on the config page, OAuth connect, token refresh | ✅ emulator |
| 3 | Live recovery / sleep / strain from the Whoop API | ✅ emulator |
| 4 | Polish, release build | — |

## Layout

```
  TUE                  ☁ 9°C     ← weekday · weather glyph + temperature
  17 NOV                         ← date

          21:44                  ← time (accent-coloured colon)
  ────────────────────────────
   (78)      (91)      (12.4)    ← ring gauges
  RECOVERY   SLEEP     STRAIN
  SLEPT 7H 42M      SYNC 21:32   ← time asleep · last successful fetch
```

| Ring | Value | Fill | Colour |
|------|-------|------|--------|
| Recovery | Recovery score, % | 0–100 | Whoop zone: green ≥ 67, yellow 34–66, red ≤ 33 |
| Sleep | Sleep performance, % | 0–100 | Blue-violet |
| Strain | Day strain, one decimal | 0–21 | Accent colour |

- **Stale data:** if the last successful fetch is more than 3 hours old, the
  rings and values turn grey, so you can tell when the phone has stopped
  updating. A failed fetch sends nothing, so the last readings stay up.
- **No data:** values read `--` until the first sync, while you're not
  connected, or while Whoop hasn't scored a metric yet (`PENDING_SCORE`,
  `UNSCORABLE`, or no recovery for today's cycle yet).
- **Restarts:** the watch saves the last readings and weather, so the face is
  complete straight away rather than waiting for the phone.

## Settings

Through a [Clay](https://github.com/pebble/clay) config page:

- Light / dark theme (dark by default)
- Accent colour, which colours the clock colon and the strain ring (Picton
  blue by default)
- Temperature unit, °C / °F
- Whoop client ID and secret, and the Connect button (see below)

In the emulator, `pebble emu-app-config --emulator emery` opens the page in your
browser. The emulator (pebble-tool 5) serves it itself from a `data:` URI; see
`src/pkjs/emulator-config.js`. `build.sh --prod` switches this off for release
builds. Homezone's old `clay-proxy.html` workaround no longer works with
pebble-tool 5 and isn't used here.

## Connecting to Whoop

For now each user brings their own Whoop developer app, so no secret ships in
the `.pbw` or this repo.

1. Create an app in the [Whoop developer dashboard](https://developer.whoop.com)
   with the scopes `read:recovery`, `read:sleep`, `read:cycles` and `offline`,
   and the redirect URL `http://localhost:8888/whoop-callback.html`.
2. Serve this folder and open the config page in the emulator:

   ```sh
   python3 -m http.server 8888 --directory .   # terminal 1, serves whoop-callback.html
   ./build.sh --install                         # terminal 2
   pebble emu-app-config --emulator emery
   ```

3. Paste the app's client ID and secret into the **Whoop** section and Save.
   They are stored only on the phone (or emulator), never sent to the watch.
4. Run `pebble emu-app-config --emulator emery` again and tap **Connect to
   Whoop**. Log in and allow access; Whoop redirects to `whoop-callback.html`,
   which hands the code back to the watchface. The phone swaps it for tokens.
5. Reopen the config page: it should say **Connected to Whoop**. `pebble logs
   --emulator emery` shows `Whoop code exchange OK` and the token expiry.

Afterwards the phone refreshes the access token (about hourly) before it
expires. Whoop rotates the refresh token on every refresh, so only one refresh
runs at a time and the new token is saved straight away. If Whoop rejects the
refresh token, the connection is cleared and the config page asks you to
reconnect. Changing the client ID or secret also disconnects.

**Real phones:** the redirect URL must be an https page, so
`whoop-callback.html` has to be hosted (e.g. an Azure Static Web App), added as
a redirect URL on the Whoop app, and set as `WHOOP_REDIRECT_URI_PHONE` in
`src/pkjs/index.js`. Until then the config page explains that connecting on a
phone isn't available yet.

## Where the numbers come from

Every 15 minutes the phone makes three Whoop API (v2) requests:

| Request | Gives |
|---------|-------|
| `GET /v2/cycle?limit=1` | The current cycle (physiological day) and its **strain** |
| `GET /v2/cycle/{id}/recovery` | That cycle's **recovery** score |
| `GET /v2/cycle/{id}/sleep` | The sleep that started it: **sleep performance** and **time asleep** (light + deep + REM) |

If Whoop rejects the access token (401), the phone refreshes it once and
retries; a second refusal clears the connection and the config page asks you
to reconnect. After a 429 (rate limited) the next poll is skipped.

`package.json` declares the permissions a real phone needs: Internet access to
`api.prod.whoop.com` and `api.open-meteo.com`, and Location for the weather.

## Building & running

```sh
./build.sh              # build for the emulator
./build.sh --install    # build and install on the running emery emulator
./build.sh --prod       # release build → ../whoop-watchface-release.pbw
```

> After changing `messageKeys` in `package.json`, run `pebble clean` before
> building, or the generated `MESSAGE_KEY_*` header goes stale.

## Testing

```sh
npm test
```

The tests cover the Whoop payload (integer encoding, clamping, unscored values),
recovery zones, weather mapping and the Whoop connection (login URL, token
requests and responses, refresh timing, callback checks). They also read the C source and
`package.json` back and check that message keys, the icon enum, the recovery
thresholds, the default accent and the font character subsets all still agree.

## Architecture

| File | Role |
|------|------|
| `src/c/whoop-watchface.c` | Rendering, ring gauges, persisted readings and settings |
| `src/pkjs/index.js`       | Phone side: settings, weather, Whoop refresh, AppMessage queue |
| `src/pkjs/whoop.js`       | Whoop API replies → snapshot → watch payload, recovery zones, sample data |
| `src/pkjs/whoop-auth.js`  | Whoop OAuth: login URL, token requests and responses, callback checks |
| `src/pkjs/weather.js`     | Open-Meteo URL, response parsing, WMO → glyph mapping |
| `src/pkjs/accent.js`      | Accent colour default and validation |
| `src/pkjs/config.js`      | Clay config page, including the Whoop section's Connect button |
| `src/pkjs/emulator-config.js` | Hands the config page to the emulator as a `data:` URI |
| `whoop-callback.html`     | Whoop's redirect target: hands the login code back to the watchface |

### Message protocol

All values are integers. `-1` means "no reading".

| Key | Value |
|-----|-------|
| `WHOOP_RECOVERY` | 0–100 |
| `WHOOP_SLEEP_PERF` | 0–100 |
| `WHOOP_SLEEP_MINS` | minutes asleep |
| `WHOOP_STRAIN` | strain × 10 (0–210) |
| `WHOOP_SYNC_TIME` | Unix seconds of the sync; 0 = never |
| `WEATHER_TEMP` / `WEATHER_ICON` | °, glyph index |
| `SETTINGS_THEME` / `SETTINGS_TEMP_UNIT` / `SETTINGS_ACCENT` | 0/1, 0/1, 0xRRGGBB |
