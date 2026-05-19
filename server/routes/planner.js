const express = require('express');
const router = express.Router();
const prisma = require('../db/prisma');
const { authenticate, requireAdmin } = require('../middleware/auth');
const wrap = require('../lib/async-handler');
const { syncDraftInvoiceForJobDate } = require('../lib/contract-invoice-sync');

/**
 * If a PlannerEvent is linked to a ContractJob (via ContractJob.planner_event_id),
 * propagate the new date back to the job and reconcile any draft invoice that
 * covers the old or new week.
 */
async function syncContractJobFromPlannerEvent(eventId, newDate) {
  if (!eventId || !newDate) return;
  const job = await prisma.contractJob.findUnique({
    where: { planner_event_id: eventId },
    select: { id: true, contract_id: true, job_date: true, invoiced: true },
  });
  if (!job) return;
  if (job.invoiced) return; // job is locked on a finalised invoice — don't shift it
  if (job.job_date === newDate) return;
  const oldDate = job.job_date;
  await prisma.contractJob.update({ where: { id: job.id }, data: { job_date: newDate } });
  await syncDraftInvoiceForJobDate(job.contract_id, newDate);
  if (oldDate !== newDate) await syncDraftInvoiceForJobDate(job.contract_id, oldDate);
}

router.use(authenticate, requireAdmin);

function isoDate(d) {
  if (!d) return null;
  return String(d).slice(0, 10);
}

function weekDates(start) {
  const dates = [];
  const d = new Date(start);
  for (let i = 0; i < 7; i++) {
    dates.push(d.toISOString().slice(0, 10));
    d.setDate(d.getDate() + 1);
  }
  return dates;
}

// ── Assets ────────────────────────────────────────────────────────────────────

router.get('/assets', wrap(async (req, res) => {
  const { type } = req.query;
  const where = type ? { type } : {};
  const rows = await prisma.plannerAsset.findMany({ where, orderBy: [{ sort_order: 'asc' }, { id: 'asc' }] });
  res.json(rows);
}));

router.post('/assets', wrap(async (req, res) => {
  const { type, name, role, phone, email, make_model, registration, capacity_notes, availability, notes } = req.body;
  if (!type || !name) return res.status(400).json({ error: 'type and name are required' });

  const maxRow = await prisma.plannerAsset.aggregate({ _max: { sort_order: true } });
  const sortOrder = (maxRow._max.sort_order ?? 0) + 1;

  const asset = await prisma.plannerAsset.create({
    data: {
      type, name: name.trim(), role: role || null, phone: phone || null,
      email: email || null, make_model: make_model || null, registration: registration || null,
      capacity_notes: capacity_notes || null, availability: availability || 'available',
      notes: notes || null, sort_order: sortOrder,
    },
  });
  res.status(201).json(asset);
}));

router.put('/assets/reorder', wrap(async (req, res) => {
  const items = req.body;
  if (!Array.isArray(items)) return res.status(400).json({ error: 'Expected array' });

  await prisma.$transaction(
    items.map(({ id, sort_order }) =>
      prisma.plannerAsset.update({ where: { id }, data: { sort_order } })
    )
  );
  res.json({ ok: true });
}));

router.put('/assets/:id', wrap(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const { name, role, phone, email, make_model, registration, capacity_notes, availability, notes } = req.body;

  const asset = await prisma.plannerAsset.findUnique({ where: { id } });
  if (!asset) return res.status(404).json({ error: 'Asset not found' });

  const updated = await prisma.plannerAsset.update({
    where: { id },
    data: {
      name: name?.trim() ?? asset.name,
      role: role || null, phone: phone || null, email: email || null,
      make_model: make_model || null, registration: registration || null,
      capacity_notes: capacity_notes || null,
      availability: availability ?? asset.availability,
      notes: notes || null,
    },
  });
  res.json(updated);
}));

router.delete('/assets/:id', wrap(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const asset = await prisma.plannerAsset.findUnique({ where: { id } });
  if (!asset) return res.status(404).json({ error: 'Asset not found' });
  await prisma.plannerAsset.delete({ where: { id } });
  res.json({ ok: true });
}));

// ── Events (quick jobs) ──────────────────────────────────────────────────────

router.get('/events', wrap(async (req, res) => {
  const { start, end } = req.query;
  const where = {};
  if (start && end) { where.event_date = { gte: start, lte: end }; }
  else if (start) { where.event_date = { gte: start }; }

  const rows = await prisma.plannerEvent.findMany({
    where,
    orderBy: [{ event_date: 'asc' }, { event_time: 'asc' }],
  });
  res.json(rows);
}));

router.post('/events', wrap(async (req, res) => {
  const { title, category, customer_name, contact_number, address, event_date, event_time, notes, contract_id } = req.body;
  if (!title || !event_date) return res.status(400).json({ error: 'title and event_date are required' });

  const ev = await prisma.plannerEvent.create({
    data: {
      title: title.trim(), category: category || 'Quick Job',
      customer_name: customer_name || null, contact_number: contact_number || null,
      address: address || null, event_date, event_time: event_time || null, notes: notes || null,
      contract_id: contract_id ? parseInt(contract_id, 10) : null,
    },
    include: { contract: { select: { id: true, company_name: true } } },
  });
  res.status(201).json(ev);
}));

router.put('/events/:id', wrap(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const { title, category, customer_name, contact_number, address, event_date, event_time, notes, contract_id } = req.body;

  const ev = await prisma.plannerEvent.findUnique({ where: { id } });
  if (!ev) return res.status(404).json({ error: 'Event not found' });

  const updated = await prisma.plannerEvent.update({
    where: { id },
    data: {
      title: title?.trim() ?? ev.title,
      category: category ?? ev.category,
      customer_name: customer_name || null, contact_number: contact_number || null,
      address: address || null, event_date: event_date ?? ev.event_date,
      event_time: event_time || null, notes: notes || null,
      contract_id: contract_id !== undefined ? (contract_id ? parseInt(contract_id, 10) : null) : ev.contract_id,
    },
    include: { contract: { select: { id: true, company_name: true } } },
  });

  if (event_date && event_date !== ev.event_date) {
    await syncContractJobFromPlannerEvent(id, event_date);
  }

  res.json(updated);
}));

router.delete('/events/:id', wrap(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const ev = await prisma.plannerEvent.findUnique({ where: { id } });
  if (!ev) return res.status(404).json({ error: 'Event not found' });
  await prisma.plannerEvent.delete({ where: { id } });
  res.json({ ok: true });
}));

// ── Assignments ──────────────────────────────────────────────────────────────

const ASSIGNMENT_SELECT = {
  id: true, asset_id: true, job_id: true, event_id: true,
  assigned_date: true, assigned_role: true, daily_rate: true, vehicle_asset_id: true, notes: true, created_at: true,
  asset: { select: { name: true, type: true, role: true } },
};

function flattenAssignment(a) {
  return {
    id: a.id, asset_id: a.asset_id, job_id: a.job_id, event_id: a.event_id,
    assigned_date: a.assigned_date, assigned_role: a.assigned_role,
    daily_rate: a.daily_rate, vehicle_asset_id: a.vehicle_asset_id,
    notes: a.notes, created_at: a.created_at,
    asset_name: a.asset.name, asset_type: a.asset.type, asset_role: a.asset.role,
  };
}

router.get('/assignments', wrap(async (req, res) => {
  const { start, end, job_id, event_id } = req.query;
  const where = {};
  if (job_id) where.job_id = parseInt(job_id, 10);
  else if (event_id) where.event_id = parseInt(event_id, 10);
  else if (start && end) where.assigned_date = { gte: start, lte: end };

  const rows = await prisma.plannerAssignment.findMany({
    where,
    select: ASSIGNMENT_SELECT,
    orderBy: [{ assigned_date: 'asc' }],
  });
  res.json(rows.map(flattenAssignment));
}));

router.post('/assignments', wrap(async (req, res) => {
  const { asset_id, job_id, event_id, assigned_date, notes, daily_rate, assigned_role } = req.body;
  if (!asset_id || !assigned_date) return res.status(400).json({ error: 'asset_id and assigned_date are required' });
  if (!job_id && !event_id) return res.status(400).json({ error: 'Either job_id or event_id is required' });

  const dupWhere = { asset_id, assigned_date };
  if (job_id) dupWhere.job_id = job_id;
  else dupWhere.event_id = event_id;

  const existing = await prisma.plannerAssignment.findFirst({ where: dupWhere });
  if (existing) return res.status(409).json({ error: 'Already assigned', id: existing.id });

  const conflict = await prisma.plannerAssignment.findFirst({
    where: { asset_id, assigned_date },
    select: { id: true },
  });

  const created = await prisma.plannerAssignment.create({
    data: {
      asset_id, job_id: job_id || null, event_id: event_id || null,
      assigned_date, assigned_role: assigned_role || null, daily_rate: daily_rate ?? null, notes: notes || null,
    },
    select: ASSIGNMENT_SELECT,
  });

  res.status(201).json({ ...flattenAssignment(created), conflict: !!conflict });
}));

router.patch('/assignments/:id', wrap(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const a = await prisma.plannerAssignment.findUnique({ where: { id } });
  if (!a) return res.status(404).json({ error: 'Assignment not found' });

  const data = {};
  if ('assigned_role' in req.body) data.assigned_role = req.body.assigned_role || null;
  if ('daily_rate' in req.body) data.daily_rate = req.body.daily_rate == null ? null : Number(req.body.daily_rate);
  if ('vehicle_asset_id' in req.body) data.vehicle_asset_id = req.body.vehicle_asset_id == null ? null : Number(req.body.vehicle_asset_id);

  const updated = await prisma.plannerAssignment.update({ where: { id }, data, select: ASSIGNMENT_SELECT });
  res.json(flattenAssignment(updated));
}));

router.delete('/assignments/:id', wrap(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const a = await prisma.plannerAssignment.findUnique({ where: { id } });
  if (!a) return res.status(404).json({ error: 'Assignment not found' });
  await prisma.plannerAssignment.delete({ where: { id } });
  res.json({ ok: true });
}));

// ── Calendar view (month) ────────────────────────────────────────────────────

router.get('/calendar', wrap(async (req, res) => {
  const { year, month } = req.query;
  if (!year || !month) return res.status(400).json({ error: 'year and month are required' });

  const y = parseInt(year, 10);
  const m = parseInt(month, 10);
  const startDate = `${y}-${String(m).padStart(2, '0')}-01`;
  const lastDay = new Date(y, m, 0).getDate();
  const endDate = `${y}-${String(m).padStart(2, '0')}-${lastDay}`;

  const [jobs, events] = await Promise.all([
    prisma.crmJob.findMany({
      where: {
        status: { not: 'Lost / Cancelled' },
        OR: [
          { confirmed_move_date: { gte: startDate, lte: endDate } },
          { AND: [{ confirmed_move_date: null }, { preferred_move_date: { gte: startDate, lte: endDate } }] },
        ],
      },
      select: {
        id: true, full_name: true, status: true, phone: true,
        confirmed_move_date: true, preferred_move_date: true,
        from_postcode: true, to_postcode: true, from_line1: true, to_line1: true,
      },
    }),
    prisma.plannerEvent.findMany({
      where: { event_date: { gte: startDate, lte: endDate } },
      orderBy: [{ event_date: 'asc' }, { event_time: 'asc' }],
      include: { contract: { select: { id: true, company_name: true } } },
    }),
  ]);

  const items = [
    ...jobs.map(j => ({
      source: 'job', id: j.id, title: j.full_name, category: j.status,
      date: isoDate(j.confirmed_move_date || j.preferred_move_date),
      phone: j.phone, from_postcode: j.from_postcode, to_postcode: j.to_postcode,
      from_line1: j.from_line1, to_line1: j.to_line1, status: j.status,
    })),
    ...events.map(e => ({
      source: 'event', id: e.id, title: e.title, category: e.category,
      date: isoDate(e.event_date), time: e.event_time,
      address: e.address, phone: e.contact_number, customer_name: e.customer_name,
      contract_id: e.contract_id, contract_name: e.contract?.company_name || null,
    })),
  ].sort((a, b) => (a.date || '').localeCompare(b.date || ''));

  res.json(items);
}));

// ── Week view ────────────────────────────────────────────────────────────────

router.get('/week', wrap(async (req, res) => {
  const { start } = req.query;
  if (!start) return res.status(400).json({ error: 'start is required (YYYY-MM-DD)' });

  const dates = weekDates(start);
  const endDate = dates[dates.length - 1];

  const [jobs, events, assignmentsRaw] = await Promise.all([
    prisma.crmJob.findMany({
      where: {
        status: { not: 'Lost / Cancelled' },
        OR: [
          { confirmed_move_date: { gte: start, lte: endDate } },
          { AND: [{ confirmed_move_date: null }, { preferred_move_date: { gte: start, lte: endDate } }] },
        ],
      },
      select: {
        id: true, full_name: true, status: true, phone: true, email: true,
        confirmed_move_date: true, preferred_move_date: true,
        from_line1: true, from_city: true, from_postcode: true,
        to_line1: true, to_city: true, to_postcode: true,
        bedrooms: true, internal_notes: true, packing_required: true, storage_required: true,
      },
    }),
    prisma.plannerEvent.findMany({
      where: { event_date: { gte: start, lte: endDate } },
      orderBy: [{ event_date: 'asc' }, { event_time: 'asc' }],
      include: { contract: { select: { id: true, company_name: true } } },
    }),
    prisma.plannerAssignment.findMany({
      where: { assigned_date: { gte: start, lte: endDate } },
      select: ASSIGNMENT_SELECT,
    }),
  ]);

  const assignments = assignmentsRaw.map(flattenAssignment);
  const assignmentsByJob = {};
  const assignmentsByEvent = {};
  for (const a of assignments) {
    if (a.job_id) {
      if (!assignmentsByJob[a.job_id]) assignmentsByJob[a.job_id] = [];
      assignmentsByJob[a.job_id].push(a);
    }
    if (a.event_id) {
      if (!assignmentsByEvent[a.event_id]) assignmentsByEvent[a.event_id] = [];
      assignmentsByEvent[a.event_id].push(a);
    }
  }

  const items = [
    ...jobs.map(j => ({
      source: 'job', id: j.id, title: j.full_name, category: j.status,
      date: isoDate(j.confirmed_move_date || j.preferred_move_date),
      phone: j.phone, email: j.email,
      from_line1: j.from_line1, from_city: j.from_city, from_postcode: j.from_postcode,
      to_line1: j.to_line1, to_city: j.to_city, to_postcode: j.to_postcode,
      bedrooms: j.bedrooms, status: j.status, internal_notes: j.internal_notes,
      packing_required: j.packing_required, storage_required: j.storage_required,
      assignments: assignmentsByJob[j.id] || [],
    })),
    ...events.map(e => ({
      source: 'event', id: e.id, title: e.title, category: e.category,
      date: isoDate(e.event_date), time: e.event_time,
      address: e.address, phone: e.contact_number, customer_name: e.customer_name,
      notes: e.notes, assignments: assignmentsByEvent[e.id] || [],
      contract_id: e.contract_id, contract_name: e.contract?.company_name || null,
    })),
  ].sort((a, b) => (a.date || '').localeCompare(b.date || ''));

  res.json({ dates, items });
}));

// ── Reschedule ───────────────────────────────────────────────────────────────

router.patch('/reschedule', wrap(async (req, res) => {
  const { source, id, date } = req.body;
  if (!source || !id || !date) return res.status(400).json({ error: 'source, id and date are required' });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return res.status(400).json({ error: 'date must be YYYY-MM-DD' });

  if (source === 'event') {
    const ev = await prisma.plannerEvent.findUnique({ where: { id } });
    if (!ev) return res.status(404).json({ error: 'Event not found' });
    await prisma.plannerEvent.update({ where: { id }, data: { event_date: date } });
    if (date !== ev.event_date) {
      await syncContractJobFromPlannerEvent(id, date);
    }
    return res.json({ ok: true });
  }

  if (source === 'job') {
    const job = await prisma.crmJob.findUnique({
      where: { id },
      select: { id: true, confirmed_move_date: true, preferred_move_date: true },
    });
    if (!job) return res.status(404).json({ error: 'Job not found' });

    if (job.confirmed_move_date) {
      await prisma.crmJob.update({ where: { id }, data: { confirmed_move_date: date } });
    } else {
      await prisma.crmJob.update({ where: { id }, data: { preferred_move_date: date } });
    }
    return res.json({ ok: true });
  }

  res.status(400).json({ error: 'source must be job or event' });
}));

module.exports = router;
