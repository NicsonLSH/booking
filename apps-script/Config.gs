/**
 * Config.gs — knobs that change rarely.
 *
 * Anything you expect to tweak often (hours, weekdays, blocked days) lives in
 * the spreadsheet instead, on the "Settings" and "BlockedDates" tabs. Run
 * setup() once from the editor to create those tabs.
 */

var CONFIG = {
  // Must match the timeZone in appsscript.json. Every Date in this project is
  // constructed and formatted in this zone.
  TIMEZONE: 'America/New_York',

  // 'primary' means the calendar of whoever deployed the script.
  CALENDAR_ID: 'primary',

  // How far ahead someone must book. 24 = no same-day surprises.
  MIN_NOTICE_HOURS: 24,

  // How far into the future the calendar opens up.
  HORIZON_DAYS: 60,

  // {name} is replaced with the guest's full name.
  EVENT_TITLE: 'Call — {name}',

  // All-day events (birthdays, OOO markers) usually shouldn't wipe out a whole
  // day of slots. Flip to true if you use them as real blockers.
  BLOCK_ON_ALL_DAY_EVENTS: false,

  // Used only if the Settings tab is missing or empty.
  DEFAULT_LOCATIONS: [
    { location: 'philippines', label: 'Philippines', start_hour: 13, end_hour: 17, slot_minutes: 60, weekdays: 'Mon,Tue,Wed,Thu,Fri', active: true },
    { location: 'others',      label: 'Others',      start_hour: 8,  end_hour: 17, slot_minutes: 60, weekdays: 'Mon,Tue,Wed,Thu,Fri', active: true }
  ]
};

var SHEETS = {
  SETTINGS: 'Settings',
  BLOCKED: 'BlockedDates',
  BOOKINGS: 'Bookings'
};

var SETTINGS_HEADERS = ['location', 'label', 'start_hour', 'end_hour', 'slot_minutes', 'weekdays', 'active'];
var BLOCKED_HEADERS = ['date', 'location', 'reason'];
var BOOKING_HEADERS = [
  'timestamp', 'name', 'email', 'discord_id', 'location',
  'date_est', 'time_est', 'duration_min', 'notes',
  'event_id', 'meet_link', 'status'
];
