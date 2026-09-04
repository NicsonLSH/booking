/**
 * The one file you edit after deploying.
 *
 * API_URL is the /exec URL from Apps Script: Deploy > Manage deployments >
 * copy the Web app URL. If you ever create a *new* deployment instead of a new
 * version of the existing one, the URL changes and must be re-pasted here.
 */
window.BOOKING_CONFIG = {
  API_URL: 'PASTE_YOUR_APPS_SCRIPT_WEB_APP_URL_HERE',

  // Page copy.
  BRAND: 'LSH',
  TITLE: 'Book a call',
  SUBTITLE: '30 minutes to talk through what you need.',
  DURATION_LABEL: '1 hour',

  // Shown under the time slots so nobody misreads the timezone.
  TIMEZONE_NOTE: 'All times are shown in US Eastern time (EST/EDT).'
};
