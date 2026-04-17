const express = require('express');
const prisma = require('../db/prisma');
const { authenticate, requireAdmin } = require('../middleware/auth');
const wrap = require('../lib/async-handler');

const router = express.Router();
router.use(authenticate, requireAdmin);

const CRM_STATUSES = [
  'New Lead', 'Contacted', 'Survey Booked', 'Survey Completed',
  'Awaiting Quote', 'Quote Sent', 'Quote Accepted',
  'Booked Move', 'In Progress', 'Completed', 'Lost / Cancelled',
];

const PORTAL_STATUS_MAP = {
  'New Lead':          'New Lead',
  'Contacted':         'Contacted',
  'Survey Booked':     'Survey Booked',
  'Survey Completed':  'Survey Booked',
  'Awaiting Quote':    'Quoted',
  'Quote Sent':        'Quoted',
  'Quote Accepted':    'Quote Accepted',
  'Booked Move':       'Quote Accepted',
  'In Progress':       'Job Completed',
  'Completed':         'Job Completed',
  'Lost / Cancelled':  'Quote Declined',
};

// GET /api/crm/pending-leads
router.get('/pending-leads', wrap(async (_req, res) => {
  const importedLeadIds = (await prisma.crmJob.findMany({
    where: { lead_id: { not: null } },
    select: { lead_id: true },
  })).map(j => j.lead_id);

  const leads = await prisma.lead.findMany({
    where: importedLeadIds.length > 0
      ? { id: { notIn: importedLeadIds } }
      : undefined,
    include: {
      partner: {
        select: { agency_name: true, user: { select: { name: true } } },
      },
    },
    orderBy: { created_at: 'desc' },
    take: 100,
  });

  res.json(leads.map(l => ({
    id: l.id,
    client_name: l.client_name,
    contact_number: l.contact_number,
    email: l.email,
    current_address: l.current_address,
    destination_postcode: l.destination_postcode,
    estimated_moving_date: l.estimated_moving_date,
    lead_status: l.status,
    created_at: l.created_at,
    agency_name: l.partner.agency_name,
    partner_name: l.partner.user.name,
  })));
}));

// GET /api/crm/jobs/summary
router.get('/jobs/summary', wrap(async (_req, res) => {
  const rows = await prisma.crmJob.groupBy({ by: ['status'], _count: true });
  const map = Object.fromEntries(rows.map(r => [r.status, r._count]));
  const total = rows.reduce((s, r) => s + r._count, 0);
  res.json({
    total,
    by_status: CRM_STATUSES.map(s => ({ status: s, count: map[s] || 0 })),
  });
}));

// GET /api/crm/jobs
router.get('/jobs', wrap(async (req, res) => {
  const { search, status, estate_agent, date_from, date_to } = req.query;
  const where = {};
  const AND = [];

  if (status && status !== 'All') where.status = status;
  if (estate_agent && estate_agent !== 'All') where.estate_agent_name = estate_agent;

  if (search) {
    where.OR = [
      { full_name: { contains: search, mode: 'insensitive' } },
      { email: { contains: search, mode: 'insensitive' } },
      { phone: { contains: search, mode: 'insensitive' } },
      { from_line1: { contains: search, mode: 'insensitive' } },
      { from_postcode: { contains: search, mode: 'insensitive' } },
      { to_line1: { contains: search, mode: 'insensitive' } },
      { to_postcode: { contains: search, mode: 'insensitive' } },
      { estate_agent_name: { contains: search, mode: 'insensitive' } },
    ];
  }

  if (date_from) {
    AND.push({
      OR: [
        { confirmed_move_date: { gte: date_from } },
        { survey_date: { gte: date_from } },
      ],
    });
  }
  if (date_to) {
    AND.push({
      OR: [
        { confirmed_move_date: { lte: date_to } },
        { survey_date: { lte: date_to } },
      ],
    });
  }

  if (AND.length > 0) where.AND = AND;

  const jobs = await prisma.crmJob.findMany({ where, orderBy: { updated_at: 'desc' } });
  res.json(jobs);
}));

// GET /api/crm/jobs/:id
router.get('/jobs/:id', wrap(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const job = await prisma.crmJob.findUnique({ where: { id } });
  if (!job) return res.status(404).json({ error: 'Job not found' });

  const activities = await prisma.crmActivity.findMany({
    where: { job_id: id },
    orderBy: { created_at: 'desc' },
  });

  res.json({ ...job, activities });
}));

// POST /api/crm/jobs
router.post('/jobs', wrap(async (req, res) => {
  const b = req.body;
  if (!b.full_name?.trim()) return res.status(400).json({ error: 'full_name is required' });

  const job = await prisma.crmJob.create({
    data: {
      lead_id: b.lead_id || null,
      customer_id: b.customer_id || null,
      full_name: b.full_name.trim(), email: b.email || null, phone: b.phone || null,
      alt_phone: b.alt_phone || null, client_notes: b.client_notes || null,
      lead_source: b.lead_source || 'Direct Enquiry', estate_agent_name: b.estate_agent_name || null,
      internal_ref: b.internal_ref || null, status: b.status || 'New Lead',
      from_line1: b.from_line1 || null, from_line2: b.from_line2 || null,
      from_city: b.from_city || null, from_postcode: b.from_postcode || null,
      to_line1: b.to_line1 || null, to_line2: b.to_line2 || null,
      to_city: b.to_city || null, to_postcode: b.to_postcode || null,
      property_type_from: b.property_type_from || null, property_type_to: b.property_type_to || null,
      bedrooms: b.bedrooms || null, parking_notes: b.parking_notes || null,
      preferred_move_date: b.preferred_move_date || null, confirmed_move_date: b.confirmed_move_date || null,
      flexibility_notes: b.flexibility_notes || null,
      survey_required: !!b.survey_required, survey_type: b.survey_type || null, survey_date: b.survey_date || null,
      quote_amount: b.quote_amount != null ? parseFloat(b.quote_amount) : null,
      quote_sent_date: b.quote_sent_date || null, quote_accepted: !!b.quote_accepted,
      deposit_required: !!b.deposit_required, deposit_paid: !!b.deposit_paid,
      internal_notes: b.internal_notes || null, special_handling: b.special_handling || null,
      access_restrictions: b.access_restrictions || null, inventory_notes: b.inventory_notes || null,
      packing_required: !!b.packing_required, dismantling_required: !!b.dismantling_required,
      storage_required: !!b.storage_required,
      assigned_surveyor: b.assigned_surveyor || null, assigned_mover: b.assigned_mover || null,
      assigned_driver: b.assigned_driver || null, assigned_vehicle: b.assigned_vehicle || null,
    },
  });

  await prisma.crmActivity.create({
    data: { job_id: job.id, type: 'created', note: `CRM record created for ${b.full_name.trim()}` },
  });

  const activities = await prisma.crmActivity.findMany({
    where: { job_id: job.id }, orderBy: { created_at: 'desc' },
  });

  res.status(201).json({ ...job, activities });
}));

// PUT /api/crm/jobs/:id
router.put('/jobs/:id', wrap(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const existing = await prisma.crmJob.findUnique({ where: { id }, select: { id: true, status: true, lead_id: true } });
  if (!existing) return res.status(404).json({ error: 'Job not found' });

  const b = req.body;
  const oldStatus = existing.status;
  const newStatus = b.status || oldStatus;

  const updated = await prisma.crmJob.update({
    where: { id },
    data: {
      full_name: b.full_name ?? undefined,
      email: b.email ?? null, alt_email: b.alt_email ?? null,
      phone: b.phone ?? null, alt_phone: b.alt_phone ?? null, client_notes: b.client_notes ?? null,
      lead_source: b.lead_source ?? null, estate_agent_name: b.estate_agent_name ?? null,
      internal_ref: b.internal_ref ?? null, status: b.status ?? undefined,
      from_line1: b.from_line1 ?? null, from_line2: b.from_line2 ?? null,
      from_city: b.from_city ?? null, from_postcode: b.from_postcode ?? null,
      to_line1: b.to_line1 ?? null, to_line2: b.to_line2 ?? null,
      to_city: b.to_city ?? null, to_postcode: b.to_postcode ?? null,
      property_type_from: b.property_type_from ?? null, property_type_to: b.property_type_to ?? null,
      bedrooms: b.bedrooms ?? null, parking_notes: b.parking_notes ?? null,
      bedrooms_to: b.bedrooms_to ?? null, parking_notes_to: b.parking_notes_to ?? null,
      preferred_move_date: b.preferred_move_date ?? null, confirmed_move_date: b.confirmed_move_date ?? null,
      flexibility_notes: b.flexibility_notes ?? null,
      survey_required: !!b.survey_required, survey_type: b.survey_type ?? null, survey_date: b.survey_date ?? null,
      quote_amount: b.quote_amount != null ? parseFloat(b.quote_amount) : null,
      quote_sent_date: b.quote_sent_date ?? null, quote_accepted: !!b.quote_accepted,
      deposit_required: !!b.deposit_required, deposit_paid: !!b.deposit_paid,
      internal_notes: b.internal_notes ?? null, special_handling: b.special_handling ?? null,
      access_restrictions: b.access_restrictions ?? null, inventory_notes: b.inventory_notes ?? null,
      packing_required: !!b.packing_required, dismantling_required: !!b.dismantling_required,
      storage_required: !!b.storage_required,
      assigned_surveyor: b.assigned_surveyor ?? null, assigned_mover: b.assigned_mover ?? null,
      assigned_driver: b.assigned_driver ?? null, assigned_vehicle: b.assigned_vehicle ?? null,
      partner_commission_rate: b.partner_commission_rate != null ? parseFloat(b.partner_commission_rate) : null,
      move_type: b.move_type ?? null, is_key_worker: !!b.is_key_worker,
      floor_from: b.floor_from ?? null, has_lift_from: !!b.has_lift_from, prop_type_from_other: b.prop_type_from_other ?? null,
      floor_to: b.floor_to ?? null, has_lift_to: !!b.has_lift_to, prop_type_to_other: b.prop_type_to_other ?? null,
    },
  });

  if (newStatus !== oldStatus) {
    await prisma.crmActivity.create({
      data: { job_id: id, type: 'status_change', note: `Status changed from "${oldStatus}" to "${newStatus}"` },
    });

    if (existing.lead_id) {
      const portalStatus = PORTAL_STATUS_MAP[newStatus];
      if (portalStatus) {
        try {
          await prisma.lead.update({ where: { id: existing.lead_id }, data: { status: portalStatus } });
        } catch (_) { /* non-fatal */ }
      }
    }
  }

  const activities = await prisma.crmActivity.findMany({
    where: { job_id: id }, orderBy: { created_at: 'desc' },
  });

  res.json({ ...updated, activities });
}));

// POST /api/crm/jobs/:id/duplicate
router.post('/jobs/:id/duplicate', wrap(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const job = await prisma.crmJob.findUnique({ where: { id } });
  if (!job) return res.status(404).json({ error: 'Job not found' });

  const copy = await prisma.crmJob.create({
    data: {
      customer_id: job.customer_id, referred_by_customer_id: job.referred_by_customer_id,
      full_name: job.full_name, email: job.email, alt_email: job.alt_email,
      phone: job.phone, alt_phone: job.alt_phone, client_notes: job.client_notes,
      lead_source: job.lead_source, estate_agent_name: job.estate_agent_name,
      internal_ref: job.internal_ref, status: job.status,
      from_line1: job.from_line1, from_line2: job.from_line2, from_city: job.from_city, from_postcode: job.from_postcode,
      to_line1: job.to_line1, to_line2: job.to_line2, to_city: job.to_city, to_postcode: job.to_postcode,
      property_type_from: job.property_type_from, property_type_to: job.property_type_to,
      bedrooms: job.bedrooms, parking_notes: job.parking_notes,
      bedrooms_to: job.bedrooms_to, parking_notes_to: job.parking_notes_to,
      preferred_move_date: job.preferred_move_date, confirmed_move_date: job.confirmed_move_date,
      flexibility_notes: job.flexibility_notes,
      survey_required: job.survey_required, survey_type: job.survey_type, survey_date: job.survey_date,
      quote_amount: job.quote_amount, quote_sent_date: job.quote_sent_date, quote_accepted: job.quote_accepted,
      deposit_required: job.deposit_required, deposit_paid: job.deposit_paid,
      internal_notes: job.internal_notes, special_handling: job.special_handling,
      access_restrictions: job.access_restrictions, inventory_notes: job.inventory_notes,
      packing_required: job.packing_required, dismantling_required: job.dismantling_required,
      storage_required: job.storage_required,
      floor_from: job.floor_from, has_lift_from: job.has_lift_from, prop_type_from_other: job.prop_type_from_other,
      floor_to: job.floor_to, has_lift_to: job.has_lift_to, prop_type_to_other: job.prop_type_to_other,
      move_type: job.move_type, is_key_worker: job.is_key_worker,
      assigned_surveyor: job.assigned_surveyor, assigned_mover: job.assigned_mover,
      assigned_driver: job.assigned_driver, assigned_vehicle: job.assigned_vehicle,
      partner_commission_rate: job.partner_commission_rate,
    },
  });

  await prisma.crmActivity.create({
    data: {
      job_id: copy.id, type: 'created',
      note: `Duplicated from job iM${String(id).padStart(4, '0')}`,
    },
  });

  res.status(201).json(copy);
}));

// DELETE /api/crm/jobs/:id
router.delete('/jobs/:id', wrap(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const existing = await prisma.crmJob.findUnique({ where: { id } });
  if (!existing) return res.status(404).json({ error: 'Job not found' });
  await prisma.crmJob.delete({ where: { id } });
  res.json({ message: 'Job deleted' });
}));

// POST /api/crm/jobs/:id/activities
router.post('/jobs/:id/activities', wrap(async (req, res) => {
  const jobId = parseInt(req.params.id, 10);
  const job = await prisma.crmJob.findUnique({ where: { id: jobId } });
  if (!job) return res.status(404).json({ error: 'Job not found' });

  const { note, type } = req.body;
  if (!note?.trim()) return res.status(400).json({ error: 'Note is required' });
  const actType = ['note', 'admin_note'].includes(type) ? type : 'note';

  await prisma.crmActivity.create({ data: { job_id: jobId, type: actType, note: note.trim() } });

  const activities = await prisma.crmActivity.findMany({
    where: { job_id: jobId }, orderBy: { created_at: 'desc' },
  });
  res.json(activities);
}));

// PUT /api/crm/jobs/:id/activities/:actId
router.put('/jobs/:id/activities/:actId', wrap(async (req, res) => {
  const jobId = parseInt(req.params.id, 10);
  const actId = parseInt(req.params.actId, 10);
  const act = await prisma.crmActivity.findFirst({ where: { id: actId, job_id: jobId } });
  if (!act) return res.status(404).json({ error: 'Activity not found' });
  if (act.type !== 'admin_note') return res.status(400).json({ error: 'Only admin notes can be edited' });

  const { note } = req.body;
  if (!note?.trim()) return res.status(400).json({ error: 'Note is required' });
  await prisma.crmActivity.update({ where: { id: actId }, data: { note: note.trim() } });

  const activities = await prisma.crmActivity.findMany({
    where: { job_id: jobId }, orderBy: { created_at: 'desc' },
  });
  res.json(activities);
}));

// DELETE /api/crm/jobs/:id/activities/:actId
router.delete('/jobs/:id/activities/:actId', wrap(async (req, res) => {
  const jobId = parseInt(req.params.id, 10);
  const actId = parseInt(req.params.actId, 10);
  const act = await prisma.crmActivity.findFirst({ where: { id: actId, job_id: jobId } });
  if (!act) return res.status(404).json({ error: 'Activity not found' });
  if (act.type !== 'admin_note') return res.status(400).json({ error: 'Only admin notes can be deleted' });

  await prisma.crmActivity.delete({ where: { id: actId } });

  const activities = await prisma.crmActivity.findMany({
    where: { job_id: jobId }, orderBy: { created_at: 'desc' },
  });
  res.json(activities);
}));

// POST /api/crm/import/:leadId
router.post('/import/:leadId', wrap(async (req, res) => {
  const leadId = parseInt(req.params.leadId, 10);
  const lead = await prisma.lead.findUnique({
    where: { id: leadId },
    include: { partner: { select: { agency_name: true, user: { select: { name: true } } } } },
  });
  if (!lead) return res.status(404).json({ error: 'Lead not found' });

  const already = await prisma.crmJob.findFirst({ where: { lead_id: leadId } });
  if (already) return res.status(409).json({ error: 'Lead already imported', crm_job_id: already.id });

  const parts = (lead.current_address || '').split(',').map(s => s.trim());
  const addrLine = parts[0] || null;
  const cityPart = parts.length > 2 ? parts[parts.length - 2] : (parts[1] || null);

  const job = await prisma.crmJob.create({
    data: {
      lead_id: lead.id,
      full_name: lead.client_name, email: lead.email, phone: lead.contact_number,
      lead_source: 'Estate Agent Referral', estate_agent_name: lead.partner.agency_name,
      from_line1: addrLine, from_city: cityPart, from_postcode: lead.destination_postcode || null,
      bedrooms: lead.property_size || null, client_notes: lead.notes || null,
      status: 'New Lead',
    },
  });

  await prisma.crmActivity.create({
    data: {
      job_id: job.id, type: 'created',
      note: `Imported from estate agent lead — ${lead.partner.agency_name} (${lead.partner.user.name})`,
    },
  });

  const activities = await prisma.crmActivity.findMany({
    where: { job_id: job.id }, orderBy: { created_at: 'desc' },
  });

  res.status(201).json({ ...job, activities });
}));

module.exports = router;
