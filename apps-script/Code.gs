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
 * cells in the month grid. Calendar events for the whole month are fetched
 * once here rather than once per day.
 */
function handleDays(locationId, month) {
  var found = requireRule(locationId);
  if (found.error) return found.error;

  if (!/^\d{4}-\d{2}$/.test(String(month || ''))) {
    return { ok: false, code: 'BAD_MONTH', message: 'month must be YYYY-MM' };
  }

  var parts = String(month).split('-');
  var year = Number(parts[0]);
  var mon = Number(parts[1]);

  var monthStart = new Date(year, mon - 1, 1, 0, 0, 0);
  var monthEnd = new Date(year, mon, 1, 0, 0, 0);

  var busy = getBusy(monthStart, monthEnd);
  var blocked = getBlockedDates();
  var now = new Date();

  var available = [];
  var cursor = new Date(monthStart.getTime());
  while (cursor < monthEnd) {
    if (slotsForDay(found.rule, cursor, busy, blocked, now).length) {
      available.push(dateKey(cursor));
    }
    cursor = new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate() + 1, 0, 0, 0);
  }

  return {
    ok: true,
    month: month,
    location: locationId,
    availableDates: available,
    minDate: dateKey(new Date(now.getTime() + CONFIG.MIN_NOTICE_HOURS * 3600 * 1000)),
    maxDate: dateKey(new Date(now.getTime() + CONFIG.HORIZON_DAYS * 86400 * 1000))
  };
}

function handleSlots(locationId, dateStr) {
  var found = requireRule(locationId);
  if (found.error) return found.error;

  var day = parseDateKey(dateStr);
  if (!day) return { ok: false, code: 'BAD_DATE', message: 'date must be YYYY-MM-DD' };

  var dayEnd = new Date(day.getFullYear(), day.getMonth(), day.getDate() + 1, 0, 0, 0);
  var slots = slotsForDay(found.rule, day, getBusy(day, dayEnd), getBlockedDates(), new Date());

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
    // them. Never trust the ts the browser sent.
    var slots = slotsForDay(rule, dayStart, getBusy(dayStart, dayEnd), getBlockedDates(), new Date());
    var match = null;
    for (var i = 0; i < slots.length; i++) {
      if (slots[i].ts === b.ts) { match = slots[i]; break; }
    }
    if (!match) {
      return { ok: false, code: 'SLOT_TAKEN', message: 'That time was just taken. Please pick another.' };
    }

    var end = new Date(b.ts + rule.slot_minutes * 60000);
    var created = createEvent(b, start, end);

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
 * Every availability decision for a single day, in one place.
 * Returns [] for any day that is blocked, out of range, or fully booked.
 */
function slotsForDay(rule, day, busy, blocked, now) {
  var out = [];
  if (!rule || !rule.active) return out;

  var key = dateKey(day);
  if (blocked[key] && (blocked[key].all || blocked[key][rule.location])) return out;
  if (rule.weekdays.indexOf(day.getDay()) === -1) return out;

  var earliest = new Date(now.getTime() + CONFIG.MIN_NOTICE_HOURS * 3600 * 1000);
  var latest = new Date(now.getTime() + CONFIG.HORIZON_DAYS * 86400 * 1000);
  if (day > latest) return out;

  var startMin = rule.start_hour * 60;
  var endMin = rule.end_hour * 60;
  var step = rule.slot_minutes;
  if (!(step > 0) || !(endMin > startMin)) return out;

  for (var m = startMin; m + step <= endMin; m += step) {
    var slotStart = new Date(day.getFullYear(), day.getMonth(), day.getDate(), Math.floor(m / 60), m % 60, 0);
    var slotEnd = new Date(slotStart.getTime() + step * 60000);

    if (slotStart < earliest) continue;
    if (slotStart > latest) continue;
    if (overlapsBusy(slotStart, slotEnd, busy)) continue;

    out.push({
      ts: slotStart.getTime(),
      label: Utilities.formatDate(slotStart, tz(), 'h:mm a z')
    });
  }

  return out;
}

function overlapsBusy(start, end, busy) {
  for (var i = 0; i < busy.length; i++) {
    if (start < busy[i].end && end > busy[i].start) return true;
  }
  return false;
}

/** Existing events in [from, to), reduced to plain busy intervals. */
function getBusy(from, to) {
  var cal = getCalendar();
  var events = cal.getEvents(from, to);
  var busy = [];

  for (var i = 0; i < events.length; i++) {
    var ev = events[i];
    if (!CONFIG.BLOCK_ON_ALL_DAY_EVENTS && ev.isAllDayEvent()) continue;
    // An event you declined is not a real conflict.
    if (ev.getMyStatus && ev.getMyStatus() === CalendarApp.GuestStatus.NO) continue;
    busy.push({ start: ev.getStartTime(), end: ev.getEndTime() });
  }

  return busy;
}

function getCalendar() {
  var cal = CONFIG.CALENDAR_ID === 'primary'
    ? CalendarApp.getDefaultCalendar()
    : CalendarApp.getCalendarById(CONFIG.CALENDAR_ID);
  if (!cal) throw new Error('Calendar not found: ' + CONFIG.CALENDAR_ID);
  return cal;
}

// ------------------------------------------------------ calendar writing --

/**
 * Prefers the advanced Calendar service so the event gets a real Meet link.
 * Falls back to CalendarApp if that service has not been enabled yet, so the
 * page still works before setup is finished — just without a Meet link.
 */
function createEvent(b, start, end) {
  var rules = getRules();
  var locationLabel = (rules[b.location] && rules[b.location].label) || b.location;

  var title = CONFIG.EVENT_TITLE.replace('{name}', b.name);
  var description = [
    'Name: ' + b.name,
    'Email: ' + b.email,
    'Discord: ' + b.discordId,
    'Location: ' + locationLabel,
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

    rules[id] = {
      location: id,
      label: String(r.label || id).trim(),
      start_hour: Number(r.start_hour),
      end_hour: Number(r.end_hour),
      slot_minutes: Number(r.slot_minutes) || 60,
      weekdays: parseWeekdays(r.weekdays),
      active: isTrue(r.active)
    };
  }

  return rules;
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
  var rules = getRules();

  sheet.appendRow([
    new Date(),
    b.name,
    b.email,
    b.discordId,
    (rules[b.location] && rules[b.location].label) || b.location,
    Utilities.formatDate(start, tz(), 'yyyy-MM-dd'),
    Utilities.formatDate(start, tz(), 'h:mm a z'),
    rule.slot_minutes,
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

// ------------------------------------------------------------------ setup --

/**
 * Run once from the editor. Creates the three tabs with their headers and
 * seeds the default availability rules. Safe to re-run: existing tabs are
 * left alone.
 */
function setup() {
  var ss = SpreadsheetApp.getActive();

  if (!ss.getSheetByName(SHEETS.SETTINGS)) {
    var settings = createTab(ss, SHEETS.SETTINGS, SETTINGS_HEADERS);
    var defaults = CONFIG.DEFAULT_LOCATIONS.map(function (r) {
      return [r.location, r.label, r.start_hour, r.end_hour, r.slot_minutes, r.weekdays, r.active];
    });
    settings.getRange(2, 1, defaults.length, SETTINGS_HEADERS.length).setValues(defaults);
  }

  if (!ss.getSheetByName(SHEETS.BLOCKED)) {
    createTab(ss, SHEETS.BLOCKED, BLOCKED_HEADERS);
  }

  if (!ss.getSheetByName(SHEETS.BOOKINGS)) {
    createTab(ss, SHEETS.BOOKINGS, BOOKING_HEADERS);
  }

  ss.toast('Booking tabs are ready.', 'Setup complete', 5);
}

function createTab(ss, name, headers) {
  var sheet = ss.insertSheet(name);
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight('bold');
  sheet.setFrozenRows(1);
  sheet.autoResizeColumns(1, headers.length);
  return sheet;
}
