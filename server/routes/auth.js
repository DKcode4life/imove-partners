const crypto = require('crypto');
const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const prisma = require('../db/prisma');
const config = require('../config');
const { authenticate } = require('../middleware/auth');
const wrap = require('../lib/async-handler');

const router = express.Router();

// Single-use jti tracking for handoff tokens. Bounded by token expiry (60s);
// we keep entries for 5 min as a safety buffer, then drop them.
const usedHandoffJti = new Set();
const HANDOFF_JTI_TTL_MS = 5 * 60 * 1000;

function buildSessionPayload(user, partner) {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    avatar: user.avatar || null,
    partnerId: partner?.id ?? null,
    agencyName: partner?.agency_name ?? null,
  };
}

// POST /api/auth/login
router.post('/login', wrap(async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Email and password required' });

  const user = await prisma.user.findUnique({ where: { email: email.toLowerCase().trim() } });
  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    return res.status(401).json({ error: 'Invalid email or password' });
  }

  let partner = null;
  if (user.role === 'partner') {
    partner = await prisma.partner.findUnique({ where: { user_id: user.id } });
    if (!partner?.active) {
      return res.status(403).json({ error: 'Partner account is inactive. Please contact iMove.' });
    }
  }

  const payload = buildSessionPayload(user, partner);

  const token = jwt.sign(payload, config.jwtSecret, { expiresIn: '7d' });
  res.json({ token, user: payload });
}));

// POST /api/auth/handoff
// Authenticated. Issues a short-lived single-use JWT so an admin can cross
// from one subdomain (crm.* / partners.*) to the other without re-logging in.
router.post('/handoff', authenticate, wrap(async (req, res) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Only admins can hand off between surfaces' });
  }
  const handoffPayload = {
    id: req.user.id,
    handoff: true,
    jti: crypto.randomBytes(16).toString('hex'),
  };
  const token = jwt.sign(handoffPayload, config.jwtSecret, { expiresIn: '60s' });
  res.json({ token });
}));

// POST /api/auth/exchange
// Public. Accepts a handoff token, returns a normal session token.
router.post('/exchange', wrap(async (req, res) => {
  const { token } = req.body || {};
  if (!token) return res.status(400).json({ error: 'Missing handoff token' });

  let claims;
  try {
    claims = jwt.verify(token, config.jwtSecret);
  } catch {
    return res.status(401).json({ error: 'Invalid or expired handoff token' });
  }
  if (!claims.handoff || !claims.jti || !claims.id) {
    return res.status(400).json({ error: 'Not a handoff token' });
  }
  if (usedHandoffJti.has(claims.jti)) {
    return res.status(401).json({ error: 'Handoff token already used' });
  }
  usedHandoffJti.add(claims.jti);
  const t = setTimeout(() => usedHandoffJti.delete(claims.jti), HANDOFF_JTI_TTL_MS);
  if (typeof t.unref === 'function') t.unref();

  const user = await prisma.user.findUnique({ where: { id: claims.id } });
  if (!user) return res.status(404).json({ error: 'User not found' });

  let partner = null;
  if (user.role === 'partner') {
    partner = await prisma.partner.findUnique({ where: { user_id: user.id } });
  }

  const payload = buildSessionPayload(user, partner);
  const sessionToken = jwt.sign(payload, config.jwtSecret, { expiresIn: '7d' });
  res.json({ token: sessionToken, user: payload });
}));

// GET /api/auth/me
router.get('/me', authenticate, wrap(async (req, res) => {
  const user = await prisma.user.findUnique({
    where: { id: req.user.id },
    select: { id: true, email: true, name: true, role: true, avatar: true },
  });
  if (!user) return res.status(404).json({ error: 'User not found' });

  let partner = null;
  if (user.role === 'partner') {
    partner = await prisma.partner.findUnique({ where: { user_id: user.id } });
  }

  res.json({
    user: {
      id: user.id, email: user.email, name: user.name, role: user.role,
      avatar: user.avatar || null,
      partnerId: partner?.id ?? null,
      agencyName: partner?.agency_name ?? null,
    },
    partner: partner ? {
      agency_name: partner.agency_name,
      phone: partner.phone || null,
      payment_method: partner.payment_method || null,
      bank_account: partner.bank_account || null,
      bank_sort_code: partner.bank_sort_code || null,
      gift_card_email: partner.gift_card_email || null,
    } : null,
  });
}));

// PUT /api/auth/me
router.put('/me', authenticate, wrap(async (req, res) => {
  const { name, email, avatar, agency_name, phone, payment_method, bank_account, bank_sort_code, gift_card_email } = req.body;

  if (email) {
    const lower = email.toLowerCase().trim();
    const clash = await prisma.user.findFirst({ where: { email: lower, NOT: { id: req.user.id } } });
    if (clash) return res.status(409).json({ error: 'Email is already in use by another account' });
    await prisma.user.update({ where: { id: req.user.id }, data: { email: lower } });
  }

  if (name) {
    await prisma.user.update({ where: { id: req.user.id }, data: { name: name.trim() } });
  }

  if (avatar !== undefined) {
    try {
      await prisma.user.update({ where: { id: req.user.id }, data: { avatar } });
    } catch (e) {
      console.error('Avatar save failed:', e.message);
      return res.status(400).json({ error: 'Image could not be saved. Try a smaller image.' });
    }
  }

  if (req.user.role === 'partner') {
    await prisma.partner.update({
      where: { user_id: req.user.id },
      data: {
        ...(agency_name != null ? { agency_name } : {}),
        phone: phone ?? null,
        payment_method: payment_method ?? null,
        bank_account: bank_account ?? null,
        bank_sort_code: bank_sort_code ?? null,
        gift_card_email: gift_card_email ?? null,
      },
    });
  }

  const updated = await prisma.user.findUnique({
    where: { id: req.user.id },
    select: { id: true, email: true, name: true, role: true, avatar: true },
  });
  let partner = null;
  if (updated.role === 'partner') {
    partner = await prisma.partner.findUnique({ where: { user_id: updated.id } });
  }

  res.json({
    user: {
      id: updated.id, email: updated.email, name: updated.name, role: updated.role,
      avatar: updated.avatar || null,
      partnerId: partner?.id ?? null,
      agencyName: partner?.agency_name ?? null,
    },
    partner: partner ? {
      agency_name: partner.agency_name,
      phone: partner.phone || null,
      payment_method: partner.payment_method || null,
      bank_account: partner.bank_account || null,
      bank_sort_code: partner.bank_sort_code || null,
      gift_card_email: partner.gift_card_email || null,
    } : null,
  });
}));

// PUT /api/auth/password
router.put('/password', authenticate, wrap(async (req, res) => {
  const { current_password, new_password } = req.body;
  if (!current_password || !new_password) {
    return res.status(400).json({ error: 'Current password and new password are required' });
  }
  if (new_password.length < 6) {
    return res.status(400).json({ error: 'New password must be at least 6 characters' });
  }

  const user = await prisma.user.findUnique({ where: { id: req.user.id } });
  if (!bcrypt.compareSync(current_password, user.password_hash)) {
    return res.status(401).json({ error: 'Current password is incorrect' });
  }

  await prisma.user.update({
    where: { id: req.user.id },
    data: { password_hash: bcrypt.hashSync(new_password, 10) },
  });

  res.json({ message: 'Password updated successfully' });
}));

module.exports = router;
