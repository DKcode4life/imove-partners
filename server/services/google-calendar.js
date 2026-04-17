const config = require('../config');

// TODO: npm install googleapis

function getOAuthClient() {
  if (!config.google.clientId) {
    throw new Error('GOOGLE_CLIENT_ID not configured');
  }
  // const { google } = require('googleapis');
  // return new google.auth.OAuth2(
  //   config.google.clientId,
  //   config.google.clientSecret,
  //   config.google.redirectUri,
  // );
  throw new Error('Google Calendar not yet implemented — install googleapis and uncomment');
}

function getAuthUrl(state) {
  // const oauth2 = getOAuthClient();
  // return oauth2.generateAuthUrl({
  //   access_type: 'offline',
  //   prompt: 'consent',
  //   scope: ['https://www.googleapis.com/auth/calendar'],
  //   state,
  // });
  return '#google-not-configured';
}

async function exchangeCode(code) {
  // const oauth2 = getOAuthClient();
  // const { tokens } = await oauth2.getToken(code);
  // return tokens; // { access_token, refresh_token, expiry_date }
  throw new Error('Google Calendar not yet implemented');
}

async function createEvent({ accessToken, refreshToken, calendarId = 'primary', event }) {
  // const oauth2 = getOAuthClient();
  // oauth2.setCredentials({ access_token: accessToken, refresh_token: refreshToken });
  // const { google } = require('googleapis');
  // const calendar = google.calendar({ version: 'v3', auth: oauth2 });
  // const res = await calendar.events.insert({
  //   calendarId,
  //   requestBody: {
  //     summary: event.title,
  //     description: event.description,
  //     start: { dateTime: event.start, timeZone: 'Europe/London' },
  //     end:   { dateTime: event.end,   timeZone: 'Europe/London' },
  //     location: event.location,
  //   },
  // });
  // return res.data;
  console.log(`[google-calendar] Would create event: ${event.title}`);
  return { id: 'gcal_placeholder', status: 'skipped' };
}

async function updateEvent({ accessToken, refreshToken, calendarId = 'primary', eventId, event }) {
  console.log(`[google-calendar] Would update event: ${eventId}`);
  return { id: eventId, status: 'skipped' };
}

async function deleteEvent({ accessToken, refreshToken, calendarId = 'primary', eventId }) {
  console.log(`[google-calendar] Would delete event: ${eventId}`);
  return { status: 'skipped' };
}

module.exports = { getAuthUrl, exchangeCode, createEvent, updateEvent, deleteEvent };
