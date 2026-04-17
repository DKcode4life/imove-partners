const express = require('express');
const bcrypt = require('bcryptjs');
const prisma = require('../db/prisma');
const { authenticate, requireAdmin } = require('../middleware/auth');
const wrap = require('../lib/async-handler');

const router = express.Router();
router.use(authenticate, requireAdmin);

// GET /api/partners
router.get('/', wrap(async (_req, res) => {
  const partners = await prisma.$queryRawUnsafe(
    `SELECT p.*,
      u.name AS user_name, u.email AS user_email, u.avatar AS user_avatar,
      COUNT(l.id) AS total_leads,
      SUM(CASE WHEN l.status IN ('Job Completed','Commission Paid') THEN 1 ELSE 0 END) AS confirmed_jobs,
      SUM(CASE WHEN l.commission_paid = 1 THEN l.quote_value * l.commission_rate / 100.0 ELSE 0 END) AS total_paid,
      SUM(CASE WHEN l.commission_paid = 0 AND l.status IN ('Job Completed','Commission Paid')
               THEN l.quote_value * l.commission_rate / 100.0 ELSE 0 END) AS commission_owed
    FROM partners p
    JOIN users u ON u.id = p.user_id
    LEFT JOIN leads l ON l.partner_id = p.id
    GROUP BY p.id
    ORDER BY p.created_at DESC`
  );
  res.json(partners.map(p => ({
    ...p,
    total_leads: Number(p.total_leads),
    confirmed_jobs: Number(p.confirmed_jobs),
    total_paid: Number(p.total_paid),
    commission_owed: Number(p.commission_owed),
  })));
}));

// POST /api/partners
router.post('/', wrap(async (req, res) => {
  const { name, email, password, agency_name, phone, commission_rate, payment_method, bank_account, bank_sort_code, gift_card_email } = req.body;
  if (!name || !email || !password || !agency_name) {
    return res.status(400).json({ error: 'name, email, password and agency_name are required' });
  }

  const existing = await prisma.user.findUnique({ where: { email: email.toLowerCase().trim() } });
  if (existing) return res.status(409).json({ error: 'Email already in use' });

  const result = await prisma.$transaction(async (tx) => {
    const user = await tx.user.create({
      data: {
        email: email.toLowerCase().trim(),
        password_hash: bcrypt.hashSync(password, 10),
        name,
        role: 'partner',
      },
    });
    const partner = await tx.partner.create({
      data: {
        user_id: user.id, agency_name,
        phone: phone || null, commission_rate: commission_rate ?? 10,
        payment_method: payment_method || null, bank_account: bank_account || null,
        bank_sort_code: bank_sort_code || null, gift_card_email: gift_card_email || null,
      },
    });
    return { ...partner, user_name: user.name, user_email: user.email };
  });

  res.status(201).json(result);
}));

// GET /api/partners/:id/commissions
router.get('/:id/commissions', wrap(async (req, res) => {
  const partnerId = parseInt(req.params.id, 10);
  const partner = await prisma.partner.findUnique({ where: { id: partnerId } });
  if (!partner) return res.status(404).json({ error: 'Partner not found' });

  function enrich(l) {
    return {
      ...l,
      estimated_commission: l.quote_value
        ? parseFloat(((l.quote_value * l.commission_rate) / 100).toFixed(2))
        : null,
    };
  }

  const [ready, pipeline, paid] = await Promise.all([
    prisma.lead.findMany({
      where: { partner_id: partnerId, status: 'Job Completed', commission_paid: false },
      orderBy: { updated_at: 'desc' },
    }),
    prisma.lead.findMany({
      where: {
        partner_id: partnerId, commission_paid: false,
        status: { notIn: ['Job Completed', 'Commission Paid', 'Quote Declined'] },
      },
      orderBy: { created_at: 'desc' },
    }),
    prisma.lead.findMany({
      where: { partner_id: partnerId, commission_paid: true },
      orderBy: [{ commission_paid_at: 'desc' }, { updated_at: 'desc' }],
    }),
  ]);

  res.json({ ready: ready.map(enrich), pipeline: pipeline.map(enrich), paid: paid.map(enrich) });
}));

// GET /api/partners/:id
router.get('/:id', wrap(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const partner = await prisma.partner.findUnique({
    where: { id },
    include: { user: { select: { name: true, email: true } } },
  });
  if (!partner) return res.status(404).json({ error: 'Partner not found' });

  const leads = await prisma.lead.findMany({
    where: { partner_id: id },
    orderBy: { created_at: 'desc' },
  });

  res.json({
    ...partner, user_name: partner.user.name, user_email: partner.user.email, user: undefined,
    leads: leads.map(l => ({
      ...l,
      estimated_commission: l.quote_value
        ? parseFloat(((l.quote_value * l.commission_rate) / 100).toFixed(2))
        : null,
    })),
  });
}));

// PUT /api/partners/:id
router.put('/:id', wrap(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const partner = await prisma.partner.findUnique({ where: { id } });
  if (!partner) return res.status(404).json({ error: 'Partner not found' });

  const { agency_name, phone, commission_rate, active, name, email, payment_method, bank_account, bank_sort_code, gift_card_email } = req.body;

  await prisma.partner.update({
    where: { id },
    data: {
      agency_name: agency_name ?? undefined,
      phone: phone ?? undefined,
      commission_rate: commission_rate ?? undefined,
      payment_method: payment_method ?? null,
      bank_account: bank_account ?? null,
      bank_sort_code: bank_sort_code ?? null,
      gift_card_email: gift_card_email ?? null,
      active: active !== undefined ? !!active : undefined,
    },
  });

  if (name || email) {
    await prisma.user.update({
      where: { id: partner.user_id },
      data: {
        name: name ?? undefined,
        email: email ? email.toLowerCase().trim() : undefined,
      },
    });
  }

  const updated = await prisma.partner.findUnique({
    where: { id },
    include: { user: { select: { name: true, email: true } } },
  });
  res.json({ ...updated, user_name: updated.user.name, user_email: updated.user.email, user: undefined });
}));

// DELETE /api/partners/:id
router.delete('/:id', wrap(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const partner = await prisma.partner.findUnique({ where: { id } });
  if (!partner) return res.status(404).json({ error: 'Partner not found' });
  await prisma.user.delete({ where: { id: partner.user_id } });
  res.json({ message: 'Partner removed' });
}));

module.exports = router;
