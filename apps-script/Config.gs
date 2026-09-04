/**
 * Config.gs — knobs that change rarely.
 *
 * Anything you expect to tweak often (the times you offer, the gap between
 * calls, the daily maximum, days off) lives in the spreadsheet instead, on the
 * "Settings" and "BlockedDates" tabs. Run setup() once from the editor to
 * create those tabs.
 */

var CONFIG = {
  // Must match the timeZone in appsscript.json. Every Date in this project is
  // constructed and formatted in this zone.
  TIMEZONE: 'America/New_York',

  /**
   * Where bookings are written, and the only calendar checked for conflicts.
   *
   * This is the "HR Calendar", kept separate from the primary calendar so
   * personal reminders and all-day markers do not eat bookable hours. The
   * flip side is that meetings on the primary calendar no longer block
   * bookings — see BUSY_CALENDAR_IDS below.
   *
   * 'primary' would mean the calendar of whoever deployed the script.
   */
  CALENDAR_ID: 'c_597677ca4b68e6dafed3322f99185cbccf0ed15dc2a37538bf15443f7120632d@group.calendar.google.com',

  /**
   * Extra calendars checked for conflicts but never written to. Nothing is
   * booked over a busy hour on these, but no booking ever lands on them.
   *
   * Add 'primary' here to keep your own meetings from being double-booked
   * while bookings still go to the HR Calendar. Leave empty to check only
   * CALENDAR_ID.
   */
  BUSY_CALENDAR_IDS: [],

  // How far ahead someone must book. 24 = no same-day surprises.
  MIN_NOTICE_HOURS: 24,

  // How far into the future the calendar opens up.
  HORIZON_DAYS: 60,

  // {name} is replaced with the guest's full name.
  EVENT_TITLE: 'Call — {name}',

  // All-day events (birthdays, OOO markers) usually shouldn't wipe out a whole
  // day of slots. Flip to true if you use them as real blockers.
  BLOCK_ON_ALL_DAY_EVENTS: false,

  /**
   * Whether the breathing-room gap applies to everything on your calendar, or
   * only to calls booked through this page.
   *
   * false (default): an unrelated 10am internal meeting blocks only the 10am
   * slot. A call booked here at 10am also closes 9am and 11am.
   *
   * true: every meeting on your calendar closes the hour either side of it.
   * Guarantees breathing room around everything, but a busy calendar will
   * leave very few slots open.
   */
  GAP_AROUND_ALL_EVENTS: false,

  // Used only if the Settings tab is missing or empty.
  DEFAULT_LOCATIONS: [
    {
      location: 'philippines',
      label: 'Philippines',
      start_times: '13,14,15,16',
      slot_minutes: 60,
      gap_minutes: 60,
      weekdays: 'Mon,Tue,Wed,Thu,Fri',
      max_per_day: '',
      active: true
    },
    {
      location: 'others',
      label: 'Others',
      start_times: '8,9,10,11,13,14,15,16',
      slot_minutes: 60,
      gap_minutes: 60,
      weekdays: 'Mon,Tue,Wed,Thu,Fri',
      max_per_day: 4,
      active: true
    }
  ]
};

var SHEETS = {
  SETTINGS: 'Settings',
  BLOCKED: 'BlockedDates',
  BOOKINGS: 'Bookings'
};

var SETTINGS_HEADERS = [
  'location', 'label', 'start_times', 'slot_minutes',
  'gap_minutes', 'weekdays', 'max_per_day', 'active'
];

var BLOCKED_HEADERS = ['date', 'location', 'reason'];

var BOOKING_HEADERS = [
  'timestamp', 'name', 'email', 'discord_id', 'location',
  'date_est', 'time_est', 'start_ts', 'duration_min', 'notes',
  'event_id', 'meet_link', 'status'
];
