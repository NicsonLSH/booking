/**
 * Booking page front end.
 *
 * Deliberately dumb: it never decides which hours are open. It asks the Apps
 * Script backend and renders the answer, so there is no timezone arithmetic
 * here and nothing to tamper with from the console.
 */
(function () {
  'use strict';

  var CFG = window.BOOKING_CONFIG || {};
  var API = CFG.API_URL || '';
  var CONFIGURED = API && API.indexOf('PASTE_YOUR') === -1;

  var MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'];

  var state = {
    step: 'location',
    location: null,
    locationLabel: '',
    date: null,
    dateLabel: '',
    slot: null,
    view: null,      // {year, month} of the visible calendar page
    minDate: null,
    maxDate: null
  };

  var el = {};
  ['steps', 'locations', 'days', 'slots', 'month-label', 'prev-month', 'next-month',
    'date-hint', 'time-hint', 'tz-note', 'details-summary', 'booking-form', 'submit',
    'loading', 'loading-text', 'done-when', 'done-receipt', 'book-another',
    'brand', 'title', 'subtitle', 'foot-note', 'e-form'
  ].forEach(function (id) { el[id] = document.getElementById(id); });

  // ------------------------------------------------------------- transport --

  function get(params) {
    var qs = Object.keys(params)
      .map(function (k) { return encodeURIComponent(k) + '=' + encodeURIComponent(params[k]); })
      .join('&');

    return fetch(API + '?' + qs, { method: 'GET', redirect: 'follow' })
      .then(readJson);
  }

  /**
   * text/plain keeps this a CORS "simple request". With application/json the
   * browser sends a preflight, which Apps Script does not answer, and the
   * request fails with an opaque network error.
   */
  function post(body) {
    return fetch(API, {
      method: 'POST',
      redirect: 'follow',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(body)
    }).then(readJson);
  }

  function readJson(res) {
    return res.text().then(function (text) {
      try {
        return JSON.parse(text);
      } catch (err) {
        throw new Error('The booking server returned something unexpected. It may need to be redeployed.');
      }
    });
  }

  // ------------------------------------------------------------ chrome bits --

  function busy(on, message) {
    el.loading.hidden = !on;
    if (on) el['loading-text'].textContent = message || 'Loading…';
  }

  function show(step) {
    state.step = step;
    ['location', 'date', 'time', 'details', 'done'].forEach(function (name) {
      document.getElementById('panel-' + name).hidden = (name !== step);
    });
    paintSteps();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function paintSteps() {
    var order = ['location', 'date', 'time', 'details'];
    var at = order.indexOf(state.step);
    var done = state.step === 'done';

    Array.prototype.forEach.call(el.steps.children, function (li, i) {
      li.classList.toggle('active', !done && i === at);
      li.classList.toggle('done', done || (at > -1 && i < at));
    });
  }

  function fail(node, message) {
    node.textContent = message;
    node.hidden = false;
  }

  function clearErrors() {
    Array.prototype.forEach.call(document.querySelectorAll('.error'), function (n) {
      n.hidden = true;
      n.textContent = '';
    });
    Array.prototype.forEach.call(document.querySelectorAll('input'), function (n) {
      n.classList.remove('invalid');
    });
  }

  function message(container, text) {
    container.innerHTML = '';
    var p = document.createElement('p');
    p.className = 'empty';
    p.textContent = text;
    container.appendChild(p);
  }

  // ------------------------------------------------------- step 1: location --

  function loadLocations() {
    if (!CONFIGURED) {
      message(el.locations, 'Not connected yet — paste your Apps Script Web App URL into assets/config.js.');
      return;
    }

    busy(true, 'Loading availability…');
    get({ action: 'config' })
      .then(function (data) {
        busy(false);
        if (!data.ok) return message(el.locations, data.message || 'Could not load availability.');
        if (!data.locations.length) return message(el.locations, 'No locations are open for booking right now.');

        state.minNoticeHours = data.minNoticeHours;
        el.locations.innerHTML = '';

        data.locations.forEach(function (loc) {
          var btn = document.createElement('button');
          btn.type = 'button';
          btn.className = 'location';
          btn.appendChild(document.createTextNode(loc.label));
          btn.addEventListener('click', function () { pickLocation(loc); });
          el.locations.appendChild(btn);
        });
      })
      .catch(function (err) {
        busy(false);
        message(el.locations, err.message || 'Could not reach the booking server.');
      });
  }

  function pickLocation(loc) {
    state.location = loc.id;
    state.locationLabel = loc.label;
    state.date = null;
    state.slot = null;

    var now = new Date();
    state.view = { year: now.getFullYear(), month: now.getMonth() };

    el['date-hint'].textContent = 'Showing open days for ' + loc.label + '.';
    show('date');
    loadMonth();
  }

  // ----------------------------------------------------------- step 2: date --

  function loadMonth() {
    var key = state.view.year + '-' + pad(state.view.month + 1);
    el['month-label'].textContent = MONTHS[state.view.month] + ' ' + state.view.year;

    busy(true, 'Checking the calendar…');
    get({ action: 'days', location: state.location, month: key })
      .then(function (data) {
        busy(false);
        if (!data.ok) return message(el.days, data.message || 'Could not load this month.');

        state.minDate = data.minDate;
        state.maxDate = data.maxDate;
        drawMonth(data.availableDates);
      })
      .catch(function (err) {
        busy(false);
        message(el.days, err.message || 'Could not reach the booking server.');
      });
  }

  function drawMonth(availableDates) {
    var open = {};
    availableDates.forEach(function (d) { open[d] = true; });

    var year = state.view.year;
    var month = state.view.month;
    var first = new Date(year, month, 1);
    var daysInMonth = new Date(year, month + 1, 0).getDate();

    el.days.innerHTML = '';

    for (var b = 0; b < first.getDay(); b++) {
      var blank = document.createElement('span');
      blank.className = 'day blank';
      el.days.appendChild(blank);
    }

    for (var d = 1; d <= daysInMonth; d++) {
      var key = year + '-' + pad(month + 1) + '-' + pad(d);
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'day';
      btn.textContent = String(d);

      if (open[key]) {
        btn.setAttribute('aria-label', MONTHS[month] + ' ' + d + ', available');
        bindDay(btn, key);
      } else {
        btn.disabled = true;
      }

      el.days.appendChild(btn);
    }

    if (!availableDates.length) {
      var note = document.createElement('p');
      note.className = 'empty';
      note.textContent = 'Nothing open this month — try the next one.';
      el.days.appendChild(note);
    }

    paintNav();
  }

  function bindDay(btn, key) {
    btn.addEventListener('click', function () {
      state.date = key;
      show('time');
      loadSlots();
    });
  }

  function paintNav() {
    var now = new Date();
    var viewing = state.view.year * 12 + state.view.month;

    el['prev-month'].disabled = viewing <= now.getFullYear() * 12 + now.getMonth();

    if (state.maxDate) {
      var max = state.maxDate.split('-');
      el['next-month'].disabled = viewing >= Number(max[0]) * 12 + (Number(max[1]) - 1);
    }
  }

  function stepMonth(delta) {
    var next = new Date(state.view.year, state.view.month + delta, 1);
    state.view = { year: next.getFullYear(), month: next.getMonth() };
    loadMonth();
  }

  // ----------------------------------------------------------- step 3: time --

  function loadSlots() {
    busy(true, 'Finding open times…');
    get({ action: 'slots', location: state.location, date: state.date })
      .then(function (data) {
        busy(false);
        if (!data.ok) return message(el.slots, data.message || 'Could not load times.');

        state.dateLabel = data.dateLabel;
        el['time-hint'].textContent = data.dateLabel;
        el['tz-note'].textContent = CFG.TIMEZONE_NOTE || '';

        if (!data.slots.length) {
          return message(el.slots, 'Every time on this day has just been taken. Please pick another date.');
        }

        el.slots.innerHTML = '';
        data.slots.forEach(function (slot) {
          var btn = document.createElement('button');
          btn.type = 'button';
          btn.className = 'slot';
          btn.textContent = slot.label;
          btn.addEventListener('click', function () { pickSlot(slot); });
          el.slots.appendChild(btn);
        });
      })
      .catch(function (err) {
        busy(false);
        message(el.slots, err.message || 'Could not reach the booking server.');
      });
  }

  function pickSlot(slot) {
    state.slot = slot;
    el['details-summary'].textContent =
      state.dateLabel + ' at ' + slot.label +
      (CFG.DURATION_LABEL ? ' · ' + CFG.DURATION_LABEL : '');
    clearErrors();
    show('details');
    document.getElementById('f-name').focus();
  }

  // -------------------------------------------------------- step 4: details --

  var DISCORD_LEGACY = /^[A-Za-z0-9_.]{2,32}#\d{4}$/;
  var DISCORD_MODERN = /^[a-z0-9_.]{2,32}$/;
  var EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

  function readForm() {
    return {
      name: document.getElementById('f-name').value.trim(),
      email: document.getElementById('f-email').value.trim(),
      discordId: document.getElementById('f-discord').value.trim().replace(/^@/, ''),
      notes: document.getElementById('f-notes').value.trim()
    };
  }

  /** Mirrors the server checks. The server is still the one that decides. */
  function validate(form) {
    var problems = [];

    if (!form.name) {
      problems.push(['f-name', 'e-name', 'Please enter your full name.']);
    }
    if (!form.email) {
      problems.push(['f-email', 'e-email', 'Please enter your email.']);
    } else if (!EMAIL.test(form.email)) {
      problems.push(['f-email', 'e-email', 'That email address does not look right.']);
    }
    if (!form.discordId) {
      problems.push(['f-discord', 'e-discord', 'Please enter your Discord ID.']);
    } else if (!DISCORD_LEGACY.test(form.discordId) && !DISCORD_MODERN.test(form.discordId)) {
      problems.push(['f-discord', 'e-discord', 'Use your handle, like "yourhandle" or "YourName#1234".']);
    }

    return problems;
  }

  function submit(event) {
    event.preventDefault();
    clearErrors();

    var form = readForm();
    var problems = validate(form);

    if (problems.length) {
      problems.forEach(function (p) {
        document.getElementById(p[0]).classList.add('invalid');
        fail(document.getElementById(p[1]), p[2]);
      });
      document.getElementById(problems[0][0]).focus();
      return;
    }

    el.submit.disabled = true;
    busy(true, 'Booking your slot…');

    post({
      location: state.location,
      ts: state.slot.ts,
      name: form.name,
      email: form.email,
      discordId: form.discordId,
      notes: form.notes
    })
      .then(function (data) {
        busy(false);
        el.submit.disabled = false;

        if (!data.ok) {
          // The slot went while they were typing. Send them back to pick again.
          if (data.code === 'SLOT_TAKEN') {
            show('time');
            loadSlots();
            return;
          }
          return fail(el['e-form'], data.message || 'Something went wrong. Please try again.');
        }

        showConfirmation(data, form);
      })
      .catch(function (err) {
        busy(false);
        el.submit.disabled = false;
        fail(el['e-form'], err.message || 'Could not reach the booking server.');
      });
  }

  // ------------------------------------------------------------ confirmation --

  function showConfirmation(data, form) {
    el['done-when'].textContent = data.dateLabel + ' at ' + data.timeLabel;

    var rows = [
      ['Name', form.name],
      ['Email', form.email],
      ['Discord', form.discordId],
      ['Location', state.locationLabel]
    ];
    if (CFG.DURATION_LABEL) rows.push(['Length', CFG.DURATION_LABEL]);

    el['done-receipt'].innerHTML = '';
    rows.forEach(function (row) {
      el['done-receipt'].appendChild(receiptRow(row[0], row[1]));
    });

    if (data.meetLink) {
      var link = document.createElement('a');
      link.href = data.meetLink;
      link.target = '_blank';
      link.rel = 'noopener';
      link.textContent = 'Join Google Meet';
      el['done-receipt'].appendChild(receiptRow('Video call', link));
    }

    show('done');
  }

  function receiptRow(label, value) {
    var wrap = document.createElement('div');
    var dt = document.createElement('dt');
    var dd = document.createElement('dd');

    dt.textContent = label;
    if (typeof value === 'string') dd.textContent = value;
    else dd.appendChild(value);

    wrap.appendChild(dt);
    wrap.appendChild(dd);
    return wrap;
  }

  function reset() {
    state.location = null;
    state.date = null;
    state.slot = null;
    el['booking-form'].reset();
    clearErrors();
    show('location');
  }

  // ------------------------------------------------------------------ wiring --

  function pad(n) { return n < 10 ? '0' + n : String(n); }

  function init() {
    if (CFG.BRAND) el.brand.textContent = CFG.BRAND;
    if (CFG.TITLE) { el.title.textContent = CFG.TITLE; document.title = CFG.TITLE; }
    if (CFG.SUBTITLE) el.subtitle.textContent = CFG.SUBTITLE;
    el['foot-note'].textContent = CFG.TIMEZONE_NOTE || '';

    el['prev-month'].addEventListener('click', function () { stepMonth(-1); });
    el['next-month'].addEventListener('click', function () { stepMonth(1); });
    el['booking-form'].addEventListener('submit', submit);
    el['book-another'].addEventListener('click', reset);

    Array.prototype.forEach.call(document.querySelectorAll('[data-back]'), function (btn) {
      btn.addEventListener('click', function () { show(btn.getAttribute('data-back')); });
    });

    show('location');
    loadLocations();
  }

  init();
})();
