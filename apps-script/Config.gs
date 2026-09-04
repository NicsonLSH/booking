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
   * The HR Calendar — where bookings are written, and the only calendar
   * consulted for conflicts.
   *
   * Deliberately not the primary calendar: availability is decided by the HR
   * Calendar alone, so personal reminders, all-day markers and internal
   * meetings elsewhere neither remove nor protect bookable hours. If an hour
   * is free on the HR Calendar, it can be booked.
   */
  CALENDAR_ID: 'c_597677ca4b68e6dafed3322f99185cbccf0ed15dc2a37538bf15443f7120632d@group.calendar.google.com',

  /**
   * Extra calendars to check for conflicts but never write to.
   *
   * Intentionally empty: only the HR Calendar decides availability. Adding
   * 'primary' here would let meetings on the primary calendar block bookings
   * too — that was considered and turned down.
   */
  BUSY_CALENDAR_IDS: [],

  // How far ahead someone must book. 24 = no same-day surprises.
  MIN_NOTICE_HOURS: 24,

  // How far into the future the calendar opens up.
  HORIZON_DAYS: 60,

  // Fallback event title, used only if a location has no event_title set in
  // the Settings tab. {name} is replaced with the guest's full name.
  EVENT_TITLE: 'Call — {name}',

  /**
   * When the person who booked declines the invitation, reopen their slot so
   * someone else can take it. The event stays on the calendar until you delete
   * it — this only stops it holding the hour.
   *
   * Set to false if a declined call should keep its time reserved.
   */
  RELEASE_ON_GUEST_DECLINE: true,

  /**
   * Whether each location keeps its own diary.
   *
   * true: Billy and Charly are different interviewers, so both can be booked
   * for 1pm on the same day. A booking only closes slots — and only spends its
   * gap — within its own location.
   *
   * false: every booking is the same person's hour, so a Philippines call at
   * 1pm also closes 1pm for Others.
   *
   * Either way, anything on the calendar that was not booked through this page
   * (a holiday, a company meeting) still blocks every location.
   */
  LOCATIONS_BOOK_INDEPENDENTLY: true,

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
      event_title: 'Billy - General Virtual Assistant Interview | {name}',
      interviewer_email: 'recruitment@legalsupporthelp.com',
      block_keywords: 'Billy,Philippines',
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
      event_title: 'Charly - General Virtual Assistant Interview | {name}',
      interviewer_email: 'sourcing@legalsupporthelp.com',
      block_keywords: 'Charly,Others',
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
  'gap_minutes', 'weekdays', 'max_per_day', 'event_title',
  'interviewer_email', 'block_keywords', 'active'
];

var BLOCKED_HEADERS = ['date', 'location', 'reason'];

var BOOKING_HEADERS = [
  'timestamp', 'name', 'email', 'discord_id', 'location',
  'date_est', 'time_est', 'start_ts', 'duration_min', 'notes',
  'event_id', 'meet_link', 'status'
];
