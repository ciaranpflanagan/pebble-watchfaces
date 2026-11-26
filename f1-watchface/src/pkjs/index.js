'use strict';

var Clay         = require('pebble-clay');
var board        = require('./board.js');
var jolpica      = require('./jolpica.js');
var schedule     = require('./schedule.js');
var openf1       = require('./openf1.js');
var accent       = require('./accent.js');
var sources      = require('./sources.js');
var clayCustomFn = require('./clay-custom.js');
var clay         = new Clay(require('./config.js'), clayCustomFn, { autoHandleEvents: false });

// ---------------------------------------------------------------------------
// Config page.
// Clay 1.0.4 always generates a clay.pebble.com S3 base URL and ignores any
// URI passed to generateUrl(). In the emulator, Chrome then blocks the save
// redirect (public page → localhost) under Private Network Access rules.
//
// Fix: let Clay generate its URL, strip the S3 base, and prepend a local
// server instead. Both the page origin and return_to become localhost, which
// Chrome permits (local → local is fine).
//
// Before running `pebble emu-app-config`, serve the project root in a separate
// terminal so clay-proxy.html is reachable:
//   python3 -m http.server 8888 --directory .
//
// On a real phone this proxy is unused entirely — see IS_EMULATOR below.
// ---------------------------------------------------------------------------
var LOCAL_CLAY_URI = 'http://localhost:8888/clay-proxy.html';

// Set to false before publishing to the Rebble store; ./build.sh --prod does it.
var IS_EMULATOR = true;

// ---------------------------------------------------------------------------
// Refresh cadence.
//
// Results arrive in their own time — Jolpica publishes a session some time
// after it ends — so polling hard buys nothing and costs battery. A live
// OpenF1 session is the exception: the order changes lap by lap, and that is
// the whole point of the face.
// ---------------------------------------------------------------------------
var IDLE_REFRESH_MS = 15 * 60 * 1000;
var LIVE_REFRESH_MS = 60 * 1000;

var HTTP_TIMEOUT_MS = 12 * 1000;

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------
var SETTINGS_STORAGE_KEY = 'pitWallSettings';

var DEFAULT_SETTINGS = {
  source:  sources.DEFAULT_SOURCE,
  apiKey:  '',
  gapMode: board.DEFAULT_GAP_MODE,
  theme:   false,
  accent:  accent.DEFAULT_ACCENT
};

/** Bring a settings object read from storage into the current shape. */
function migrateSettings(stored) {
  if (!stored) return DEFAULT_SETTINGS;

  return {
    source:  sources.resolveSource(stored.source),
    apiKey:  sources.normaliseApiKey(stored.apiKey),
    gapMode: board.resolveGapMode(stored.gapMode),
    theme:   !!stored.theme,
    accent:  accent.resolveAccent(stored.accent)
  };
}

function loadSettings() {
  try {
    return migrateSettings(JSON.parse(localStorage.getItem(SETTINGS_STORAGE_KEY)));
  } catch (e) {
    console.log('Could not read stored settings (' + e + '), using defaults');
    return DEFAULT_SETTINGS;
  }
}

function saveSettings(settings) {
  try {
    localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(settings));
  } catch (e) {
    console.log('Could not persist settings: ' + e);
  }
}

// ---------------------------------------------------------------------------
// AppMessage
// ---------------------------------------------------------------------------
function sendSettingsToWatch(settings) {
  // The gap mode and the data source never reach the watch: both are decided
  // here, and the watch only ever sees the finished strings.
  Pebble.sendAppMessage({
    SETTINGS_THEME:  settings.theme ? 1 : 0,
    SETTINGS_ACCENT: accent.resolveAccent(settings.accent)
  }, function() {
    console.log('Settings sent: theme=' + settings.theme +
                ' accent=' + accent.toHexString(settings.accent));
  }, function(e) {
    console.log('Settings send failed: ' + JSON.stringify(e));
  });
}

/**
 * Send everything the face draws in one message.
 *
 * `sessionDate` is the local YYYYMMDD the results belong to, and it is what
 * decides which of the two layouts the watch shows: the board only appears on
 * that date, and 0 means "no session results at all". The watch re-checks it
 * against its own calendar every minute, so the layouts change over at local
 * midnight rather than whenever the next refresh happens to land.
 */
function sendBoardToWatch(built, sessionDate, nextRace) {
  Pebble.sendAppMessage({
    F1_EVENT:        built.event,
    F1_SESSION:      built.session,
    F1_SESSION_DATE: sessionDate,
    F1_NEXT_LABEL:   nextRace.label,
    F1_NEXT_DATES:   nextRace.dates,
    F1_P1_POS:  built.rows[0].pos,
    F1_P1_CODE: built.rows[0].code,
    F1_P1_TIME: built.rows[0].time,
    F1_P2_POS:  built.rows[1].pos,
    F1_P2_CODE: built.rows[1].code,
    F1_P2_TIME: built.rows[1].time,
    F1_P3_POS:  built.rows[2].pos,
    F1_P3_CODE: built.rows[2].code,
    F1_P3_TIME: built.rows[2].time
  }, function() {
    console.log('Board sent: ' + built.event + ' ' + built.session + ' — ' +
                built.rows[0].code + ' ' + built.rows[0].time);
  }, function(e) {
    console.log('Board send failed: ' + JSON.stringify(e));
  });
}

// ---------------------------------------------------------------------------
// HTTP
// ---------------------------------------------------------------------------

/**
 * GET some JSON. `onDone` is called with (data, error) and always exactly once,
 * so every caller can treat a failure as a null payload rather than having to
 * wire up two paths.
 */
function getJson(url, headers, onDone) {
  var xhr = new XMLHttpRequest();
  var settled = false;

  function settle(data, error) {
    if (settled) return;
    settled = true;
    onDone(data, error);
  }

  xhr.onload = function() {
    if (this.status < 200 || this.status >= 300) {
      settle(null, 'HTTP ' + this.status + ' from ' + url);
      return;
    }
    try {
      settle(JSON.parse(this.responseText), null);
    } catch (e) {
      settle(null, 'Bad JSON from ' + url + ': ' + e);
    }
  };
  xhr.onerror   = function() { settle(null, 'Request failed: ' + url); };
  xhr.ontimeout = function() { settle(null, 'Request timed out: ' + url); };

  try {
    xhr.open('GET', url);
    xhr.timeout = HTTP_TIMEOUT_MS;
    for (var name in headers) {
      if (Object.prototype.hasOwnProperty.call(headers, name)) {
        xhr.setRequestHeader(name, headers[name]);
      }
    }
    xhr.send();
  } catch (e) {
    settle(null, 'Could not send request to ' + url + ': ' + e);
  }
}

// ---------------------------------------------------------------------------
// Jolpica (results)
// ---------------------------------------------------------------------------

/**
 * Ask Jolpica for every session type at one round in parallel and hand back the
 * most recent that had results. `round` is undefined for `current/last`.
 */
function fetchJolpicaRound(round, onDone) {
  var pending  = jolpica.CATEGORIES.length;
  var parsed   = [];
  var fallbackRound = 0;

  jolpica.CATEGORIES.forEach(function(category) {
    getJson(jolpica.sessionUrl(category.key, round), {}, function(data, error) {
      if (error) {
        console.log('Jolpica ' + category.key + ': ' + error);
      } else {
        parsed.push(jolpica.parseResponse(data, category.key));
        // Remembered in case every category came back empty: the retry needs
        // the round number that `current/last` resolved to.
        fallbackRound = fallbackRound || jolpica.responseRound(data);
      }

      if (--pending === 0) {
        onDone(jolpica.pickLatest(parsed), fallbackRound);
      }
    });
  });
}

/**
 * `current/last` can land on a round whose sessions have not been published
 * yet — Friday of a race weekend, typically — and come back empty across the
 * board. One walk back to the previous round recovers the last real session.
 */
function fetchJolpica(onDone) {
  fetchJolpicaRound(undefined, function(session, fallbackRound) {
    if (session || fallbackRound < 2) {
      onDone(session);
      return;
    }

    console.log('Jolpica: round ' + fallbackRound + ' is empty, trying ' +
                (fallbackRound - 1));
    fetchJolpicaRound(fallbackRound - 1, function(previous) {
      onDone(previous);
    });
  });
}

// ---------------------------------------------------------------------------
// OpenF1 (live)
// ---------------------------------------------------------------------------

/**
 * The live board, in three or five requests: the session, the driver codes,
 * then the classification — falling back to the position and interval streams
 * while a session is running and has not been classified yet.
 *
 * Any failure hands back null, and the caller drops to Jolpica. That is the
 * ordinary path for a user with no API key during a live session, when OpenF1
 * answers 401.
 */
function fetchOpenF1(settings, onDone) {
  var headers = openf1.authHeaders(settings.apiKey);

  getJson(openf1.sessionsUrl(), headers, function(sessionRows, sessionError) {
    var session = sessionError ? null : openf1.parseSession(sessionRows, Date.now());
    if (!session) {
      console.log('OpenF1 session: ' + (sessionError || 'no session returned'));
      onDone(null);
      return;
    }

    getJson(openf1.driversUrl(), headers, function(driverRows, driverError) {
      // Codes are the only thing lost when this fails, and the rows still tell
      // the user the order, so press on rather than abandoning the fetch.
      if (driverError) console.log('OpenF1 drivers: ' + driverError);
      var codes = openf1.parseDrivers(driverRows);

      getJson(openf1.resultsUrl(), headers, function(resultRows, resultError) {
        if (resultError) console.log('OpenF1 results: ' + resultError);

        var entries = openf1.parseResults(resultRows, codes);
        if (entries.length) {
          onDone({ session: session, entries: entries });
          return;
        }

        if (!session.live) {
          onDone(null);
          return;
        }

        // Live and unclassified: assemble the board from the streams instead.
        getJson(openf1.positionsUrl(), headers, function(positionRows, positionError) {
          if (positionError) {
            console.log('OpenF1 positions: ' + positionError);
            onDone(null);
            return;
          }

          getJson(openf1.intervalsUrl(), headers, function(intervalRows, intervalError) {
            // Intervals are absent early in a session and for non-race
            // sessions; the order alone is still worth drawing.
            if (intervalError) console.log('OpenF1 intervals: ' + intervalError);

            var live = openf1.buildLiveEntries(positionRows, intervalRows, codes);
            onDone(live.length ? { session: session, entries: live } : null);
          });
        });
      });
    });
  });
}

// ---------------------------------------------------------------------------
// The calendar
// ---------------------------------------------------------------------------

/** The next race, for the countdown row. Null once the season is over. */
function fetchNextRace(onDone) {
  getJson(schedule.nextRaceUrl(), {}, function(data, error) {
    if (error) {
      console.log('Schedule (next): ' + error);
      onDone(null);
      return;
    }
    onDone(schedule.parseRound(data));
  });
}

/**
 * When the session behind a Jolpica result actually started.
 *
 * The results themselves carry the race's date and time whatever session they
 * describe, so Saturday's qualifying comes back stamped with Sunday. The
 * round's schedule is the only place the real session time exists — and when
 * the results belong to the round already fetched for the countdown row, it is
 * there for free.
 */
function resolveSessionInstant(session, nextRace, onDone) {
  function fromRound(round) {
    var instant = schedule.sessionInstant(round, session.category);
    // Falling back to the race's own stamp is still better than nothing: for a
    // race it is exactly right, and for the others it is a day out at worst.
    onDone(instant !== null ? instant
                            : board.instantOf(session.raceDate, session.raceTime));
  }

  if (nextRace && nextRace.round === session.round) {
    fromRound(nextRace);
    return;
  }

  getJson(schedule.roundUrl(session.round), {}, function(data, error) {
    if (error) {
      console.log('Schedule (round ' + session.round + '): ' + error);
      fromRound(null);
      return;
    }
    fromRound(schedule.parseRound(data));
  });
}

// ---------------------------------------------------------------------------
// Refresh
// ---------------------------------------------------------------------------
var s_refreshTimer = null;

function scheduleRefresh(delayMs) {
  if (s_refreshTimer) clearTimeout(s_refreshTimer);
  s_refreshTimer = setTimeout(function() { refresh(loadSettings()); }, delayMs);
}

/**
 * Send the face everything it needs, and book the next refresh.
 *
 * `sessionInstant` is when the session on the board started; the watch turns
 * the local date of that instant into the decision of which layout to draw.
 * Null means there is nothing to show and the countdown layout stands.
 */
function publish(session, sessionInstant, nextRace, live) {
  var built = session ? board.buildBoard(session) : board.emptyBoard();
  var date  = sessionInstant === null ? 0 : board.localDateNumber(sessionInstant);

  sendBoardToWatch(built, date, schedule.nextRaceRow(nextRace));
  scheduleRefresh(live ? LIVE_REFRESH_MS : IDLE_REFRESH_MS);
}

/** Jolpica's board, used both as the chosen source and as OpenF1's fallback. */
function refreshFromJolpica(settings, nextRace) {
  fetchJolpica(function(session) {
    if (!session) {
      publish(null, null, nextRace, false);
      return;
    }

    session.gapMode = settings.gapMode;
    resolveSessionInstant(session, nextRace, function(instant) {
      publish(session, instant, nextRace, false);
    });
  });
}

function refresh(settings) {
  // The countdown row is wanted whichever source the board comes from, and the
  // round it returns often carries the session times the board needs too.
  fetchNextRace(function(nextRace) {
    if (!sources.isLive(settings.source)) {
      refreshFromJolpica(settings, nextRace);
      return;
    }

    fetchOpenF1(settings, function(result) {
      if (!result) {
        console.log('OpenF1 gave nothing, falling back to Jolpica results');
        refreshFromJolpica(settings, nextRace);
        return;
      }

      publish({
        event:   result.session.event,
        session: result.session.session,
        entries: result.entries,
        gapMode: settings.gapMode
      }, result.session.startsAt, nextRace, result.session.live);
    });
  });
}

// ---------------------------------------------------------------------------
// Pebble events
// ---------------------------------------------------------------------------
Pebble.addEventListener('ready', function() {
  var settings = loadSettings();
  sendSettingsToWatch(settings);
  refresh(settings);
});

Pebble.addEventListener('showConfiguration', function() {
  var generated = clay.generateUrl();
  if (IS_EMULATOR) {
    var fragment = generated.substring(generated.indexOf('#'));
    Pebble.openURL(LOCAL_CLAY_URI + fragment);
  } else {
    Pebble.openURL(generated);
  }
});

Pebble.addEventListener('webviewclosed', function(e) {
  if (!e.response || e.response === 'CANCELLED') return;

  try {
    // Pass false so getSettings returns raw string-keyed objects with .value
    // properties, instead of the numeric-keyed AppMessage-ready format.
    var claySettings = clay.getSettings(e.response, false);
    var settings = {
      source:  sources.resolveSource(
                 claySettings.SETTINGS_SOURCE && claySettings.SETTINGS_SOURCE.value),
      apiKey:  sources.normaliseApiKey(
                 claySettings.SETTINGS_API_KEY && claySettings.SETTINGS_API_KEY.value),
      gapMode: board.resolveGapMode(
                 claySettings.SETTINGS_GAP_MODE && claySettings.SETTINGS_GAP_MODE.value),
      theme:   !!(claySettings.SETTINGS_THEME && claySettings.SETTINGS_THEME.value),
      accent:  accent.resolveAccent(
                 claySettings.SETTINGS_ACCENT && claySettings.SETTINGS_ACCENT.value)
    };
    saveSettings(settings);
    sendSettingsToWatch(settings);
    refresh(settings);
  } catch (err) {
    console.log('webviewclosed error: ' + err);
  }
});
