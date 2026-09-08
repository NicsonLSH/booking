/**
 * The one file you edit after deploying.
 *
 * API_URL is the /exec URL from Apps Script: Deploy > Manage deployments >
 * copy the Web app URL. If you ever create a *new* deployment instead of a new
 * version of the existing one, the URL changes and must be re-pasted here.
 */
window.BOOKING_CONFIG = {
  API_URL: 'https://script.google.com/macros/s/AKfycbxG0C7yW0wypAmnJ_0Rw3SpKEcX-eFSLAk0LqwOWtWN8gSP2VFwC7mN6hXhWTTtrMG2TA/exec',

  // Page copy. The logo is inline in index.html so it can follow the theme.
  TITLE: 'Book a Meeting',
  SUBTITLE: 'Choose a time for your interview with our HR team.',
  DURATION_LABEL: '1 hour',

  // Shown under the time slots so nobody misreads the timezone.
  TIMEZONE_NOTE: 'All times are shown in US Eastern time (EST/EDT).',

  /**
   * Renames a location on the page, keyed by its id in the Settings tab.
   *
   * Normally leave this empty and rename in the Settings tab instead, so the
   * page, the calendar event and the Bookings rows all agree. This exists for
   * when the sheet cannot be edited right away.
   */
  LABELS: {}
};
