// Register all background job handlers here.
// Each key is the job `type` string stored in the database.
// Each value is an async function that receives the parsed payload.

module.exports = {
  'send-quote-email':   require('./handlers/send-quote-email'),
  'send-invoice-email': require('./handlers/send-invoice-email'),
  'payment-reminder':   require('./handlers/payment-reminder'),
  'calendar-sync':      require('./handlers/calendar-sync'),
  'email-sequence':     require('./handlers/email-sequence'),
};
