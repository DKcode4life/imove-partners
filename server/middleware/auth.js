const jwt = require('jsonwebtoken');
const config = require('../config');

function authenticate(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'No token provided' });
  }

  const token = authHeader.slice(7);
  let claims;
  try {
    claims = jwt.verify(token, config.jwtSecret);
  } catch {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
  // Handoff tokens are short-lived and meant only for /api/auth/exchange,
  // never to authenticate a normal API request.
  if (claims.handoff) {
    return res.status(401).json({ error: 'Handoff token cannot be used as a session' });
  }
  req.user = claims;
  next();
}

function requireAdmin(req, res, next) {
  if (req.user?.role !== 'admin') {
    return res.status(403).json({ error: 'Admin access required' });
  }
  next();
}

module.exports = { authenticate, requireAdmin };
