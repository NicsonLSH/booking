/**
 * Code.gs — the booking backend.
 *
 * Deployed as a Web App (Execute as: me, Who has access: Anyone). The static
 * page on GitHub Pages talks to it and renders whatever it returns; all
 * availability logic lives here so the rules cannot be edited from a browser.
 *
 * Endpoints
 *   GET  ?action=config
 *   GET  ?action=days&location=<id>&month=YYYY-MM
 *   GET  ?action=slots&location=<id>&date=YYYY-MM-DD
 *   POST {location, ts, name, email, discordId, notes}
 */

/**
 * The timezone every Date in this project is formatted in.
 *
 * This is a function rather than `var TZ = CONFIG.TIMEZONE` on purpose. Apps
 * Script evaluates script files in alphabetical order, so Code.gs runs before
 * Config.gs and a top-level read of CONFIG would blow up with "Cannot read
 * properties of undefined". Reading it inside a function defers the lookup
 * until something is actually called, by which point every file has loaded.
 */
function tz() {
  return CONFIG.TIMEZONE;
}

// ---------------------------------------------------------------- routing --

function doGet(e) {
  try {
    var p = (e && e.parameter) || {};
    var action = p.action || 'config';

    if (action === 'config') return json(handleConfig());
    if (action === 'days') return json(handleDays(p.location, p.month));
    if (action === 'slots') return json(handleSlots(p.location, p.date));

    return json({ ok: false, code: 'UNKNOWN_ACTION', message: 'Unknown action: ' + action });
  } catch (err) {
    return json({ ok: false, code: 'SERVER_ERROR', message: String((err && err.message) || err) });
  }
}

/**
 * The page POSTs with Content-Type: text/plain so the browser treats it as a
 * "simple request" and skips the CORS preflight, which Apps Script cannot
 * answer. That is why the body is parsed by hand here.
 */
function doPost(e) {
  try {
    var body = {};
    if (e && e.postData && e.postData.contents) body = JSON.parse(e.postData.contents);
    return json(handleBooking(body));
  } catch (err) {
    return json({ ok: false, code: 'SERVER_ERROR', message: String((err && err.message) || err) });
  }
}

function json(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

// -------------------------------------------------------------- handlers --

function handleConfig() {
  var rules = getRules();
  var locations = [];
  for (var id in rules) {
    if (rules[id].active) locations.push({ id: id, label: rules[id].label });
  }
  return {
    ok: true,
    timezone: tz(),
    minNoticeHours: CONFIG.MIN_NOTICE_HOURS,
    horizonDays: CONFIG.HORIZON_DAYS,
    locations: locations
  };
}

/**
 * Which days in a month have at least one free slot. Powers the greyed-out
 * cells in the month grid. Calendar events and existing bookings for the whole
 * month are fetched once here rather than once per day.
 */
function handleDays(locationId, month) {
  var found = requireRule(locationId);
  if (found.error) return found.error;

  if (!/^\d{4}-\d{2}$/.test(String(month || ''))) {
    return { ok: false, code: 'BAD_MONTH', message: 'month must be YYYY-MM' };
  }

  var parts = String(month).split('-');
  var monthStart = new Date(Number(parts[0]), Number(parts[1]) - 1, 1, 0, 0, 0);
  var monthEnd = new Date(Number(parts[0]), Number(parts[1]), 1, 0, 0, 0);

  var ctx = buildContext(monthStart, monthEnd);

  var available = [];
  var cursor = new Date(monthStart.getTime());
  while (cursor < monthEnd) {
    if (slotsForDay(found.rule, cursor, ctx).length) available.push(dateKey(cursor));
    cursor = new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate() + 1, 0, 0, 0);
  }

  return {
    ok: true,
    month: month,
    location: locationId,
    availableDates: available,
    minDate: dateKey(new Date(ctx.now.getTime() + CONFIG.MIN_NOTICE_HOURS * 3600 * 1000)),
    maxDate: dateKey(new Date(ctx.now.getTime() + CONFIG.HORIZON_DAYS * 86400 * 1000))
  };
}

function handleSlots(locationId, dateStr) {
  var found = requireRule(locationId);
  if (found.error) return found.error;

  var day = parseDateKey(dateStr);
  if (!day) return { ok: false, code: 'BAD_DATE', message: 'date must be YYYY-MM-DD' };

  var dayEnd = new Date(day.getFullYear(), day.getMonth(), day.getDate() + 1, 0, 0, 0);
  var slots = slotsForDay(found.rule, day, buildContext(day, dayEnd));

  return {
    ok: true,
    date: dateStr,
    location: locationId,
    dateLabel: Utilities.formatDate(day, tz(), 'EEEE, MMMM d, yyyy'),
    slots: slots
  };
}

/**
 * Writes the booking. Everything after the lock is acquired is the critical
 * section: two people clicking the same slot a second apart would otherwise
 * both succeed.
 */
function handleBooking(body) {
  var clean = validateBooking(body);
  if (clean.error) return clean.error;
  var b = clean.value;

  var found = requireRule(b.location);
  if (found.error) return found.error;
  var rule = found.rule;

  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(20000);
  } catch (err) {
    return { ok: false, code: 'BUSY', message: 'Server is busy, please try again.' };
  }

  try {
    var start = new Date(b.ts);
    var dayStart = new Date(start.getFullYear(), start.getMonth(), start.getDate(), 0, 0, 0);
    var dayEnd = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 1, 0, 0, 0);

    // Re-derive the free slots and confirm the requested one is still among
    // them. This re-applies the gap and the daily cap as a side effect, so
    // there is one definition of "available" and the browser is never trusted.
    var slots = slotsForDay(rule, dayStart, buildContext(dayStart, dayEnd));
    var match = null;
    for (var i = 0; i < slots.length; i++) {
      if (slots[i].ts === b.ts) { match = slots[i]; break; }
    }
    if (!match) {
      return {
        ok: false,
        code: 'SLOT_TAKEN',
        message: 'That time is no longer available. Please pick another.'
      };
    }

    var end = new Date(b.ts + rule.slotMinutes * 60000);
    var created = createEvent(b, rule, start, end);

    appendBookingRow(b, rule, start, created);

    return {
      ok: true,
      eventId: created.eventId,
      meetLink: created.meetLink,
      dateLabel: Utilities.formatDate(start, tz(), 'EEEE, MMMM d, yyyy'),
      timeLabel: match.label
    };
  } finally {
    lock.releaseLock();
  }
}

// ------------------------------------------------------------ validation --

function validateBooking(body) {
  body = body || {};

  var name = String(body.name || '').trim();
  var email = String(body.email || '').trim();
  var discordId = String(body.discordId || '').trim().replace(/^@/, '');
  var notes = String(body.notes || '').trim();
  var location = String(body.location || '').trim();
  var ts = Number(body.ts);

  function bad(message) {
    return { error: { ok: false, code: 'VALIDATION', message: message } };
  }

  if (!name) return bad('Full name is required.');
  if (name.length > 120) return bad('That name is too long.');
  if (!email) return bad('Email is required.');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return bad('That email address does not look right.');
  if (!discordId) return bad('Discord ID is required.');
  if (!isDiscordId(discordId)) return bad('That Discord ID does not look right.');
  if (!location) return bad('Please choose a location.');
  if (!ts || !isFinite(ts)) return bad('Please choose a time slot.');
  if (notes.length > 2000) return bad('Please shorten your note.');

  return {
    value: {
      name: name,
      email: email,
      discordId: discordId,
      notes: notes,
      location: location,
      ts: ts
    }
  };
}

/**
 * Accepts both handle formats in circulation: the modern username
 * ("jandelacruz") and the legacy discriminator form ("JanDeLaCruz#1234").
 * Deliberately loose — this catches empty and obviously-wrong input, it is not
 * an existence check.
 */
function isDiscordId(value) {
  if (/^[A-Za-z0-9_.]{2,32}#\d{4}$/.test(value)) return true;
  return /^[a-z0-9_.]{2,32}$/.test(value);
}

// ------------------------------------------------------- slot generation --

/**
 * Everything a day's availability depends on, read once per request.
 * Reading the calendar and the Bookings tab per day would be far slower when
 * the month grid asks about thirty days at once.
 */
function buildContext(from, to) {
  var events = getEventsDetailed(from, to);
  var busy = [];
  var bookings = [];

  for (var i = 0; i < events.length; i++) {
    var ev = events[i];
    if (!ev.counted) continue;

    // Calls booked through this page are tagged when they are created, so they
    // can be told apart from anything else on the calendar. They are kept out
    // of `busy` because who they block depends on their location — see
    // slotsForDay. Everything else blocks every location outright.
    // A tagged booking with no location recorded cannot be attributed to one
    // interviewer, so it is treated as blocking everyone rather than nobody.
    if (ev.booking && ev.bookingLocation) {
      bookings.push({ start: ev.start, end: ev.end, location: ev.bookingLocation });
    } else {
      busy.push({ start: ev.start, end: ev.end });
    }
  }

  return {
    busy: busy,
    bookings: bookings,
    blocked: getBlockedDates(),
    now: new Date()
  };
}

/**
 * Every availability decision for a single day, in one place.
 * Returns [] for any day that is blocked, out of range, at its daily maximum,
 * or fully taken.
 */
function slotsForDay(rule, day, ctx) {
  var out = [];
  if (!rule || !rule.active || !rule.startTimes.length) return out;

  var key = dateKey(day);
  if (ctx.blocked[key] && (ctx.blocked[key].all || ctx.blocked[key][rule.location])) return out;
  if (rule.weekdays.indexOf(day.getDay()) === -1) return out;

  var earliest = new Date(ctx.now.getTime() + CONFIG.MIN_NOTICE_HOURS * 3600 * 1000);
  var latest = new Date(ctx.now.getTime() + CONFIG.HORIZON_DAYS * 86400 * 1000);
  if (day > latest) return out;

  // Which existing bookings this location has to work around. With separate
  // interviewers that is only its own; otherwise every booking is the same
  // person's hour.
  var rivals = CONFIG.LOCATIONS_BOOK_INDEPENDENTLY
    ? bookingsFor(ctx.bookings, rule.location)
    : ctx.bookings;

  // Daily maximum for this location. Counted per location, so Philippines and
  // Others each keep their own tally.
  if (rule.maxPerDay > 0 && countBookings(ctx.bookings, key, rule.location) >= rule.maxPerDay) {
    return out;
  }

  for (var i = 0; i < rule.startTimes.length; i++) {
    var m = rule.startTimes[i];
    var slotStart = new Date(day.getFullYear(), day.getMonth(), day.getDate(), Math.floor(m / 60), m % 60, 0);
    var slotEnd = new Date(slotStart.getTime() + rule.slotMinutes * 60000);

    if (slotStart < earliest) continue;
    if (slotStart > latest) continue;

    // Anything already on the calendar blocks the slot it actually covers.
    if (overlaps(slotStart, slotEnd, ctx.busy, CONFIG.GAP_AROUND_ALL_EVENTS ? rule.gapMinutes : 0)) continue;

    // Calls booked through this page also close the hour either side, so this
    // interviewer never runs two calls back to back.
    if (overlaps(slotStart, slotEnd, rivals, rule.gapMinutes)) continue;

    out.push({
      ts: slotStart.getTime(),
      label: Utilities.formatDate(slotStart, tz(), 'h:mm a z')
    });
  }

  return out;
}

/**
 * Does [start, end) hit any of these intervals, once each interval is widened
 * by padMinutes on both sides?
 *
 * With a 60-minute pad, a 2pm-3pm booking guards 1pm-4pm: the 1pm and 3pm
 * slots collide with it, while a 4pm slot starts exactly as the guard ends and
 * stays open.
 */
function overlaps(start, end, intervals, padMinutes) {
  var pad = (padMinutes || 0) * 60000;
  var s = start.getTime();
  var e = end.getTime();

  for (var i = 0; i < intervals.length; i++) {
    if (s < intervals[i].end.getTime() + pad && e > intervals[i].start.getTime() - pad) return true;
  }
  return false;
}

function bookingsFor(bookings, locationId) {
  var out = [];
  for (var i = 0; i < bookings.length; i++) {
    if (bookings[i].location === locationId) out.push(bookings[i]);
  }
  return out;
}

function countBookings(bookings, dayKey, locationId) {
  var n = 0;
  for (var i = 0; i < bookings.length; i++) {
    if (bookings[i].location === locationId && dateKey(bookings[i].start) === dayKey) n++;
  }
  return n;
}

/** Marks the events this page creates, so they can be recognised later. */
var BOOKING_TAG = 'lshBooking';
var BOOKING_LOCATION_TAG = 'lshLocation';

/**
 * Calendar events in [from, to) with the reasons they do or do not block a
 * slot, so diagnose() can explain itself and buildContext() can stay simple.
 *
 * Reads through the advanced Calendar service where it is available, because
 * CalendarApp does not expose an event's "Show as: Free / Busy" setting — an
 * event marked Free is deliberately on your calendar without being a conflict,
 * and should not remove a bookable hour.
 */
function getEventsDetailed(from, to) {
  var ids = [CONFIG.CALENDAR_ID].concat(CONFIG.BUSY_CALENDAR_IDS || []);
  var out = [];

  for (var i = 0; i < ids.length; i++) {
    var events = (typeof Calendar !== 'undefined' && Calendar.Events)
      ? eventsViaApi(ids[i], from, to)
      : eventsViaCalendarApp(ids[i], from, to);

    for (var e = 0; e < events.length; e++) {
      events[e].calendar = ids[i];
      out.push(events[e]);
    }
  }

  return out;
}

function eventsViaApi(calendarId, from, to) {
  var out = [];
  var pageToken = null;

  do {
    var res = Calendar.Events.list(calendarId, {
      timeMin: from.toISOString(),
      timeMax: to.toISOString(),
      singleEvents: true,      // expand recurring events into real occurrences
      showDeleted: false,
      maxResults: 250,
      pageToken: pageToken
    });

    var items = res.items || [];
    for (var i = 0; i < items.length; i++) {
      var ev = items[i];
      if (ev.status === 'cancelled') continue;

      var allDay = !!(ev.start && ev.start.date);
      var free = ev.transparency === 'transparent';
      var declined = isDeclined(ev);
      var props = (ev.extendedProperties && ev.extendedProperties.private) || {};
      var isBooking = props[BOOKING_TAG] === '1';
      var guestsOut = guestsDeclined(ev);
      var released = isBooking && guestsOut && CONFIG.RELEASE_ON_GUEST_DECLINE;

      out.push({
        title: ev.summary || '(no title)',
        start: new Date(allDay ? ev.start.date + 'T00:00:00' : ev.start.dateTime),
        end: new Date(allDay ? ev.end.date + 'T00:00:00' : ev.end.dateTime),
        allDay: allDay,
        free: free,
        declined: declined,
        guestsDeclined: guestsOut,
        booking: isBooking,
        bookingLocation: props[BOOKING_LOCATION_TAG] || '',
        counted: !free && !declined && !released && (!allDay || CONFIG.BLOCK_ON_ALL_DAY_EVENTS)
      });
    }

    pageToken = res.nextPageToken;
  } while (pageToken);

  return out;
}

/** Fallback for before the advanced Calendar service is switched on. */
function eventsViaCalendarApp(calendarId, from, to) {
  var events = getCalendar(calendarId).getEvents(from, to);
  var out = [];

  for (var i = 0; i < events.length; i++) {
    var ev = events[i];
    var allDay = ev.isAllDayEvent();
    var declined = ev.getMyStatus && ev.getMyStatus() === CalendarApp.GuestStatus.NO;

    out.push({
      title: ev.getTitle(),
      start: ev.getStartTime(),
      end: ev.getEndTime(),
      allDay: allDay,
      free: false,          // not visible through this API
      declined: declined,
      booking: false,       // nor are the tags, so no gap is applied here
      bookingLocation: '',
      counted: !declined && (!allDay || CONFIG.BLOCK_ON_ALL_DAY_EVENTS)
    });
  }

  return out;
}

/** Did you, the calendar owner, decline this invitation? */
function isDeclined(ev) {
  var attendees = ev.attendees || [];
  for (var i = 0; i < attendees.length; i++) {
    if (attendees[i].self && attendees[i].responseStatus === 'declined') return true;
  }
  return false;
}

/**
 * Did every invited guest say no? Organisers, resources and you are not
 * guests, so an event with nobody else on it never counts as declined.
 */
function guestsDeclined(ev) {
  var attendees = ev.attendees || [];
  var guests = 0;
  var noes = 0;

  for (var i = 0; i < attendees.length; i++) {
    var a = attendees[i];
    if (a.self || a.organizer || a.resource) continue;
    guests++;
    if (a.responseStatus === 'declined') noes++;
  }

  return guests > 0 && noes === guests;
}

function getCalendar(calendarId) {
  var id = calendarId || CONFIG.CALENDAR_ID;
  var cal = id === 'primary'
    ? CalendarApp.getDefaultCalendar()
    : CalendarApp.getCalendarById(id);
  if (!cal) throw new Error('Calendar not found: ' + id + ' — check the ID and that you can edit it.');
  return cal;
}

// ------------------------------------------------------ calendar writing --

/**
 * Prefers the advanced Calendar service so the event gets a real Meet link.
 * Falls back to CalendarApp if that service has not been enabled yet, so the
 * page still works before setup is finished — just without a Meet link.
 */
function createEvent(b, rule, start, end) {
  var title = rule.eventTitle.replace('{name}', b.name);
  var description = [
    'Name: ' + b.name,
    'Email: ' + b.email,
    'Discord: ' + b.discordId,
    'Location: ' + rule.label,
    '',
    b.notes ? 'Notes:\n' + b.notes : 'Notes: none'
  ].join('\n');

  if (typeof Calendar !== 'undefined' && Calendar.Events) {
    var resource = {
      summary: title,
      description: description,
      start: { dateTime: isoWithOffset(start), timeZone: tz() },
      end: { dateTime: isoWithOffset(end), timeZone: tz() },
      attendees: [{ email: b.email, displayName: b.name }],
      conferenceData: {
        createRequest: {
          requestId: Utilities.getUuid(),
          conferenceSolutionKey: { type: 'hangoutsMeet' }
        }
      },
      // Tagged so availability can recognise its own bookings and give them a
      // gap either side. Invisible to anyone reading the calendar.
      extendedProperties: {
        'private': (function () {
          var p = {};
          p[BOOKING_TAG] = '1';
          p[BOOKING_LOCATION_TAG] = b.location;
          return p;
        })()
      }
    };

    var created = Calendar.Events.insert(resource, CONFIG.CALENDAR_ID, {
      conferenceDataVersion: 1,
      sendUpdates: 'all'
    });

    return { eventId: created.id, meetLink: created.hangoutLink || '' };
  }

  var ev = getCalendar().createEvent(title, start, end, {
    description: description,
    guests: b.email,
    sendInvites: true
  });

  return { eventId: ev.getId(), meetLink: '' };
}

// --------------------------------------------------------- sheet reading --

/** Settings tab to { locationId: rule }. Falls back to CONFIG defaults. */
function getRules() {
  var rows = readTab(SHEETS.SETTINGS);
  if (!rows.length) rows = CONFIG.DEFAULT_LOCATIONS;

  var rules = {};
  for (var i = 0; i < rows.length; i++) {
    var r = rows[i];
    var id = String(r.location || '').trim();
    if (!id) continue;

    var slotMinutes = Number(r.slot_minutes) || 60;

    rules[id] = {
      location: id,
      label: String(r.label || id).trim(),
      startTimes: parseStartTimes(r.start_times, r.start_hour, r.end_hour, slotMinutes),
      slotMinutes: slotMinutes,
      gapMinutes: r.gap_minutes === '' || r.gap_minutes == null ? 0 : Number(r.gap_minutes) || 0,
      weekdays: parseWeekdays(r.weekdays),
      maxPerDay: Number(r.max_per_day) || 0,
      eventTitle: String(r.event_title || '').trim() || CONFIG.EVENT_TITLE,
      active: isTrue(r.active)
    };
  }

  return rules;
}

/**
 * "8,9,10,11,13,14,15,16" to minutes past midnight. Also accepts "8:30".
 *
 * Falls back to the older start_hour/end_hour pair so a Settings tab created
 * before this column existed keeps working until it is upgraded.
 */
function parseStartTimes(value, fallbackStart, fallbackEnd, slotMinutes) {
  var text = String(value == null ? '' : value).trim();
  var out = [];

  if (text) {
    var parts = text.split(',');
    for (var i = 0; i < parts.length; i++) {
      var bit = parts[i].trim();
      if (!bit) continue;

      var hm = bit.split(':');
      var h = Number(hm[0]);
      var m = hm.length > 1 ? Number(hm[1]) : 0;
      if (!isFinite(h) || !isFinite(m) || h < 0 || h > 23 || m < 0 || m > 59) continue;

      var mins = h * 60 + m;
      if (out.indexOf(mins) === -1) out.push(mins);
    }
  } else {
    var s = Number(fallbackStart);
    var e = Number(fallbackEnd);
    if (isFinite(s) && isFinite(e) && slotMinutes > 0) {
      for (var t = s * 60; t + slotMinutes <= e * 60; t += slotMinutes) out.push(t);
    }
  }

  out.sort(function (a, b) { return a - b; });
  return out;
}

function requireRule(locationId) {
  var rules = getRules();
  var rule = rules[String(locationId || '').trim()];
  if (!rule || !rule.active) {
    return { error: { ok: false, code: 'BAD_LOCATION', message: 'Unknown location: ' + locationId } };
  }
  return { rule: rule };
}

/** BlockedDates tab to { 'YYYY-MM-DD': { all: true } or { philippines: true } }. */
function getBlockedDates() {
  var rows = readTab(SHEETS.BLOCKED);
  var map = {};

  for (var i = 0; i < rows.length; i++) {
    var raw = rows[i].date;
    if (!raw) continue;

    var key = (raw instanceof Date)
      ? Utilities.formatDate(raw, tz(), 'yyyy-MM-dd')
      : String(raw).trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) continue;

    var scope = String(rows[i].location || 'all').trim().toLowerCase() || 'all';
    if (!map[key]) map[key] = {};
    map[key][scope] = true;
  }

  return map;
}

/** Reads a tab as objects keyed by its header row. Returns [] if absent. */
function readTab(name) {
  var sheet = SpreadsheetApp.getActive().getSheetByName(name);
  if (!sheet) return [];

  var values = sheet.getDataRange().getValues();
  if (values.length < 2) return [];

  var headers = values[0].map(function (h) { return String(h).trim().toLowerCase(); });
  var out = [];

  for (var r = 1; r < values.length; r++) {
    var row = {};
    var empty = true;
    for (var c = 0; c < headers.length; c++) {
      if (!headers[c]) continue;
      row[headers[c]] = values[r][c];
      if (values[r][c] !== '' && values[r][c] !== null) empty = false;
    }
    if (!empty) out.push(row);
  }

  return out;
}

function appendBookingRow(b, rule, start, created) {
  var ss = SpreadsheetApp.getActive();
  var sheet = ss.getSheetByName(SHEETS.BOOKINGS) || createTab(ss, SHEETS.BOOKINGS, BOOKING_HEADERS);

  sheet.appendRow([
    new Date(),
    b.name,
    b.email,
    b.discordId,
    b.location,
    Utilities.formatDate(start, tz(), 'yyyy-MM-dd'),
    Utilities.formatDate(start, tz(), 'h:mm a z'),
    start.getTime(),
    rule.slotMinutes,
    b.notes,
    created.eventId,
    created.meetLink,
    'confirmed'
  ]);
}

// -------------------------------------------------------------- utilities --

function dateKey(d) {
  return Utilities.formatDate(d, tz(), 'yyyy-MM-dd');
}

function parseDateKey(s) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(s || ''))) return null;
  var p = String(s).split('-');
  return new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]), 0, 0, 0);
}

/** e.g. 2026-09-11T13:00:00-04:00 — what the advanced Calendar API wants. */
function isoWithOffset(d) {
  return Utilities.formatDate(d, tz(), "yyyy-MM-dd'T'HH:mm:ssXXX");
}

var DAY_INDEX = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 };

function parseWeekdays(value) {
  var text = String(value == null ? '' : value).trim();
  if (!text) return [1, 2, 3, 4, 5];

  var out = [];
  var parts = text.split(',');
  for (var i = 0; i < parts.length; i++) {
    var key = parts[i].trim().slice(0, 3).toLowerCase();
    if (DAY_INDEX.hasOwnProperty(key) && out.indexOf(DAY_INDEX[key]) === -1) {
      out.push(DAY_INDEX[key]);
    }
  }
  return out;
}

function isTrue(value) {
  if (value === true) return true;
  var s = String(value == null ? '' : value).trim().toLowerCase();
  return s === 'true' || s === 'yes' || s === 'y' || s === '1';
}

// --------------------------------------------------------- keeping in sync --

/**
 * Adds a Bookings menu to the spreadsheet. Runs automatically when the sheet
 * is opened.
 */
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('Bookings')
    .addItem('Refresh statuses now', 'syncBookingStatuses')
    .addItem('Refresh automatically every 15 minutes', 'installSyncTrigger')
    .addToUi();
}

/**
 * Brings every row's status column into line with what the calendar says:
 *
 *   confirmed — the event is there and nobody has declined
 *   declined  — the guest said no
 *   cancelled — the event has been deleted from the calendar
 *
 * The sheet is a record, not the thing that decides availability, so this is
 * about the log reading true. Safe to run as often as you like.
 */
function syncBookingStatuses() {
  var sheet = SpreadsheetApp.getActive().getSheetByName(SHEETS.BOOKINGS);
  if (!sheet) return 0;

  var values = sheet.getDataRange().getValues();
  if (values.length < 2) return 0;

  var headers = values[0].map(function (h) { return String(h).trim().toLowerCase(); });
  var idCol = headers.indexOf('event_id');
  var statusCol = headers.indexOf('status');
  if (idCol === -1 || statusCol === -1) return 0;

  var changed = 0;
  for (var r = 1; r < values.length; r++) {
    var eventId = String(values[r][idCol] || '').trim();
    if (!eventId) continue;

    var was = String(values[r][statusCol] || '').trim().toLowerCase();
    var now = eventStatus(eventId);
    if (now && now !== was) {
      sheet.getRange(r + 1, statusCol + 1).setValue(now);
      changed++;
    }
  }

  SpreadsheetApp.getActive().toast(
    changed ? changed + ' row(s) updated.' : 'Everything was already up to date.',
    'Booking statuses',
    5
  );
  return changed;
}

function eventStatus(eventId) {
  // CalendarApp ids carry an @google.com suffix the API does not want.
  var id = String(eventId).split('@')[0];

  if (typeof Calendar === 'undefined' || !Calendar.Events) return '';

  try {
    var ev = Calendar.Events.get(CONFIG.CALENDAR_ID, id);
    if (!ev || ev.status === 'cancelled') return 'cancelled';
    if (guestsDeclined(ev)) return 'declined';
    return 'confirmed';
  } catch (err) {
    // A deleted event returns 404 rather than a cancelled record.
    return 'cancelled';
  }
}

/** Runs syncBookingStatuses() every 15 minutes. Replaces any existing one. */
function installSyncTrigger() {
  var triggers = ScriptApp.getProjectTriggers();
  for (var i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === 'syncBookingStatuses') {
      ScriptApp.deleteTrigger(triggers[i]);
    }
  }

  ScriptApp.newTrigger('syncBookingStatuses').timeBased().everyMinutes(15).create();
  SpreadsheetApp.getActive().toast('Statuses will refresh every 15 minutes.', 'Auto-refresh on', 5);
}

// ------------------------------------------------------------ diagnostics --

/**
 * Prints why a given day offers the slots it does. Run it from the editor and
 * read the execution log — it needs no deployment, so a save is enough.
 *
 * Change these two lines to inspect a different day.
 */
function diagnose() {
  var DATE = '2026-09-29';
  var LOCATION = 'others';

  var day = parseDateKey(DATE);
  var dayEnd = new Date(day.getFullYear(), day.getMonth(), day.getDate() + 1, 0, 0, 0);

  Logger.log('--- config ---');
  Logger.log('CONFIG.TIMEZONE      : ' + CONFIG.TIMEZONE);
  Logger.log('script timezone      : ' + Session.getScriptTimeZone());
  Logger.log('GAP_AROUND_ALL_EVENTS: ' + CONFIG.GAP_AROUND_ALL_EVENTS);

  Logger.log('--- settings tab, as read ---');
  var raw = readTab(SHEETS.SETTINGS);
  for (var i = 0; i < raw.length; i++) {
    Logger.log(JSON.stringify(raw[i]));
  }

  var rule = getRules()[LOCATION];
  if (!rule) {
    Logger.log('!! no rule found for location "' + LOCATION + '"');
    return;
  }

  Logger.log('--- parsed rule for ' + LOCATION + ' ---');
  Logger.log('start times : ' + rule.startTimes.map(minutesToLabel).join(', '));
  Logger.log('slot minutes: ' + rule.slotMinutes + '   gap: ' + rule.gapMinutes);
  Logger.log('weekdays    : ' + rule.weekdays.join(',') + '   max/day: ' + rule.maxPerDay);
  Logger.log('active      : ' + rule.active);

  Logger.log('--- calendar events on ' + DATE + ' ---');
  var events = getEventsDetailed(day, dayEnd);
  if (!events.length) Logger.log('(none)');
  for (var e = 0; e < events.length; e++) {
    var ev = events[e];
    var why = [];
    if (ev.allDay) why.push('all day');
    if (ev.free) why.push('shown as Free');
    if (ev.declined) why.push('you declined');
    if (ev.guestsDeclined) why.push('guest declined');
    if (ev.booking) why.push('booked here');

    Logger.log(
      Utilities.formatDate(ev.start, tz(), 'h:mm a') + ' - ' +
      Utilities.formatDate(ev.end, tz(), 'h:mm a') +
      '  |  ' + ev.title +
      (why.length ? '  [' + why.join(', ') + ']' : '') +
      '  [blocks slots: ' + (ev.counted ? 'yes' : 'no') + ']' +
      '  [from: ' + shortCalendarName(ev.calendar) + ']'
    );
  }

  var ctx = buildContext(day, dayEnd);

  Logger.log('--- calls booked through the page (these get a gap) ---');
  if (!ctx.bookings.length) Logger.log('(none)');
  for (var b = 0; b < ctx.bookings.length; b++) {
    Logger.log(
      Utilities.formatDate(ctx.bookings[b].start, tz(), 'h:mm a') +
      '  ' + (ctx.bookings[b].location || '(location not tagged)')
    );
  }

  Logger.log('--- verdict per start time ---');
  var earliest = new Date(ctx.now.getTime() + CONFIG.MIN_NOTICE_HOURS * 3600 * 1000);
  var latest = new Date(ctx.now.getTime() + CONFIG.HORIZON_DAYS * 86400 * 1000);

  for (var s = 0; s < rule.startTimes.length; s++) {
    var m = rule.startTimes[s];
    var slotStart = new Date(day.getFullYear(), day.getMonth(), day.getDate(), Math.floor(m / 60), m % 60, 0);
    var slotEnd = new Date(slotStart.getTime() + rule.slotMinutes * 60000);

    var why = 'OPEN';
    if (slotStart < earliest) why = 'too soon (inside the ' + CONFIG.MIN_NOTICE_HOURS + 'h notice)';
    else if (slotStart > latest) why = 'beyond the ' + CONFIG.HORIZON_DAYS + '-day horizon';
    else if (overlaps(slotStart, slotEnd, ctx.busy, CONFIG.GAP_AROUND_ALL_EVENTS ? rule.gapMinutes : 0)) why = 'blocked by a calendar event';
    else if (overlaps(slotStart, slotEnd, ctx.bookings, rule.gapMinutes)) why = 'blocked by a booking or its gap';

    Logger.log(minutesToLabel(m) + '  ->  ' + why);
  }
}

/** Calendar ids are long; the leading chunk is enough to tell them apart. */
function shortCalendarName(id) {
  if (!id || id === 'primary') return 'primary';
  return String(id).split('@')[0].slice(0, 12) + '…';
}

function minutesToLabel(m) {
  var h = Math.floor(m / 60);
  var mm = m % 60;
  var ampm = h < 12 ? 'AM' : 'PM';
  var h12 = h % 12 === 0 ? 12 : h % 12;
  return h12 + ':' + (mm < 10 ? '0' + mm : mm) + ' ' + ampm;
}

// ------------------------------------------------------------------ setup --

/**
 * Run once on a fresh spreadsheet. Creates the three tabs with their headers
 * and seeds the default availability rules. Safe to re-run: existing tabs are
 * left alone.
 */
function setup() {
  var ss = SpreadsheetApp.getActive();

  if (!ss.getSheetByName(SHEETS.SETTINGS)) writeSettingsTab(ss);
  if (!ss.getSheetByName(SHEETS.BLOCKED)) createTab(ss, SHEETS.BLOCKED, BLOCKED_HEADERS);
  if (!ss.getSheetByName(SHEETS.BOOKINGS)) createTab(ss, SHEETS.BOOKINGS, BOOKING_HEADERS);

  ss.toast('Booking tabs are ready.', 'Setup complete', 5);
}

/**
 * Rebuilds the Settings tab with the current columns and re-seeds the default
 * rules, and brings the Bookings header row up to date.
 *
 * Run this after pasting in a version of the script that changed the columns.
 * It replaces the Settings tab wholesale, so any hand-edits there are lost —
 * note them down first. Booking rows are never touched.
 */
function upgradeSettings() {
  var ss = SpreadsheetApp.getActive();
  assertConfigCurrent();

  // Carry across whatever is already there. Only columns that did not exist
  // before are filled from the defaults, so hand-edited hours survive.
  var rows = mergeSettingsRows(readTab(SHEETS.SETTINGS));

  // Build the replacement under a temporary name and only drop the old tab
  // once it exists. Deleting first would leave no Settings tab at all if the
  // write failed halfway.
  var fresh = writeSettingsTab(ss, SHEETS.SETTINGS + ' (new)', rows);
  var old = ss.getSheetByName(SHEETS.SETTINGS);
  if (old) ss.deleteSheet(old);
  fresh.setName(SHEETS.SETTINGS);

  var bookings = ss.getSheetByName(SHEETS.BOOKINGS);
  if (!bookings) {
    createTab(ss, SHEETS.BOOKINGS, BOOKING_HEADERS);
  } else {
    bookings.getRange(1, 1, 1, BOOKING_HEADERS.length)
      .setValues([BOOKING_HEADERS])
      .setFontWeight('bold');
  }

  if (!ss.getSheetByName(SHEETS.BLOCKED)) createTab(ss, SHEETS.BLOCKED, BLOCKED_HEADERS);

  ss.toast('Settings rebuilt with the current columns.', 'Upgrade complete', 6);
}

/**
 * Code.gs and Config.gs are pasted in separately, so it is easy to update one
 * and forget the other. That mismatch used to surface as "the number of
 * columns in the data does not match the number of columns in the range",
 * which says nothing useful. Fail early with something actionable instead.
 */
function assertConfigCurrent() {
  var required = ['start_times', 'gap_minutes', 'max_per_day', 'event_title'];
  var missing = [];

  for (var i = 0; i < required.length; i++) {
    if (SETTINGS_HEADERS.indexOf(required[i]) === -1) missing.push(required[i]);
  }

  if (missing.length) {
    throw new Error(
      'Config.gs is out of date — it is missing: ' + missing.join(', ') + '. ' +
      'Paste the latest Config.gs into the editor, save, then run this again.'
    );
  }
}

/**
 * Existing Settings rows, widened to the current columns. A value already in
 * the sheet always wins; a column that did not exist before is filled from the
 * defaults for that location. A blank cell stays blank, since blank is
 * meaningful for max_per_day.
 */
function mergeSettingsRows(existing) {
  if (!existing.length) return defaultSettingsRows();

  var defaults = {};
  for (var d = 0; d < CONFIG.DEFAULT_LOCATIONS.length; d++) {
    defaults[CONFIG.DEFAULT_LOCATIONS[d].location] = CONFIG.DEFAULT_LOCATIONS[d];
  }

  var rows = [];
  for (var i = 0; i < existing.length; i++) {
    var was = existing[i];
    var fallback = defaults[String(was.location || '').trim()] || {};

    var row = [];
    for (var c = 0; c < SETTINGS_HEADERS.length; c++) {
      var key = SETTINGS_HEADERS[c];
      // undefined means the column is new; '' means someone cleared the cell.
      row.push(was[key] !== undefined ? was[key] : (fallback[key] !== undefined ? fallback[key] : ''));
    }
    rows.push(row);
  }

  return rows;
}

function defaultSettingsRows() {
  return CONFIG.DEFAULT_LOCATIONS.map(function (r) {
    return SETTINGS_HEADERS.map(function (h) {
      return r[h] !== undefined ? r[h] : '';
    });
  });
}

function writeSettingsTab(ss, name, rows) {
  var sheet = createTab(ss, name || SHEETS.SETTINGS, SETTINGS_HEADERS);
  rows = rows || defaultSettingsRows();

  // start_times, weekdays and event_title are free text — keep Sheets from
  // reformatting them into numbers or dates.
  var textColumns = ['start_times', 'weekdays', 'event_title'];
  for (var t = 0; t < textColumns.length; t++) {
    var col = SETTINGS_HEADERS.indexOf(textColumns[t]) + 1;
    if (col > 0) sheet.getRange(2, col, rows.length, 1).setNumberFormat('@');
  }

  sheet.getRange(2, 1, rows.length, SETTINGS_HEADERS.length).setValues(rows);
  sheet.autoResizeColumns(1, SETTINGS_HEADERS.length);

  return sheet;
}

function createTab(ss, name, headers) {
  var sheet = ss.insertSheet(name);
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight('bold');
  sheet.setFrozenRows(1);
  sheet.autoResizeColumns(1, headers.length);
  return sheet;
}
