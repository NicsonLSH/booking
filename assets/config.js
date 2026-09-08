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
   * Renames a location on the page only, keyed by its id in the Settings tab.
   * Anything not listed here keeps the label the Settings tab gives it.
   *
   * Note this changes the button and the confirmation screen, not the calendar
   * event — its description still carries the Settings tab's label. Editing
   * cell B3 in the Settings tab instead would change both.
   */
  LABELS: {
    others: 'Latin America'
  }
};
