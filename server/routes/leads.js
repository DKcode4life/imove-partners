const express = require('express');
const prisma = require('../db/prisma');
const { authenticate, requireAdmin } = require('../middleware/auth');
const wrap = require('../lib/async-handler');

const router = express.Router();
router.use(authenticate);

const STATUSES = [
  'New Lead', 'Contacted', 'Survey Booked', 'Quoted',
  'Quote Declined', 'Quote Accepted', 'Job Completed', 'Commission Paid',
];

function enrichLead(lead) {
  return {
    ...lead,
    estimated_commission: lead.quote_value
      ? parseFloat(((lead.quote_value * lead.commission_rate) / 100).toFixed(2))
      : null,
  };
}

// GET /api/leads
router.get('/', wrap(async (req, res) => {
  const { status, partner_id, search } = req.query;

  if (req.user.role === 'admin') {
    const where = {};
    if (status) where.status = status;
    if (partner_id) where.partner_id = parseInt(partner_id, 10);
    if (search) {
      where.OR = [
        { client_name: { contains: search, mode: 'insensitive' } },
        { current_address: { contains: search, mode: 'insensitive' } },
        { email: { contains: search, mode: 'insensitive' } },
      ];
    }

    const leads = await prisma.lead.findMany({
      where,
      include: { partner: { select: { agency_name: true, user: { select: { name: true, email: true } } } } },
      orderBy: { created_at: 'desc' },
    });

    return res.json(leads.map(l => enrichLead({
      ...l,
      partner_name: l.partner.user.name,
      agency_name: l.partner.agency_name,
      partner_email: l.partner.user.email,
      partner: undefined,
    })));
  }

  // Partner view
  const where = { partner_id: req.user.partnerId };
  if (status) where.status = status;
  if (search) {
    where.OR = [
      { client_name: { contains: search, mode: 'insensitive' } },
      { current_address: { contains: search, mode: 'insensitive' } },
    ];
  }

  const leads = await prisma.lead.findMany({ where, orderBy: { created_at: 'desc' } });
  res.json(leads.map(enrichLead));
}));

// POST /api/leads
router.post('/', wrap(async (req, res) => {
  const {
    client_name, current_address, destination_postcode, contact_number,
    email, estimated_moving_date, moving_date_type, move_type,
    property_type, floor_number, has_lift,
    property_size, notes, move_stage,
    partner_id: bodyPartnerId,
  } = req.body;

  if (!client_name || !contact_number || !email) {
    return res.status(400).json({ error: 'Client name, contact number and email are required' });
  }

  let partnerId;
  if (req.user.role === 'admin') {
    if (!bodyPartnerId) return res.status(400).json({ error: 'partner_id is required when creating a lead as admin' });
    const partnerExists = await prisma.partner.findFirst({ where: { id: parseInt(bodyPartnerId, 10), active: true } });
    if (!partnerExists) return res.status(400).json({ error: 'Partner not found' });
    partnerId = parseInt(bodyPartnerId, 10);
  } else {
    partnerId = req.user.partnerId;
  }

  const partner = await prisma.partner.findUnique({
    where: { id: partnerId },
    select: { commission_rate: true, agency_name: true },
  });

  const lead = await prisma.lead.create({
    data: {
      partner_id: partnerId,
      client_name, current_address: current_address || '', destination_postcode: destination_postcode || null,
      contact_number, email, estimated_moving_date: estimated_moving_date || null,
      moving_date_type: moving_date_type || null, move_type: move_type || null,
      property_type: property_type || null, floor_number: floor_number || null,
      has_lift: has_lift != null ? !!has_lift : null,
      property_size: property_size || null, notes: notes || null, move_stage: move_stage || null,
      commission_rate: partner?.commission_rate ?? 10,
    },
  });

  // Auto-create linked CRM job + customer
  try {
    const parts = (lead.current_address || '').split(',').map(s => s.trim());
    const addrLine = parts[0] || null;
    const cityPart = parts.length > 2 ? parts[parts.length - 2] : (parts[1] || null);

    let customerId = null;
    if (lead.email) {
      const existing = await prisma.crmCustomer.findFirst({
        where: { email: { equals: lead.email, mode: 'insensitive' } },
      });
      if (existing) customerId = existing.id;
    }
    if (!customerId) {
      const existing = await prisma.crmCustomer.findFirst({
        where: { full_name: { equals: lead.client_name, mode: 'insensitive' } },
      });
      if (existing) customerId = existing.id;
    }
    if (!customerId) {
      const c = await prisma.crmCustomer.create({
        data: {
          full_name: lead.client_name, email: lead.email || null,
          phone: lead.contact_number || null, address_line1: addrLine, city: cityPart,
        },
      });
      customerId = c.id;
    }

    const crmJob = await prisma.crmJob.create({
      data: {
        lead_id: lead.id, customer_id: customerId,
        full_name: lead.client_name, email: lead.email || null, phone: lead.contact_number || null,
        lead_source: 'Estate Agent Referral', estate_agent_name: partner?.agency_name || null,
        from_line1: addrLine, from_city: cityPart, to_postcode: lead.destination_postcode || null,
        bedrooms: lead.property_size || null, preferred_move_date: lead.estimated_moving_date || null,
        status: 'New Lead', partner_commission_rate: partner?.commission_rate || null,
      },
    });

    await prisma.crmActivity.create({
      data: {
        job_id: crmJob.id, type: 'created',
        note: `Imported from Partner Portal — referred by ${partner?.agency_name || 'estate agent'}`,
      },
    });
  } catch (_) { /* Non-fatal */ }

  res.status(201).json(enrichLead(lead));
}));

// GET /api/leads/counts
router.get('/counts', requireAdmin, wrap(async (_req, res) => {
  const rows = await prisma.lead.groupBy({ by: ['status'], _count: true });
  const countMap = Object.fromEntries(rows.map(r => [r.status, r._count]));
  res.json(STATUSES.map(s => ({ status: s, count: countMap[s] || 0 })));
}));

// GET /api/leads/:id
router.get('/:id', wrap(async (req, res) => {
  const id = parseInt(req.params.id, 10);

  if (req.user.role === 'admin') {
    const lead = await prisma.lead.findUnique({
      where: { id },
      include: { partner: { select: { agency_name: true, phone: true, user: { select: { name: true, email: true } } } } },
    });
    if (!lead) return res.status(404).json({ error: 'Lead not found' });
    return res.json(enrichLead({
      ...lead,
      partner_name: lead.partner.user.name,
      agency_name: lead.partner.agency_name,
      partner_phone: lead.partner.phone,
      partner_email: lead.partner.user.email,
      partner: undefined,
    }));
  }

  const lead = await prisma.lead.findFirst({ where: { id, partner_id: req.user.partnerId } });
  if (!lead) return res.status(404).json({ error: 'Lead not found' });
  res.json(enrichLead(lead));
}));

// PUT /api/leads/:id
router.put('/:id', wrap(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const lead = await prisma.lead.findUnique({ where: { id } });
  if (!lead) return res.status(404).json({ error: 'Lead not found' });

  if (req.user.role === 'partner' && lead.partner_id !== req.user.partnerId) {
    return res.status(403).json({ error: 'Access denied' });
  }

  if (req.user.role === 'admin') {
    const {
      status, quote_value, commission_rate, commission_paid,
      client_name, current_address, destination_postcode,
      contact_number, email, estimated_moving_date, moving_date_type,
      move_type, property_type, floor_number, has_lift,
      property_size, notes, move_stage,
    } = req.body;

    if (status && !STATUSES.includes(status)) {
      return res.status(400).json({ error: 'Invalid status' });
    }

    await prisma.lead.update({
      where: { id },
      data: {
        status: status ?? undefined,
        quote_value: quote_value ?? undefined,
        commission_rate: commission_rate ?? undefined,
        commission_paid: commission_paid !== undefined ? !!commission_paid : undefined,
        client_name: client_name ?? undefined,
        current_address: current_address ?? undefined,
        destination_postcode: destination_postcode ?? undefined,
        contact_number: contact_number ?? undefined,
        email: email ?? undefined,
        estimated_moving_date: estimated_moving_date ?? undefined,
        moving_date_type: moving_date_type ?? undefined,
        move_type: move_type ?? undefined,
        property_type: property_type ?? undefined,
        floor_number: floor_number || null,
        has_lift: has_lift != null ? !!has_lift : undefined,
        property_size: property_size ?? undefined,
        notes: notes ?? undefined,
        move_stage: move_stage ?? undefined,
      },
    });
  } else {
    const { notes, move_stage } = req.body;
    await prisma.lead.update({
      where: { id },
      data: {
        notes: notes ?? undefined,
        move_stage: move_stage ?? undefined,
      },
    });
  }

  const updated = await prisma.lead.findUnique({ where: { id } });
  res.json(enrichLead(updated));
}));

// POST /api/leads/pay
router.post('/pay', requireAdmin, wrap(async (req, res) => {
  const { lead_ids } = req.body;
  if (!Array.isArray(lead_ids) || lead_ids.length === 0) {
    return res.status(400).json({ error: 'lead_ids must be a non-empty array' });
  }

  const now = new Date().toISOString();

  await prisma.$transaction(
    lead_ids.map(id =>
      prisma.lead.update({
        where: { id },
        data: {
          commission_paid: true,
          commission_paid_at: now,
          status: 'Commission Paid',
        },
      })
    )
  );

  res.json({ message: 'Commissions marked as paid', paid_at: now, count: lead_ids.length });
}));

// DELETE /api/leads/:id
router.delete('/:id', requireAdmin, wrap(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const lead = await prisma.lead.findUnique({ where: { id } });
  if (!lead) return res.status(404).json({ error: 'Lead not found' });
  await prisma.lead.delete({ where: { id } });
  res.json({ message: 'Lead deleted' });
}));

module.exports = router;
