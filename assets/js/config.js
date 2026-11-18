/*
 * RSVP dashboard settings.
 *
 * apiUrl:         the same Apps Script Web App URL as the wedding site (ends in /exec).
 * googleClientId: the OAuth client ID from Google Cloud (ends in .apps.googleusercontent.com).
 *                 Put the same value in the Settings tab of your Sheet.
 *
 * While either is empty, the dashboard runs in DEMO MODE with sample data.
 */
window.WEDDING_CONFIG = {
  apiUrl: 'https://script.google.com/macros/s/AKfycbxq63x2tbT-8Tw-YRfUWb5LkO1ghd_Hqm00NxSAgQwCAdqTLy-D53LvfhfUKDM0M4m1qw/exec',
  googleClientId: '895695229084-bagj592ucnded7gq005v6dh0q98e3k10.apps.googleusercontent.com',

  // Only used in demo mode, to build sample personal links.
  siteUrl: 'https://amgphbelle.github.io/wedding-site/'
};
