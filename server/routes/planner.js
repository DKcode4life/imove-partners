const express = require('express');
const router = express.Router();
const prisma = require('../db/prisma');
const { authenticate, requireAdmin } = require('../middleware/auth');
const wrap = require('../lib/async-handler');
const { syncDraftInvoiceForJobDate } = require('../lib/contract-invoice-sync');
const { computeAssignmentWage } = require('../lib/wage-calc');
const pnlCalc = require('../lib/pnl-calc');
const { resolveItemColor } = require('../lib/planner-color');
const { loadCategories, colorMap } = require('../lib/job-categories');

function cleanColor(v) {
  if (typeof v !== 'string') return null;
  return /^#[0-9a-fA-F]{6}$/.test(v) ? v.toUpperCase() : null;
}

// Per-staff wage rate fields on PlannerAsset.
// '', null, undefined → null (clears the rate so wage-calc falls back to the
// company-wide ROLE_DEFAULT_RATE / global lux_hourly_rate). Negative values
// are rejected at the route level.
function parseRate(v) {
  if (v === '' || v === null || v === undefined) return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) return undefined; // sentinel: invalid
  return n;
}

async function loadCategoryColors() {
  return colorMap(await loadCategories(prisma));
}

async function loadWageSettings() {
  const rows = await prisma.companySetting.findMany({
    where: { key: { in: ['lux_hourly_rate', 'lorry_driving_bonus'] } },
  });
  const get = (k) => {
    const r = rows.find(x => x.key === k);
    const n = parseFloat(r?.value);
    return Number.isFinite(n) ? n : 0;
  };
  return { luxHourlyRate: get('lux_hourly_rate'), lorryBonus: get('lorry_driving_bonus') };
}

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
  const {
    type, name, role, phone, email, make_model, registration, capacity_notes,
    availability, is_lorry, notes,
    driver_daily_rate, porter_daily_rate, lux_hourly_rate,
  } = req.body;
  if (!type || !name) return res.status(400).json({ error: 'type and name are required' });

  // Per-staff wage rates only apply to staff assets. Vehicles always get null.
  const isStaff = type === 'staff';
  const driverRate = isStaff ? parseRate(driver_daily_rate) : null;
  const porterRate = isStaff ? parseRate(porter_daily_rate) : null;
  const luxRate    = isStaff ? parseRate(lux_hourly_rate)   : null;
  if (driverRate === undefined || porterRate === undefined || luxRate === undefined) {
    return res.status(400).json({ error: 'Wage rates must be a number ≥ 0' });
  }

  const maxRow = await prisma.plannerAsset.aggregate({ _max: { sort_order: true } });
  const sortOrder = (maxRow._max.sort_order ?? 0) + 1;

  const asset = await prisma.plannerAsset.create({
    data: {
      type, name: name.trim(), role: role || null, phone: phone || null,
      email: email || null, make_model: make_model || null, registration: registration || null,
      capacity_notes: capacity_notes || null, availability: availability || 'available',
      is_lorry: type === 'vehicle' ? !!is_lorry : false,
      driver_daily_rate: driverRate,
      porter_daily_rate: porterRate,
      lux_hourly_rate: luxRate,
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
  const {
    name, role, phone, email, make_model, registration, capacity_notes,
    availability, is_lorry, notes,
    driver_daily_rate, porter_daily_rate, lux_hourly_rate,
  } = req.body;

  const asset = await prisma.plannerAsset.findUnique({ where: { id } });
  if (!asset) return res.status(404).json({ error: 'Asset not found' });

  // Wage rates: only applied to staff assets and only when the key is present
  // on the request (so untouched fields stay at their current value).
  const data = {
    name: name?.trim() ?? asset.name,
    role: role || null, phone: phone || null, email: email || null,
    make_model: make_model || null, registration: registration || null,
    capacity_notes: capacity_notes || null,
    availability: availability ?? asset.availability,
    is_lorry: is_lorry === undefined ? asset.is_lorry : (asset.type === 'vehicle' ? !!is_lorry : false),
    notes: notes || null,
  };
  if (asset.type === 'staff') {
    for (const [key, raw] of [
      ['driver_daily_rate', driver_daily_rate],
      ['porter_daily_rate', porter_daily_rate],
      ['lux_hourly_rate',   lux_hourly_rate],
    ]) {
      if (raw === undefined) continue;
      const v = parseRate(raw);
      if (v === undefined) return res.status(400).json({ error: `${key} must be a number ≥ 0` });
      data[key] = v;
    }
  }

  const updated = await prisma.plannerAsset.update({ where: { id }, data });
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
  const { title, category, customer_name, contact_number, address, event_date, event_time, notes, contract_id, planner_color } = req.body;
  if (!title || !event_date) return res.status(400).json({ error: 'title and event_date are required' });

  const ev = await prisma.plannerEvent.create({
    data: {
      title: title.trim(), category: category || 'Quick Job',
      customer_name: customer_name || null, contact_number: contact_number || null,
      address: address || null, event_date, event_time: event_time || null, notes: notes || null,
      contract_id: contract_id ? parseInt(contract_id, 10) : null,
      planner_color: cleanColor(planner_color),
    },
    include: { contract: { select: { id: true, company_name: true } } },
  });
  res.status(201).json(ev);
}));

router.put('/events/:id', wrap(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const { title, category, customer_name, contact_number, address, event_date, event_time, notes, contract_id, planner_color } = req.body;

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
      planner_color: planner_color === undefined ? ev.planner_color : cleanColor(planner_color),
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

// ── Per-item planner color ──────────────────────────────────────────────────
// Used by the click-the-accent-stripe popover in Weekly / Staff View.
// Body: { source: 'job' | 'event', id: number, color: '#hex' | null }.
// null clears the override so the item falls back to contract/category color.

router.patch('/items/color', wrap(async (req, res) => {
  const { source, id, color } = req.body || {};
  const itemId = parseInt(id, 10);
  if (!['job', 'event'].includes(source) || !Number.isFinite(itemId)) {
    return res.status(400).json({ error: "source ('job'|'event') and id are required" });
  }
  const value = color === null ? null : cleanColor(color);

  if (source === 'job') {
    const existing = await prisma.crmJob.findUnique({ where: { id: itemId }, select: { id: true } });
    if (!existing) return res.status(404).json({ error: 'Job not found' });
    await prisma.crmJob.update({ where: { id: itemId }, data: { planner_color: value } });
  } else {
    const existing = await prisma.plannerEvent.findUnique({ where: { id: itemId }, select: { id: true } });
    if (!existing) return res.status(404).json({ error: 'Event not found' });
    await prisma.plannerEvent.update({ where: { id: itemId }, data: { planner_color: value } });
  }
  res.json({ ok: true, color: value });
}));

// ── Assignments ──────────────────────────────────────────────────────────────

const ASSIGNMENT_SELECT = {
  id: true, asset_id: true, job_id: true, event_id: true,
  assigned_date: true, assigned_role: true, daily_rate: true, vehicle_asset_id: true,
  start_time: true, finish_time: true, wage_override: true,
  notes: true, created_at: true,
  asset: { select: { name: true, type: true, role: true } },
};

function flattenAssignment(a) {
  return {
    id: a.id, asset_id: a.asset_id, job_id: a.job_id, event_id: a.event_id,
    assigned_date: a.assigned_date, assigned_role: a.assigned_role,
    daily_rate: a.daily_rate, vehicle_asset_id: a.vehicle_asset_id,
    start_time: a.start_time, finish_time: a.finish_time,
    wage_override: a.wage_override,
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
  if ('vehicle_asset_id' in req.body) {
    data.vehicle_asset_id = req.body.vehicle_asset_id == null ? null : Number(req.body.vehicle_asset_id);
  }
  if ('start_time' in req.body) {
    const v = String(req.body.start_time || '').trim();
    data.start_time = v || null;
  }
  if ('finish_time' in req.body) {
    const v = String(req.body.finish_time || '').trim();
    data.finish_time = v || null;
  }
  if ('wage_override' in req.body) {
    const raw = req.body.wage_override;
    if (raw === null || raw === '' || raw === undefined) {
      data.wage_override = null;
    } else {
      const n = Number(raw);
      if (!Number.isFinite(n) || n < 0) return res.status(400).json({ error: 'Invalid wage_override' });
      data.wage_override = n;
    }
  }
  // Reassign to a different staff member (used by Staff View drag-and-drop
  // between rows). Guards against creating duplicates for (asset, date, job/event).
  if ('asset_id' in req.body) {
    const nextAssetId = Number(req.body.asset_id);
    if (!Number.isFinite(nextAssetId)) return res.status(400).json({ error: 'Invalid asset_id' });
    if (nextAssetId !== a.asset_id) {
      const dupWhere = { asset_id: nextAssetId, assigned_date: a.assigned_date };
      if (a.job_id) dupWhere.job_id = a.job_id; else dupWhere.event_id = a.event_id;
      const existing = await prisma.plannerAssignment.findFirst({ where: dupWhere });
      if (existing) return res.status(409).json({ error: 'Target staff is already on this job', id: existing.id });
      data.asset_id = nextAssetId;
    }
  }

  const updated = await prisma.plannerAssignment.update({ where: { id }, data, select: ASSIGNMENT_SELECT });
  res.json(flattenAssignment(updated));

  // Times drive overtime billing — if they changed, refresh this contractor's
  // draft invoice for the day so the overtime line tracks the new hours live.
  // Best-effort and after the response: must never affect the planner edit.
  if (('start_time' in req.body || 'finish_time' in req.body) && a.event_id) {
    try {
      const ev = await prisma.plannerEvent.findUnique({
        where: { id: a.event_id },
        select: { contract_id: true },
      });
      if (ev?.contract_id) await syncDraftInvoiceForJobDate(ev.contract_id, a.assigned_date);
    } catch (e) {
      console.error('[Planner] overtime draft sync failed:', e.message);
    }
  }
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

  const [jobs, events, categoryColors] = await Promise.all([
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
        planner_color: true,
      },
    }),
    prisma.plannerEvent.findMany({
      where: { event_date: { gte: startDate, lte: endDate } },
      orderBy: [{ event_date: 'asc' }, { event_time: 'asc' }],
      include: { contract: { select: { id: true, company_name: true, color: true } } },
    }),
    loadCategoryColors(),
  ]);

  const items = [
    ...jobs.map(j => ({
      source: 'job', id: j.id, title: j.full_name, category: j.status,
      date: isoDate(j.confirmed_move_date || j.preferred_move_date),
      phone: j.phone, from_postcode: j.from_postcode, to_postcode: j.to_postcode,
      from_line1: j.from_line1, to_line1: j.to_line1, status: j.status,
      planner_color: j.planner_color,
      effective_color: resolveItemColor(
        { source: 'job', planner_color: j.planner_color },
        null,
        { categoryColors }
      ),
    })),
    ...events.map(e => ({
      source: 'event', id: e.id, title: e.title, category: e.category,
      date: isoDate(e.event_date), time: e.event_time,
      address: e.address, phone: e.contact_number, customer_name: e.customer_name,
      contract_id: e.contract_id, contract_name: e.contract?.company_name || null,
      planner_color: e.planner_color,
      effective_color: resolveItemColor(
        { source: 'event', category: e.category, planner_color: e.planner_color },
        e.contract,
        { categoryColors }
      ),
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

  const [jobs, events, assignmentsRaw, categoryColors] = await Promise.all([
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
        planner_color: true,
      },
    }),
    prisma.plannerEvent.findMany({
      where: { event_date: { gte: start, lte: endDate } },
      orderBy: [{ event_date: 'asc' }, { event_time: 'asc' }],
      include: { contract: { select: { id: true, company_name: true, color: true } } },
    }),
    prisma.plannerAssignment.findMany({
      where: { assigned_date: { gte: start, lte: endDate } },
      select: ASSIGNMENT_SELECT,
    }),
    loadCategoryColors(),
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
      planner_color: j.planner_color,
      effective_color: resolveItemColor(
        { source: 'job', planner_color: j.planner_color },
        null,
        { categoryColors }
      ),
    })),
    ...events.map(e => ({
      source: 'event', id: e.id, title: e.title, category: e.category,
      date: isoDate(e.event_date), time: e.event_time,
      address: e.address, phone: e.contact_number, customer_name: e.customer_name,
      notes: e.notes, assignments: assignmentsByEvent[e.id] || [],
      contract_id: e.contract_id, contract_name: e.contract?.company_name || null,
      planner_color: e.planner_color,
      effective_color: resolveItemColor(
        { source: 'event', category: e.category, planner_color: e.planner_color },
        e.contract,
        { categoryColors }
      ),
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

// ── Staff Time Off ───────────────────────────────────────────────────────────

router.post('/time-off', wrap(async (req, res) => {
  const { asset_id, date, reason } = req.body;
  if (!asset_id || !date) return res.status(400).json({ error: 'asset_id and date are required' });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return res.status(400).json({ error: 'date must be YYYY-MM-DD' });

  // Upsert by (asset_id, date) — flipping a day off is idempotent.
  const row = await prisma.staffTimeOff.upsert({
    where: { asset_id_date: { asset_id: Number(asset_id), date } },
    create: { asset_id: Number(asset_id), date, reason: reason || null },
    update: { reason: reason || null },
  });
  res.status(201).json(row);
}));

router.delete('/time-off', wrap(async (req, res) => {
  const { asset_id, date } = req.body;
  if (!asset_id || !date) return res.status(400).json({ error: 'asset_id and date are required' });
  await prisma.staffTimeOff.deleteMany({ where: { asset_id: Number(asset_id), date } });
  res.json({ ok: true });
}));

// ── Staff-centric week view (powers the Staff View grid) ─────────────────────

router.get('/staff-week', wrap(async (req, res) => {
  const { start } = req.query;
  if (!start || !/^\d{4}-\d{2}-\d{2}$/.test(start)) {
    return res.status(400).json({ error: 'start is required (YYYY-MM-DD)' });
  }

  const dates = weekDates(start);
  const endDate = dates[dates.length - 1];

  const [staffAssets, vehicleAssets, assignments, timeOffRows, settings, jobsForWeek, eventsForWeek, categoryColors] = await Promise.all([
    prisma.plannerAsset.findMany({
      where: { type: 'staff' },
      orderBy: [{ sort_order: 'asc' }, { id: 'asc' }],
    }),
    prisma.plannerAsset.findMany({
      where: { type: 'vehicle' },
      orderBy: [{ sort_order: 'asc' }, { id: 'asc' }],
      select: { id: true, name: true, registration: true, is_lorry: true, availability: true },
    }),
    prisma.plannerAssignment.findMany({
      where: {
        assigned_date: { gte: start, lte: endDate },
        asset: { type: 'staff' },
      },
      select: {
        id: true, asset_id: true, assigned_date: true, daily_rate: true,
        assigned_role: true, job_id: true, event_id: true,
        start_time: true, finish_time: true, vehicle_asset_id: true,
        wage_override: true,
        asset: {
          select: {
            id: true, name: true, role: true,
            driver_daily_rate: true, porter_daily_rate: true, lux_hourly_rate: true,
          },
        },
        job: {
          select: {
            id: true, full_name: true, status: true,
            confirmed_move_date: true, preferred_move_date: true,
            planner_color: true,
          },
        },
        event: {
          select: {
            id: true, title: true, category: true, event_date: true, event_time: true,
            planner_color: true,
            contract: { select: { id: true, company_name: true, is_lux: true, color: true } },
            contract_job: { select: { men_needed: true, vans_needed: true, hgv_needed: true } },
          },
        },
      },
      orderBy: [{ assigned_date: 'asc' }, { id: 'asc' }],
    }),
    prisma.staffTimeOff.findMany({
      where: { date: { gte: start, lte: endDate } },
    }),
    loadWageSettings(),
    // Customer (removal) jobs scheduled this week — used to populate the
    // top-of-column "Jobs" list in the Staff View. Mirrors the filter used
    // by GET /planner/week so the two views show the same set.
    prisma.crmJob.findMany({
      where: {
        status: { not: 'Lost / Cancelled' },
        OR: [
          { confirmed_move_date: { gte: start, lte: endDate } },
          { AND: [{ confirmed_move_date: null }, { preferred_move_date: { gte: start, lte: endDate } }] },
        ],
      },
      select: {
        id: true, full_name: true, status: true,
        confirmed_move_date: true, preferred_move_date: true,
        planner_color: true,
      },
    }),
    prisma.plannerEvent.findMany({
      where: { event_date: { gte: start, lte: endDate } },
      orderBy: [{ event_date: 'asc' }, { event_time: 'asc' }],
      select: {
        id: true, title: true, category: true, event_date: true, event_time: true,
        planner_color: true,
        contract: { select: { id: true, company_name: true, is_lux: true, color: true } },
        contract_job: { select: { men_needed: true, vans_needed: true, hgv_needed: true } },
      },
    }),
    loadCategoryColors(),
  ]);

  const vehicleById = new Map(vehicleAssets.map(v => [v.id, v]));
  const timeOffKey = (asset_id, date) => `${asset_id}|${date}`;
  const timeOffMap = new Map(timeOffRows.map(t => [timeOffKey(t.asset_id, t.date), t]));

  // Group assignments by staff → date
  function buildAssignmentRow(a) {
    const vehicle = a.vehicle_asset_id ? vehicleById.get(a.vehicle_asset_id) : null;
    const contract = a.event?.contract || null;
    const wage = computeAssignmentWage({
      assignment: a,
      asset: a.asset,
      vehicle,
      contract,
      event: a.event || null,
      luxHourlyRate: settings.luxHourlyRate,
      lorryBonus: settings.lorryBonus,
    });
    // Resolved Lux £/hr the client should use for the live preview while the
    // user types start/finish times — per-staff override beats the company-wide
    // default. Matches the server-side wage-calc resolution exactly.
    const luxRate = a.asset?.lux_hourly_rate != null
      ? Number(a.asset.lux_hourly_rate)
      : Number(settings.luxHourlyRate || 0);
    // Pick label/category off whichever side is set (job or event)
    let job_label = null, job_category = null, source = null, source_id = null, plannerColor = null;
    if (a.job) {
      source = 'job'; source_id = a.job.id;
      job_label = a.job.full_name;
      job_category = a.job.status;
      plannerColor = a.job.planner_color;
    } else if (a.event) {
      source = 'event'; source_id = a.event.id;
      job_label = a.event.title;
      job_category = a.event.category;
      plannerColor = a.event.planner_color;
    }
    const effective_color = resolveItemColor(
      { source, category: job_category, planner_color: plannerColor },
      contract,
      { categoryColors }
    );
    return {
      assignment_id: a.id,
      source, source_id,
      job_id: a.job_id, event_id: a.event_id,
      job_label, job_category,
      planner_color: plannerColor,
      effective_color,
      contract_id: contract?.id || null,
      contract_name: contract?.company_name || null,
      is_lux_job: !!contract?.is_lux,
      vehicle_asset_id: a.vehicle_asset_id,
      vehicle_label: vehicle ? vehicle.name : null,
      vehicle_is_lorry: !!vehicle?.is_lorry,
      assigned_role: a.assigned_role || a.asset.role,
      start_time: a.start_time || a.event?.event_time || null,
      finish_time: a.finish_time,
      daily_rate: a.daily_rate,
      wage_override: a.wage_override,
      wage_total: wage.total,
      wage_mode: wage.mode,
      wage_bonus: wage.bonus,
      wage_hours: wage.hours,
      // Effective Lux £/hr for this row — used by the client live preview when
      // the user types start/finish times so the previewed wage matches what
      // the server will save.
      lux_hourly_rate: luxRate,
    };
  }

  // ── Build per-day "Jobs" lists for the top of each column ────────────────
  // For each day, list every CrmJob + PlannerEvent scheduled on that date,
  // plus needed staff/van counts (from ContractJob backing the event, when
  // present) and the number of staff currently assigned (computed from the
  // assignments query above).
  const assignedCountByJobDateKey = new Map(); // key = `${source}|${id}|${date}` → number
  function incAssigned(source, id, date) {
    const k = `${source}|${id}|${date}`;
    assignedCountByJobDateKey.set(k, (assignedCountByJobDateKey.get(k) || 0) + 1);
  }
  for (const a of assignments) {
    if (a.job_id) incAssigned('job', a.job_id, a.assigned_date);
    else if (a.event_id) incAssigned('event', a.event_id, a.assigned_date);
  }

  function jobsForDate(date) {
    const list = [];
    for (const j of jobsForWeek) {
      const d = String(j.confirmed_move_date || j.preferred_move_date || '').slice(0, 10);
      if (d !== date) continue;
      list.push({
        source: 'job', id: j.id,
        label: j.full_name,
        category: j.status,
        contract_name: null,
        is_lux: false,
        men_needed: null, vans_needed: null, hgv_needed: null,
        assigned_count: assignedCountByJobDateKey.get(`job|${j.id}|${date}`) || 0,
        time: null,
        planner_color: j.planner_color,
        effective_color: resolveItemColor(
          { source: 'job', planner_color: j.planner_color },
          null,
          { categoryColors }
        ),
      });
    }
    for (const e of eventsForWeek) {
      const d = String(e.event_date).slice(0, 10);
      if (d !== date) continue;
      const cj = e.contract_job;
      list.push({
        source: 'event', id: e.id,
        label: e.title,
        category: e.category,
        contract_name: e.contract?.company_name || null,
        is_lux: !!e.contract?.is_lux,
        planner_color: e.planner_color,
        effective_color: resolveItemColor(
          { source: 'event', category: e.category, planner_color: e.planner_color },
          e.contract,
          { categoryColors }
        ),
        men_needed: cj?.men_needed ?? null,
        vans_needed: cj?.vans_needed ?? null,
        hgv_needed: cj?.hgv_needed ?? null,
        assigned_count: assignedCountByJobDateKey.get(`event|${e.id}|${date}`) || 0,
        time: e.event_time || null,
      });
    }
    return list;
  }

  const day_jobs = {};
  const has_lux = {};
  for (const d of dates) {
    const list = jobsForDate(d);
    day_jobs[d] = list;
    has_lux[d] = list.some(j => j.is_lux);
  }

  const staff = staffAssets.map(s => {
    const days = {};
    for (const d of dates) days[d] = { rows: [], day_off: null };
    for (const a of assignments) {
      if (a.asset_id !== s.id) continue;
      const bucket = days[a.assigned_date];
      if (!bucket) continue;
      // Skip orphan assignments where the underlying job/event no longer matches this date.
      if (a.job) {
        const jobDate = String(a.job.confirmed_move_date || a.job.preferred_move_date || '').slice(0, 10);
        if (jobDate !== a.assigned_date) continue;
        if (a.job.status === 'Lost / Cancelled') continue;
      } else if (a.event) {
        if (String(a.event.event_date).slice(0, 10) !== a.assigned_date) continue;
      } else {
        continue;
      }
      bucket.rows.push(buildAssignmentRow(a));
    }
    for (const d of dates) {
      const off = timeOffMap.get(timeOffKey(s.id, d));
      if (off) days[d].day_off = { id: off.id, reason: off.reason };
    }
    return {
      asset_id: s.id,
      name: s.name,
      role: s.role,
      availability: s.availability,
      days,
    };
  });

  res.json({
    dates,
    staff,
    day_jobs,
    has_lux,
    vehicles: vehicleAssets.map(v => ({
      id: v.id,
      // Display nickname only in Staff View dropdown — registration is
      // omitted at the user's request (cleaner option list).
      label: v.name,
      is_lorry: !!v.is_lorry,
      availability: v.availability,
    })),
    settings: {
      lux_hourly_rate: settings.luxHourlyRate,
      lorry_driving_bonus: settings.lorryBonus,
    },
  });
}));

// ── Per-job Profit & Loss ─────────────────────────────────────────────────────
// Lazy-loaded when a planner card is expanded. `source` is 'job' (CrmJob) or
// 'event' (PlannerEvent); `id` is that row's id.

const PNL_ASSIGNMENT_SELECT = {
  id: true, asset_id: true, assigned_date: true, daily_rate: true,
  assigned_role: true, vehicle_asset_id: true,
  start_time: true, finish_time: true, wage_override: true,
  asset: {
    select: {
      id: true, name: true, role: true,
      driver_daily_rate: true, porter_daily_rate: true, lux_hourly_rate: true,
    },
  },
  event: { select: { event_time: true, contract: { select: { id: true, is_lux: true } } } },
};

// Loads everything needed to compute one job's P&L and returns the math result.
async function computeJobPnl(source, id) {
  const where = source === 'job' ? { job_id: id } : { event_id: id };

  const [lines, assignments, settings] = await Promise.all([
    prisma.jobLedgerLine.findMany({
      where,
      orderBy: [{ sort_order: 'asc' }, { id: 'asc' }],
    }),
    prisma.plannerAssignment.findMany({
      where: { ...where, asset: { type: 'staff' } },
      select: PNL_ASSIGNMENT_SELECT,
    }),
    loadWageSettings(),
  ]);

  // Income suggestion + saved base income.
  let savedIncome = null;
  let suggestion = 0;
  if (source === 'job') {
    const job = await prisma.crmJob.findUnique({
      where: { id },
      select: { id: true, pnl_income: true, quote_amount: true },
    });
    if (!job) return null;
    savedIncome = job.pnl_income;
    suggestion = pnlCalc.jobIncomeSuggestion(job);
  } else {
    const ev = await prisma.plannerEvent.findUnique({
      where: { id },
      select: { id: true, pnl_income: true, contract_job: { select: { items: { select: { total: true } } } } },
    });
    if (!ev) return null;
    savedIncome = ev.pnl_income;
    suggestion = pnlCalc.eventIncomeSuggestion(ev.contract_job);
  }

  const vehicleIds = [...new Set(assignments.map(a => a.vehicle_asset_id).filter(Boolean))];
  const vehicles = vehicleIds.length
    ? await prisma.plannerAsset.findMany({ where: { id: { in: vehicleIds } }, select: { id: true, is_lorry: true } })
    : [];
  const vehicleById = new Map(vehicles.map(v => [v.id, v]));

  const wages_total = pnlCalc.sumAssignmentWages(assignments, {
    vehicleById,
    luxHourlyRate: settings.luxHourlyRate,
    lorryBonus: settings.lorryBonus,
  });

  const baseIncome = pnlCalc.effectiveBaseIncome(savedIncome, suggestion);
  const incomeLineSum = pnlCalc.sumLines(lines, 'income');
  const expenseLineSum = pnlCalc.sumLines(lines, 'expense');
  const { totalIncome, totalExpenses, profit } = pnlCalc.rollup({
    baseIncome, incomeLines: incomeLineSum, expenseLines: expenseLineSum, wages: wages_total,
  });

  return {
    source, id,
    income: savedIncome,                 // raw saved value (null = using suggestion)
    income_suggestion: suggestion,
    income_lines: lines.filter(l => l.kind === 'income'),
    expense_lines: lines.filter(l => l.kind === 'expense'),
    wages_total,
    total_income: totalIncome,
    total_expenses: totalExpenses,
    profit,
  };
}

router.get('/pnl', wrap(async (req, res) => {
  const source = req.query.source;
  const id = parseInt(req.query.id, 10);
  if (!['job', 'event'].includes(source) || !Number.isFinite(id)) {
    return res.status(400).json({ error: "source ('job'|'event') and id are required" });
  }
  const result = await computeJobPnl(source, id);
  if (!result) return res.status(404).json({ error: 'Job not found' });
  res.json(result);
}));

// Set/clear the base income. income null|'' clears → falls back to suggestion.
router.put('/pnl/income', wrap(async (req, res) => {
  const { source, id, income } = req.body || {};
  const itemId = parseInt(id, 10);
  if (!['job', 'event'].includes(source) || !Number.isFinite(itemId)) {
    return res.status(400).json({ error: "source ('job'|'event') and id are required" });
  }

  let value;
  if (income === null || income === '' || income === undefined) {
    value = null;
  } else {
    const n = Number(income);
    if (!Number.isFinite(n) || n < 0) return res.status(400).json({ error: 'income must be a number ≥ 0' });
    value = n;
  }

  if (source === 'job') {
    const existing = await prisma.crmJob.findUnique({ where: { id: itemId }, select: { id: true } });
    if (!existing) return res.status(404).json({ error: 'Job not found' });
    await prisma.crmJob.update({ where: { id: itemId }, data: { pnl_income: value } });
  } else {
    const existing = await prisma.plannerEvent.findUnique({ where: { id: itemId }, select: { id: true } });
    if (!existing) return res.status(404).json({ error: 'Event not found' });
    await prisma.plannerEvent.update({ where: { id: itemId }, data: { pnl_income: value } });
  }

  const result = await computeJobPnl(source, itemId);
  res.json(result);
}));

// Add an income or expense line.
router.post('/pnl/line', wrap(async (req, res) => {
  const { source, id, kind } = req.body || {};
  const itemId = parseInt(id, 10);
  const label = String(req.body?.label ?? '').trim();
  if (!['job', 'event'].includes(source) || !Number.isFinite(itemId)) {
    return res.status(400).json({ error: "source ('job'|'event') and id are required" });
  }
  if (!['income', 'expense'].includes(kind)) {
    return res.status(400).json({ error: "kind must be 'income' or 'expense'" });
  }
  const amountRaw = req.body?.amount;
  const amount = amountRaw === '' || amountRaw == null ? 0 : Number(amountRaw);
  if (!Number.isFinite(amount) || amount < 0) {
    return res.status(400).json({ error: 'amount must be a number ≥ 0' });
  }

  const where = source === 'job' ? { job_id: itemId } : { event_id: itemId };
  const maxRow = await prisma.jobLedgerLine.aggregate({ where, _max: { sort_order: true } });
  const sortOrder = (maxRow._max.sort_order ?? 0) + 1;

  const line = await prisma.jobLedgerLine.create({
    data: {
      job_id: source === 'job' ? itemId : null,
      event_id: source === 'event' ? itemId : null,
      kind, label: label || (kind === 'income' ? 'Income' : 'Expense'),
      amount, sort_order: sortOrder,
    },
  });
  res.status(201).json(line);
}));

// Edit a line's label and/or amount.
router.patch('/pnl/line/:id', wrap(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const line = await prisma.jobLedgerLine.findUnique({ where: { id } });
  if (!line) return res.status(404).json({ error: 'Line not found' });

  const data = {};
  if ('label' in req.body) data.label = String(req.body.label ?? '').trim() || line.label;
  if ('amount' in req.body) {
    const n = req.body.amount === '' || req.body.amount == null ? 0 : Number(req.body.amount);
    if (!Number.isFinite(n) || n < 0) return res.status(400).json({ error: 'amount must be a number ≥ 0' });
    data.amount = n;
  }

  const updated = await prisma.jobLedgerLine.update({ where: { id }, data });
  res.json(updated);
}));

// Delete a line.
router.delete('/pnl/line/:id', wrap(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const line = await prisma.jobLedgerLine.findUnique({ where: { id } });
  if (!line) return res.status(404).json({ error: 'Line not found' });
  await prisma.jobLedgerLine.delete({ where: { id } });
  res.json({ ok: true });
}));

module.exports = router;
