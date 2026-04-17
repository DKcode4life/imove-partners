// Express 4 doesn't catch async errors automatically.
// Wrap async route handlers so rejected promises become 500s.
module.exports = fn => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);
