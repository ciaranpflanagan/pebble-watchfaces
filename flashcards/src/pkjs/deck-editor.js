'use strict';

// ---------------------------------------------------------------------------
// The deck editor — a custom Clay component.
//
// Replaces the textarea that asked people to learn "# heading" and "front|back".
// Two boxes and an Add button, with the deck building up beneath them, plus a
// file picker for anyone who already has their cards as a spreadsheet export.
//
// The text format has not gone anywhere: this component still *emits* it, into
// a hidden field, and deck.js on the phone still parses it with all its limits
// and line-numbered errors. The format went from being something a user types
// to something only these two files ever see, which is why none of the parsing,
// the budgets or the tests behind them had to change.
//
// ---------------------------------------------------------------------------
// Two things about Clay that shape all of the code below
// ---------------------------------------------------------------------------
//
// 1. `initialize` is serialised with Function.prototype.toString() and injected
//    into the config page, which has no module system around it. It cannot
//    require() anything or close over anything in this file — so every helper
//    it uses is nested inside it, and this module's own scope is empty on
//    purpose. That is also why the CSV parsing lives in there rather than being
//    shared with deck.js.
//
// 2. Clay calls `initialize` BEFORE it sets the item's value, so reading
//    self.get() here would only ever see an empty string. The saved decks
//    arrive as a 'change' event afterwards, which is what the subscription at
//    the bottom is for — and why writing our own value needs a guard, or
//    publishing a card would immediately re-parse and rebuild the list out from
//    under the person typing into it.
// ---------------------------------------------------------------------------

module.exports = {
  name: 'deckeditor',
  manipulator: 'val',

  defaults: {
    label: 'Decks',
    description: ''
  },

  // Deliberately bare. Everything inside is built by initialize as plain DOM:
  // the template passes through minified's {{...}} engine first, and a <style>
  // block or a stray brace in there is a fight not worth having.
  template:
    '<div class="component component-deckeditor">' +
      '<input type="hidden" data-manipulator-target />' +
      '<div class="de-root"></div>' +
    '</div>',

  initialize: function(minified, clay) {
    var self = this;
    var root = self.$element[0].querySelector('.de-root');

    // The text format's two marks, matching what deck.js expects to parse.
    var HEADING = '#';
    var SIDE_SPLIT = '|';

    // True while we are writing our own value, so the 'change' subscription can
    // tell our own publish apart from Clay restoring saved settings.
    var publishing = false;

    var state = { decks: [], active: 0 };

    // -----------------------------------------------------------------------
    // The text format
    // -----------------------------------------------------------------------

    /**
     * Strip control characters — the wire format reserves two of them — and
     * collapse the whitespace that survives, so what is counted against the
     * watch's byte budget is exactly what will be stored.
     */
    function clean(value) {
      return String(value === null || value === undefined ? '' : value)
        .replace(/[\x00-\x1f\x7f]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    }

    /** Parse the stored text back into decks. Forgiving: deck.js is the judge. */
    function parseText(text) {
      var decks = [];
      var current = null;
      var lines = String(text || '').replace(/\r\n?/g, '\n').split('\n');

      for (var i = 0; i < lines.length; i++) {
        var line = lines[i].trim();
        if (line === '') continue;

        if (line.charAt(0) === HEADING) {
          current = { title: clean(line.substring(1)) || 'Untitled', cards: [] };
          decks.push(current);
          continue;
        }

        var at = line.indexOf(SIDE_SPLIT);
        if (at === -1) continue;

        var front = clean(line.substring(0, at));
        var back = clean(line.substring(at + 1));
        if (front === '' || back === '') continue;

        if (current === null) {
          current = { title: 'Untitled', cards: [] };
          decks.push(current);
        }

        current.cards.push({ front: front, back: back });
      }

      return decks;
    }

    function serialise(decks) {
      var out = [];

      for (var i = 0; i < decks.length; i++) {
        out.push(HEADING + ' ' + decks[i].title);

        for (var j = 0; j < decks[i].cards.length; j++) {
          out.push(decks[i].cards[j].front + ' ' + SIDE_SPLIT + ' ' + decks[i].cards[j].back);
        }

        out.push('');
      }

      return out.join('\n').trim();
    }

    function publish() {
      publishing = true;
      self.set(serialise(state.decks));
      publishing = false;
    }

    // -----------------------------------------------------------------------
    // Delimited import
    // -----------------------------------------------------------------------

    /**
     * Split one line on `sep`, honouring the quoting a spreadsheet export uses:
     * a field wrapped in quotes may contain the separator, and a doubled quote
     * inside one is a literal quote. Without this, a card whose answer contains
     * a comma would quietly split into two columns.
     */
    function splitLine(line, sep) {
      var fields = [];
      var field = '';
      var quoted = false;

      for (var i = 0; i < line.length; i++) {
        var ch = line.charAt(i);

        if (quoted) {
          if (ch === '"') {
            if (line.charAt(i + 1) === '"') {
              field += '"';
              i++;
            } else {
              quoted = false;
            }
          } else {
            field += ch;
          }
        } else if (ch === '"') {
          quoted = true;
        } else if (ch === sep) {
          fields.push(field);
          field = '';
        } else {
          field += ch;
        }
      }

      fields.push(field);
      return fields;
    }

    /**
     * Guess the separator: whichever yields two or more columns on the most
     * lines. Tab is tried first because a spreadsheet copied to the clipboard
     * is tab-separated and its cells routinely contain commas of their own.
     */
    function detectSeparator(lines) {
      var candidates = ['\t', ',', ';', '|'];
      var best = null;
      var bestScore = 0;

      for (var c = 0; c < candidates.length; c++) {
        var score = 0;

        for (var i = 0; i < lines.length; i++) {
          if (splitLine(lines[i], candidates[c]).length >= 2) score++;
        }

        if (score > bestScore) {
          bestScore = score;
          best = candidates[c];
        }
      }

      return bestScore > 0 ? best : null;
    }

    /** Turn a spreadsheet export into cards. Columns past the first two are ignored. */
    function parseDelimited(text) {
      var lines = String(text || '').replace(/\r\n?/g, '\n').split('\n').filter(function(line) {
        return line.trim() !== '';
      });

      if (lines.length === 0) return [];

      var sep = detectSeparator(lines);
      if (sep === null) return [];

      var cards = [];

      for (var i = 0; i < lines.length; i++) {
        var fields = splitLine(lines[i], sep);
        var front = clean(fields[0]);
        var back = clean(fields[1]);

        if (front !== '' && back !== '') cards.push({ front: front, back: back });
      }

      // A header row like "Front,Back" is common and never a card worth keeping.
      if (cards.length > 1) {
        var headerish = {
          front: 1, back: 1, question: 1, answer: 1,
          term: 1, definition: 1, word: 1, meaning: 1
        };

        if (headerish[cards[0].front.toLowerCase()] && headerish[cards[0].back.toLowerCase()]) {
          cards.shift();
        }
      }

      return cards;
    }

    // -----------------------------------------------------------------------
    // Rendering
    // -----------------------------------------------------------------------

    function activeDeck() {
      if (state.decks.length === 0) {
        state.decks.push({ title: 'My Deck', cards: [] });
        state.active = 0;
      }

      if (state.active < 0 || state.active >= state.decks.length) state.active = 0;

      return state.decks[state.active];
    }

    function escapeHtml(value) {
      return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
    }

    function say(message) {
      var note = root.querySelector('.de-note');
      note.textContent = message || '';
      note.style.display = message ? 'block' : 'none';
    }

    function renderDeckOptions() {
      var select = root.querySelector('.de-deck');
      var html = '';

      for (var i = 0; i < state.decks.length; i++) {
        html += '<option value="' + i + '"' + (i === state.active ? ' selected' : '') + '>' +
                escapeHtml(state.decks[i].title) +
                ' (' + state.decks[i].cards.length + ')</option>';
      }

      select.innerHTML = html;
    }

    function renderCards() {
      var deck = activeDeck();
      var list = root.querySelector('.de-list');
      var count = root.querySelector('.de-count');

      count.textContent = deck.cards.length === 0
        ? 'No cards yet.'
        : deck.cards.length + (deck.cards.length === 1 ? ' card' : ' cards');

      if (deck.cards.length === 0) {
        list.innerHTML = '';
        return;
      }

      var html = '';

      // Newest first: the card just added should be the one in view, rather
      // than the one that has scrolled off the bottom of a long deck.
      for (var i = deck.cards.length - 1; i >= 0; i--) {
        html +=
          '<li class="de-card">' +
            '<span class="de-card-text">' +
              '<strong>' + escapeHtml(deck.cards[i].front) + '</strong>' +
              '<em>' + escapeHtml(deck.cards[i].back) + '</em>' +
            '</span>' +
            '<button type="button" class="de-remove" data-index="' + i + '"' +
              ' aria-label="Delete this card">&times;</button>' +
          '</li>';
      }

      list.innerHTML = html;
    }

    function render() {
      renderDeckOptions();
      renderCards();
    }

    // -----------------------------------------------------------------------
    // Scaffolding
    // -----------------------------------------------------------------------

    root.innerHTML =
      '<style>' +
        '.component-deckeditor .de-note{display:none;margin:0 10px 10px;padding:8px;' +
          'border-radius:3px;background:rgba(255,255,255,0.12);font-size:13px}' +
        // Clay's stylesheet gives every button `min-width:12rem`, which is wider
        // than a phone can spare for three of them — so each rule below has to
        // put that back to zero, or the row blows out and squeezes the select
        // down to its chevron.
        '.component-deckeditor .de-bar{display:flex;flex-wrap:wrap;align-items:center;' +
          'padding:10px}' +
        '.component-deckeditor .de-bar select{flex:1 1 100%;min-width:0;margin-bottom:6px;' +
          'padding:8px;border:none;border-radius:3px;background:rgba(0,0,0,0.3);' +
          'color:#fff;font-size:14px}' +
        '.component-deckeditor .de-mini{flex:1 1 auto;min-width:0;margin-right:6px;' +
          'padding:7px 9px;border:none;border-radius:3px;' +
          'background:rgba(255,255,255,0.15);color:#fff;font-size:13px;cursor:pointer}' +
        '.component-deckeditor .de-mini:last-child{margin-right:0}' +
        '.component-deckeditor .de-field{padding:0 10px 8px}' +
        '.component-deckeditor .de-field label{display:block;font-size:13px;' +
          'opacity:0.7;margin-bottom:4px}' +
        '.component-deckeditor .de-field input{width:100%;box-sizing:border-box;padding:9px;' +
          'border:none;border-radius:3px;background:rgba(0,0,0,0.3);color:#fff;font-size:15px}' +
        '.component-deckeditor .de-add{display:block;width:calc(100% - 20px);min-width:0;' +
          'margin:2px 10px 12px;padding:11px;border:none;border-radius:3px;' +
          'background:#ff4700;color:#fff;font-size:15px;cursor:pointer}' +
        '.component-deckeditor .de-add[disabled]{opacity:0.4;cursor:default}' +
        '.component-deckeditor .de-count{padding:0 10px 6px;font-size:13px;opacity:0.7}' +
        '.component-deckeditor .de-list{list-style:none;margin:0;padding:0 10px 10px}' +
        '.component-deckeditor .de-card{display:flex;align-items:center;' +
          'padding:7px 8px;margin-bottom:4px;border-radius:3px;background:rgba(0,0,0,0.22)}' +
        '.component-deckeditor .de-card-text{flex:1 1 auto;min-width:0;font-size:14px}' +
        // `strong` is orange in Clay's sheet; here it is just the card's front.
        '.component-deckeditor .de-card strong{display:block;font-weight:normal;' +
          'color:inherit;font-family:inherit;' +
          'overflow:hidden;text-overflow:ellipsis;white-space:nowrap}' +
        '.component-deckeditor .de-card em{display:block;font-style:normal;opacity:0.6;' +
          'font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}' +
        '.component-deckeditor .de-remove{flex:0 0 auto;width:30px;min-width:0;height:30px;' +
          'padding:0;border:none;border-radius:15px;background:rgba(255,255,255,0.15);' +
          'color:#fff;font-size:17px;line-height:1;cursor:pointer;margin-left:8px}' +
        '.component-deckeditor .de-import{padding:0 10px 12px;font-size:13px;opacity:0.85}' +
        '.component-deckeditor .de-import input{display:block;margin-top:6px;font-size:13px}' +
      '</style>' +

      '<div class="de-note"></div>' +

      '<div class="de-bar">' +
        '<select class="de-deck"></select>' +
        '<button type="button" class="de-mini de-new">New</button>' +
        '<button type="button" class="de-mini de-rename">Rename</button>' +
        '<button type="button" class="de-mini de-delete">Delete</button>' +
      '</div>' +

      '<div class="de-field"><label>Front</label>' +
        '<input class="de-front" type="text" placeholder="Dia duit" /></div>' +
      '<div class="de-field"><label>Back</label>' +
        '<input class="de-back" type="text" placeholder="Hello" /></div>' +

      '<button type="button" class="de-add">Add card</button>' +

      '<div class="de-count"></div>' +
      '<ul class="de-list"></ul>' +

      '<div class="de-import">' +
        'Or import a CSV export from Anki, Quizlet or a spreadsheet — two ' +
        'columns, front then back.' +
        '<input class="de-file" type="file" accept=".csv,.tsv,.txt,text/csv,text/plain" />' +
      '</div>';

    var $front = root.querySelector('.de-front');
    var $back = root.querySelector('.de-back');
    var $add = root.querySelector('.de-add');
    var $deck = root.querySelector('.de-deck');
    var $file = root.querySelector('.de-file');

    // -----------------------------------------------------------------------
    // Behaviour
    // -----------------------------------------------------------------------

    function refreshAddState() {
      $add.disabled = clean($front.value) === '' || clean($back.value) === '';
    }

    function addCard() {
      var front = clean($front.value);
      var back = clean($back.value);

      if (front === '' || back === '') {
        say('A card needs both a front and a back.');
        return;
      }

      activeDeck().cards.push({ front: front, back: back });

      $front.value = '';
      $back.value = '';
      refreshAddState();
      say('');
      render();
      publish();

      // Straight back to the front box, so a run of cards is type, Enter, type,
      // Enter — without reaching for the screen between each one.
      $front.focus();
    }

    $add.addEventListener('click', addCard);
    $front.addEventListener('input', refreshAddState);
    $back.addEventListener('input', refreshAddState);

    // Enter moves the way you would expect rather than submitting the config
    // page, which would save and close it in the middle of writing a deck.
    function onEnter(event, next) {
      if (event.key !== 'Enter' && event.keyCode !== 13) return;
      event.preventDefault();
      next();
    }

    $front.addEventListener('keydown', function(event) {
      onEnter(event, function() { $back.focus(); });
    });

    $back.addEventListener('keydown', function(event) {
      onEnter(event, addCard);
    });

    root.querySelector('.de-list').addEventListener('click', function(event) {
      var button = event.target;

      // No closest() in every webview this page has to run in.
      while (button && button !== root && !button.classList.contains('de-remove')) {
        button = button.parentNode;
      }

      if (!button || button === root || !button.classList.contains('de-remove')) return;

      activeDeck().cards.splice(parseInt(button.getAttribute('data-index'), 10), 1);
      render();
      publish();
    });

    $deck.addEventListener('change', function() {
      state.active = parseInt($deck.value, 10) || 0;
      say('');
      render();
    });

    root.querySelector('.de-new').addEventListener('click', function() {
      var name = window.prompt('Name for the new deck');
      if (name === null) return;

      name = clean(name);
      if (name === '') return;

      state.decks.push({ title: name, cards: [] });
      state.active = state.decks.length - 1;
      say('');
      render();
      publish();
    });

    root.querySelector('.de-rename').addEventListener('click', function() {
      var deck = activeDeck();
      var name = window.prompt('Rename this deck', deck.title);
      if (name === null) return;

      name = clean(name);
      if (name === '') return;

      deck.title = name;
      render();
      publish();
    });

    root.querySelector('.de-delete').addEventListener('click', function() {
      var deck = activeDeck();

      if (!window.confirm('Delete "' + deck.title + '" and its ' +
                          deck.cards.length + ' card(s)?')) return;

      state.decks.splice(state.active, 1);
      state.active = 0;
      say('');
      render();
      publish();
    });

    $file.addEventListener('change', function() {
      var file = $file.files && $file.files[0];
      if (!file) return;

      var reader = new FileReader();

      reader.onerror = function() {
        say('That file could not be read.');
        $file.value = '';
      };

      reader.onload = function() {
        var cards = parseDelimited(reader.result);

        if (cards.length === 0) {
          say('No two-column rows were found in ' + file.name + '.');
          $file.value = '';
          return;
        }

        var deck = activeDeck();

        for (var i = 0; i < cards.length; i++) deck.cards.push(cards[i]);

        say('Added ' + cards.length + ' card' + (cards.length === 1 ? '' : 's') +
            ' from ' + file.name + ' to "' + deck.title + '".');
        render();
        publish();

        // Cleared so that picking the same file again fires another change.
        $file.value = '';
      };

      reader.readAsText(file);
    });

    // Clay sets the item's value after initialize has run, so the decks saved
    // last time arrive here rather than being readable above.
    self.on('change', function() {
      if (publishing) return;

      state.decks = parseText(self.get());
      state.active = 0;
      render();
    });

    render();
    refreshAddState();
  }
};
