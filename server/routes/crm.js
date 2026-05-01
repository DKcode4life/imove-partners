const express = require('express');
const prisma = require('../db/prisma');
const { authenticate, requireAdmin } = require('../middleware/auth');
const wrap = require('../lib/async-handler');
const { send: sendEmail } = require('../services/email');

const router = express.Router();
router.use(authenticate, requireAdmin);

// Ordered pipeline stages (Lost / Cancelled is a special ejection state, kept separate)
const CRM_STATUSES = [
  'New Lead',
  'Called V/M',
  'Contacted',
  'Estimate Sent',
  'Survey Physical',
  'Survey Video',
  'Quote Sent',
  'Quote Chased',
  'Most Likely',
  'Quote Accepted',
  'Confirmed No Date',
  'Confirmed Deposit',
  'Confirmed Paid',
  'Completed',
  'Archived / Review Done',
  'Lost / Cancelled',
];

// Single source of truth: CRM status → Partner Portal status.
// Many-to-one: multiple granular CRM stages collapse to one simplified partner stage.
const PORTAL_STATUS_MAP = {
  'New Lead':               'New Lead',
  'Called V/M':             'Contacted',
  'Contacted':              'Contacted',
  'Survey Physical':        'Survey Booked',
  'Survey Video':           'Survey Booked',
  'Estimate Sent':          'Quoted',
  'Quote Sent':             'Quoted',
  'Quote Chased':           'Quoted',
  'Most Likely':            'Quoted',
  'Quote Accepted':         'Quote Accepted',
  'Confirmed No Date':      'Quote Accepted',
  'Confirmed Deposit':      'Job Confirmed',
  'Confirmed Paid':         'Job Confirmed',
  'Completed':              'Job Completed',
  'Archived / Review Done': 'Job Completed',
  // Lost / Cancelled intentionally omitted — admin handles portal status manually
};

/** Maps a CRM pipeline status to the simplified Partner Portal stage. */
function mapCrmStatusToPartnerStatus(crmStatus) {
  return PORTAL_STATUS_MAP[crmStatus] ?? null;
}

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

// GET /api/crm/jobs/:id/audit-trail - Get audit trail for a job
router.get('/jobs/:id/audit-trail', wrap(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const job = await prisma.crmJob.findUnique({ where: { id } });
  if (!job) return res.status(404).json({ error: 'Job not found' });

  const auditTrail = await prisma.jobChangeLog.findMany({
    where: { job_id: id },
    include: {
      user: {
        select: {
          id: true,
          name: true,
          email: true,
        },
      },
    },
    orderBy: { created_at: 'desc' },
  });

  res.json(auditTrail);
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
  const existing = await prisma.crmJob.findUnique({ where: { id } });
  if (!existing) return res.status(404).json({ error: 'Job not found' });

  const b = req.body;
  const oldStatus = existing.status;
  const newStatus = b.status || oldStatus;

  // Helper function to compare values for audit trail
  const getValue = (val) => val === undefined || val === null ? null : String(val);
  const compareValue = (oldVal, newVal) => {
    const oldStr = getValue(oldVal);
    const newStr = getValue(newVal);
    return oldStr !== newStr;
  };

  // Track changes for audit trail
  const changes = [];
  const userAgent = req.get('User-Agent') || null;
  const ipAddress = req.ip || req.connection.remoteAddress || null;

  // Define field mappings for comparison
  const fieldMappings = [
    { field: 'full_name', old: existing.full_name, new: b.full_name },
    { field: 'email', old: existing.email, new: b.email },
    { field: 'alt_email', old: existing.alt_email, new: b.alt_email },
    { field: 'phone', old: existing.phone, new: b.phone },
    { field: 'alt_phone', old: existing.alt_phone, new: b.alt_phone },
    { field: 'client_notes', old: existing.client_notes, new: b.client_notes },
    { field: 'lead_source', old: existing.lead_source, new: b.lead_source },
    { field: 'estate_agent_name', old: existing.estate_agent_name, new: b.estate_agent_name },
    { field: 'internal_ref', old: existing.internal_ref, new: b.internal_ref },
    { field: 'status', old: existing.status, new: b.status },
    { field: 'from_line1', old: existing.from_line1, new: b.from_line1 },
    { field: 'from_line2', old: existing.from_line2, new: b.from_line2 },
    { field: 'from_city', old: existing.from_city, new: b.from_city },
    { field: 'from_postcode', old: existing.from_postcode, new: b.from_postcode },
    { field: 'to_line1', old: existing.to_line1, new: b.to_line1 },
    { field: 'to_line2', old: existing.to_line2, new: b.to_line2 },
    { field: 'to_city', old: existing.to_city, new: b.to_city },
    { field: 'to_postcode', old: existing.to_postcode, new: b.to_postcode },
    { field: 'property_type_from', old: existing.property_type_from, new: b.property_type_from },
    { field: 'property_type_to', old: existing.property_type_to, new: b.property_type_to },
    { field: 'bedrooms', old: existing.bedrooms, new: b.bedrooms },
    { field: 'parking_notes', old: existing.parking_notes, new: b.parking_notes },
    { field: 'bedrooms_to', old: existing.bedrooms_to, new: b.bedrooms_to },
    { field: 'parking_notes_to', old: existing.parking_notes_to, new: b.parking_notes_to },
    { field: 'preferred_move_date', old: existing.preferred_move_date, new: b.preferred_move_date },
    { field: 'confirmed_move_date', old: existing.confirmed_move_date, new: b.confirmed_move_date },
    { field: 'flexibility_notes', old: existing.flexibility_notes, new: b.flexibility_notes },
    { field: 'survey_required', old: existing.survey_required, new: b.survey_required },
    { field: 'survey_type', old: existing.survey_type, new: b.survey_type },
    { field: 'survey_date', old: existing.survey_date, new: b.survey_date },
    { field: 'quote_amount', old: existing.quote_amount, new: b.quote_amount },
    { field: 'quote_sent_date', old: existing.quote_sent_date, new: b.quote_sent_date },
    { field: 'quote_accepted', old: existing.quote_accepted, new: b.quote_accepted },
    { field: 'deposit_required', old: existing.deposit_required, new: b.deposit_required },
    { field: 'deposit_paid', old: existing.deposit_paid, new: b.deposit_paid },
    { field: 'internal_notes', old: existing.internal_notes, new: b.internal_notes },
    { field: 'special_handling', old: existing.special_handling, new: b.special_handling },
    { field: 'access_restrictions', old: existing.access_restrictions, new: b.access_restrictions },
    { field: 'inventory_notes', old: existing.inventory_notes, new: b.inventory_notes },
    { field: 'packing_required', old: existing.packing_required, new: b.packing_required },
    { field: 'dismantling_required', old: existing.dismantling_required, new: b.dismantling_required },
    { field: 'storage_required', old: existing.storage_required, new: b.storage_required },
    { field: 'assigned_surveyor', old: existing.assigned_surveyor, new: b.assigned_surveyor },
    { field: 'assigned_mover', old: existing.assigned_mover, new: b.assigned_mover },
    { field: 'assigned_driver', old: existing.assigned_driver, new: b.assigned_driver },
    { field: 'assigned_vehicle', old: existing.assigned_vehicle, new: b.assigned_vehicle },
    { field: 'partner_commission_rate', old: existing.partner_commission_rate, new: b.partner_commission_rate },
    { field: 'move_type', old: existing.move_type, new: b.move_type },
    { field: 'is_key_worker', old: existing.is_key_worker, new: b.is_key_worker },
    { field: 'floor_from', old: existing.floor_from, new: b.floor_from },
    { field: 'has_lift_from', old: existing.has_lift_from, new: b.has_lift_from },
    { field: 'prop_type_from_other', old: existing.prop_type_from_other, new: b.prop_type_from_other },
    { field: 'floor_to', old: existing.floor_to, new: b.floor_to },
    { field: 'has_lift_to', old: existing.has_lift_to, new: b.has_lift_to },
    { field: 'prop_type_to_other', old: existing.prop_type_to_other, new: b.prop_type_to_other },
  ];

  // Check for changes
  for (const mapping of fieldMappings) {
    if (compareValue(mapping.old, mapping.new)) {
      changes.push({
        field_name: mapping.field,
        old_value: getValue(mapping.old),
        new_value: getValue(mapping.new),
      });
    }
  }

  // Log changes to audit trail
  if (changes.length > 0) {
    for (const change of changes) {
      await prisma.jobChangeLog.create({
        data: {
          job_id: id,
          user_id: req.user.id,
          field_name: change.field_name,
          old_value: change.old_value,
          new_value: change.new_value,
          change_type: 'update',
          ip_address: ipAddress,
          user_agent: userAgent,
        },
      });
    }
  }

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
      const portalStatus = mapCrmStatusToPartnerStatus(newStatus);
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

// ── Route distance/time calculation ──────────────────────────────────────────

const DEPOT_POSTCODE = 'IP28 7AS';

// Google Maps Directions API — matches Google Maps exactly
async function googleRoute(stops) {
  const key = process.env.GOOGLE_MAPS_API_KEY;
  if (!key) return null;
  try {
    const origin      = encodeURIComponent(stops[0]);
    const destination = encodeURIComponent(stops[stops.length - 1]);
    const waypoints   = stops.slice(1, -1).map(encodeURIComponent).join('|');
    let url = `https://maps.googleapis.com/maps/api/directions/json?origin=${origin}&destination=${destination}&key=${key}&region=gb`;
    if (waypoints) url += `&waypoints=${waypoints}`;
    const r    = await fetch(url);
    const data = await r.json();
    if (data.status !== 'OK' || !data.routes?.length) return null;
    const legs    = data.routes[0].legs;
    const metres  = legs.reduce((s, l) => s + l.distance.value, 0);
    const seconds = legs.reduce((s, l) => s + l.duration.value, 0);
    return {
      miles:   parseFloat((metres / 1609.344).toFixed(1)),
      minutes: Math.round(seconds / 60),
    };
  } catch { return null; }
}

// OSRM fallback (OpenStreetMap) — used when no Google API key is configured
async function geocodeAddress(address) {
  try {
    const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(address + ', UK')}&format=json&limit=1&countrycodes=gb`;
    const r = await fetch(url, { headers: { 'User-Agent': 'iMove-Partner-Portal/1.0 info@myimove.co.uk' } });
    const data = await r.json();
    if (!data?.length) return null;
    return { lat: parseFloat(data[0].lat), lon: parseFloat(data[0].lon) };
  } catch { return null; }
}

async function osrmRoute(coords) {
  try {
    const coordStr = coords.map(c => `${c.lon},${c.lat}`).join(';');
    const r    = await fetch(`https://router.project-osrm.org/route/v1/driving/${coordStr}?overview=false`);
    const data = await r.json();
    if (data.code !== 'Ok' || !data.routes?.length) return null;
    return {
      miles:   parseFloat((data.routes[0].distance / 1609.344).toFixed(1)),
      minutes: Math.round(data.routes[0].duration / 60),
    };
  } catch { return null; }
}

// POST /api/crm/route-info  { from, to }
router.post('/route-info', wrap(async (req, res) => {
  const { from, to } = req.body;
  if (!from || !to) return res.status(400).json({ error: 'from and to required' });

  // Try Google Maps first (exact match with Google Maps links)
  if (process.env.GOOGLE_MAPS_API_KEY) {
    const [direct, total] = await Promise.all([
      googleRoute([from, to]),
      googleRoute([DEPOT_POSTCODE, to, from, DEPOT_POSTCODE]),
    ]);
    return res.json({ direct, total });
  }

  // Fallback: OSRM via OpenStreetMap (free, no key, slightly different distances)
  const depotCoord = await geocodeAddress(DEPOT_POSTCODE);
  await new Promise(r => setTimeout(r, 1100));
  const fromCoord = await geocodeAddress(from);
  await new Promise(r => setTimeout(r, 1100));
  const toCoord = await geocodeAddress(to);

  if (!fromCoord || !toCoord) return res.status(422).json({ error: 'Could not geocode addresses' });

  const [direct, total] = await Promise.all([
    osrmRoute([fromCoord, toCoord]),
    depotCoord ? osrmRoute([depotCoord, toCoord, fromCoord, depotCoord]) : Promise.resolve(null),
  ]);

  res.json({ direct, total });
}));

// POST /api/crm/jobs/:id/send-survey-email
router.post('/jobs/:id/send-survey-email', wrap(async (req, res) => {
  const jobId = parseInt(req.params.id);
  if (isNaN(jobId)) return res.status(400).json({ error: 'Invalid job ID' });

  const job = await prisma.crmJob.findUnique({ where: { id: jobId } });
  if (!job) return res.status(404).json({ error: 'Job not found' });
  if (!job.email) return res.status(422).json({ error: 'Customer has no email address on file.' });
  if (!job.survey_required || !job.survey_type || !job.survey_date) {
    return res.status(422).json({ error: 'Survey type and date must be set before sending.' });
  }

  const isPhysical = job.survey_type.toLowerCase().includes('physical');
  const isZoom = job.survey_type.toLowerCase().includes('zoom') || job.survey_type.toLowerCase().includes('video');

  // Format the date nicely
  const dateObj = new Date(job.survey_date + 'T00:00:00');
  const formattedDate = dateObj.toLocaleDateString('en-GB', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  });

  const timeStr = job.survey_time
    ? (() => {
        const [h, m] = job.survey_time.split(':');
        const d = new Date(); d.setHours(parseInt(h), parseInt(m));
        return d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: true });
      })()
    : null;

  const fromAddressParts = [job.from_line1, job.from_line2, job.from_city, job.from_postcode].filter(Boolean);
  const fromAddress = fromAddressParts.join(', ');

  const locationLine = isPhysical && fromAddress
    ? `<p style="margin:0 0 12px;">We will see you at <strong>${fromAddress}</strong>.</p>`
    : isZoom
      ? `<p style="margin:0 0 12px;">Your survey will take place via <strong>Zoom</strong>. Please keep an eye on your inbox for the video call link.</p>`
      : `<p style="margin:0 0 12px;">Survey type: <strong>${job.survey_type}</strong>.</p>`;

  const html = `
<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f8fafc;font-family:Arial,Helvetica,sans-serif;color:#1e293b;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f8fafc;padding:32px 16px;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden;border:1px solid #e2e8f0;max-width:600px;width:100%;">

        <!-- Header -->
        <tr>
          <td style="background:linear-gradient(135deg,#0891b2 0%,#0e7490 100%);padding:32px 40px;text-align:center;">
            <h1 style="margin:0;color:#ffffff;font-size:24px;font-weight:700;letter-spacing:-0.5px;">Survey Confirmation</h1>
            <p style="margin:8px 0 0;color:#cffafe;font-size:14px;">iMove Removals &amp; Storage</p>
          </td>
        </tr>

        <!-- Body -->
        <tr>
          <td style="padding:36px 40px;">
            <p style="margin:0 0 20px;font-size:16px;">Dear <strong>${job.full_name}</strong>,</p>
            <p style="margin:0 0 16px;">Thank you for choosing iMove. Your survey has been booked and we look forward to helping you with your move.</p>

            <!-- Date/time card -->
            <table width="100%" cellpadding="0" cellspacing="0" style="background:#f0f9ff;border:1px solid #bae6fd;border-radius:10px;margin:0 0 20px;">
              <tr>
                <td style="padding:20px 24px;">
                  <p style="margin:0 0 4px;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;color:#0369a1;">Survey Appointment</p>
                  <p style="margin:0 0 2px;font-size:20px;font-weight:700;color:#0c4a6e;">${formattedDate}</p>
                  ${timeStr ? `<p style="margin:0;font-size:16px;color:#0369a1;font-weight:600;">${timeStr}</p>` : ''}
                </td>
              </tr>
            </table>

            ${locationLine}

            <p style="margin:0 0 12px;">If you have any questions or need to rearrange, please don't hesitate to get in touch.</p>
            <p style="margin:0;">We look forward to seeing you soon!</p>
          </td>
        </tr>

        <!-- Footer -->
        <tr>
          <td style="background:#f8fafc;border-top:1px solid #e2e8f0;padding:20px 40px;text-align:center;">
            <p style="margin:0;font-size:12px;color:#94a3b8;">iMove Removals &amp; Storage · <a href="mailto:info@myimove.co.uk" style="color:#0891b2;text-decoration:none;">info@myimove.co.uk</a></p>
          </td>
        </tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`.trim();

  await sendEmail({
    to: job.email,
    subject: `Your survey is booked – ${formattedDate}${timeStr ? ` at ${timeStr}` : ''}`,
    html,
  });

  res.json({ ok: true });
}));

module.exports = router;
