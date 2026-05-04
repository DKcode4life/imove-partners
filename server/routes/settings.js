const express = require('express');
const router = express.Router();
const prisma = require('../db/prisma');
const { authenticate, requireAdmin } = require('../middleware/auth');
const wrap = require('../lib/async-handler');

router.use(authenticate, requireAdmin);

// ── Default seed data (lazy — applied on first GET if tables are empty) ───────

const DEFAULT_STATUSES = [
  { name: 'New Lead',               color: '#3b82f6', sort_order: 0 },
  { name: 'Called V/M',             color: '#8b5cf6', sort_order: 1 },
  { name: 'Contacted',              color: '#7c3aed', sort_order: 2 },
  { name: 'Estimate Sent',          color: '#fbbf24', sort_order: 3 },
  { name: 'Survey Physical',        color: '#06b6d4', sort_order: 4 },
  { name: 'Survey Video',           color: '#0d9488', sort_order: 5 },
  { name: 'Quote Sent',             color: '#f59e0b', sort_order: 6 },
  { name: 'Quote Chased',           color: '#f97316', sort_order: 7 },
  { name: 'Most Likely',            color: '#eab308', sort_order: 8 },
  { name: 'Quote Accepted',         color: '#10b981', sort_order: 9 },
  { name: 'Confirmed No Date',      color: '#059669', sort_order: 10 },
  { name: 'Confirmed Deposit',      color: '#65a30d', sort_order: 11 },
  { name: 'Confirmed Paid',         color: '#15803d', sort_order: 12 },
  { name: 'Completed',              color: '#94a3b8', sort_order: 13 },
  { name: 'Archived / Review Done', color: '#6b7280', sort_order: 14 },
  { name: 'Lost / Cancelled',       color: '#ef4444', sort_order: 15 },
];

const DEFAULT_LEAD_SOURCES = [
  'Direct Enquiry', 'Estate Agent Referral', 'Website',
  'Social Media', 'Word of Mouth', 'Google', 'Repeat Customer', 'Other',
];

const DEFAULT_MOVE_TYPES = [
  'Rental to Rental', 'Rental to Purchase', 'Sale to Purchase', 'Sale to Rental',
  'Storage to Property', 'Partial Move',
];

// Old CRM status names → new granular names (for CrmJob records)
const CRM_JOB_RENAMES = [
  { old: 'Booked Move',      new: 'Confirmed Deposit' },
  { old: 'Survey Booked',    new: 'Survey Physical' },
  { old: 'Survey Completed', new: 'Survey Physical' },
  { old: 'Awaiting Quote',   new: 'Quote Sent' },
  { old: 'In Progress',      new: 'Confirmed Deposit' },
  { old: 'Job Completed',    new: 'Completed' },
];

// CRM status → Partner Portal status (must stay in sync with crm.js PORTAL_STATUS_MAP)
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
};

async function migrateStatuses() {
  // ── 1. Migrate CrmJob status strings to new names (idempotent) ────────────
  for (const { old: oldName, new: newName } of CRM_JOB_RENAMES) {
    await prisma.crmJob.updateMany({ where: { status: oldName }, data: { status: newName } });
  }

  // ── 2. Seed any newly-introduced default statuses, but DO NOT touch
  //     existing rows — users edit colours and drag to reorder, and we
  //     must preserve those changes. New rows slot in at their default
  //     sort_order; if a user-edited row already sits there, the new row
  //     simply gets appended (orderBy `sort_order asc, id asc` keeps it
  //     stable and the user can drag it where they want). ──────────────
  for (const s of DEFAULT_STATUSES) {
    const exists = await prisma.jobStatus.findUnique({ where: { name: s.name } });
    if (!exists) await prisma.jobStatus.create({ data: s });
  }

  // ── 3. Remove ONLY the known-old names from the rename list (and only
  //     if no job still uses them). Custom statuses the user has added
  //     themselves must be preserved. ────────────────────────────────────
  const renamedAwayNames = CRM_JOB_RENAMES.map(r => r.old);
  const stale = await prisma.jobStatus.findMany({ where: { name: { in: renamedAwayNames } } });
  for (const row of stale) {
    const inUse = await prisma.crmJob.count({ where: { status: row.name } });
    if (inUse === 0) await prisma.jobStatus.delete({ where: { id: row.id } });
  }
}

// One-time relocation of 'Estimate Sent' to its new canonical slot
// (between Contacted and Survey Physical). Earlier builds inserted it at
// sort_order 5; this migration moves it to 3 and shifts Survey Physical /
// Survey Video down by one. Guarded by a CompanySetting flag so it only
// runs once per database.
async function relocateEstimateSentOnce() {
  const flag = await prisma.companySetting.findUnique({
    where: { key: 'crm_estimate_sent_slot_v1' },
  });
  if (flag) return;

  const est = await prisma.jobStatus.findUnique({ where: { name: 'Estimate Sent' } });
  if (est) {
    const surveyPhysical = await prisma.jobStatus.findUnique({ where: { name: 'Survey Physical' } });
    const surveyVideo    = await prisma.jobStatus.findUnique({ where: { name: 'Survey Video' } });
    // Only relocate if the layout still matches the previous default —
    // i.e. Estimate Sent sits AFTER both Survey rows. If the user has
    // already dragged things around, leave their order alone.
    if (
      surveyPhysical && surveyVideo &&
      est.sort_order > surveyPhysical.sort_order &&
      est.sort_order > surveyVideo.sort_order
    ) {
      await prisma.jobStatus.update({
        where: { id: surveyPhysical.id },
        data:  { sort_order: est.sort_order },
      });
      await prisma.jobStatus.update({
        where: { id: surveyVideo.id },
        data:  { sort_order: est.sort_order + 1 },
      });
      await prisma.jobStatus.update({
        where: { id: est.id },
        data:  { sort_order: surveyPhysical.sort_order },
      });
    }
  }

  await prisma.companySetting.upsert({
    where:  { key: 'crm_estimate_sent_slot_v1' },
    update: {},
    create: { key: 'crm_estimate_sent_slot_v1', value: 'done' },
  });
}

// One-time backfill: sync every linked partner lead's status from its CRM job.
// Guarded by a CompanySetting flag so it only runs once regardless of API call frequency.
async function backfillPortalStatusesOnce() {
  const flag = await prisma.companySetting.findUnique({ where: { key: 'crm_portal_sync_v2' } });
  if (flag) return;

  const linkedJobs = await prisma.crmJob.findMany({
    where: { lead_id: { not: null } },
    select: { status: true, lead_id: true },
  });

  for (const job of linkedJobs) {
    const portalStatus = PORTAL_STATUS_MAP[job.status];
    if (portalStatus) {
      try { await prisma.lead.update({ where: { id: job.lead_id }, data: { status: portalStatus } }); }
      catch (_) { /* non-fatal — lead may have been deleted */ }
    }
  }

  await prisma.companySetting.upsert({
    where: { key: 'crm_portal_sync_v2' },
    update: {},
    create: { key: 'crm_portal_sync_v2', value: 'done' },
  });
}

async function ensureStatusDefaults() {
  const count = await prisma.jobStatus.count();
  if (count === 0) {
    await prisma.jobStatus.createMany({ data: DEFAULT_STATUSES });
  } else {
    await migrateStatuses();
    await relocateEstimateSentOnce();
  }
  await backfillPortalStatusesOnce();
}

async function ensureLeadSourceDefaults() {
  const count = await prisma.leadSource.count();
  if (count > 0) return;
  await prisma.leadSource.createMany({
    data: DEFAULT_LEAD_SOURCES.map((name, i) => ({ name, sort_order: i })),
  });
}

async function ensureMoveTypeDefaults() {
  const count = await prisma.moveType.count();
  if (count > 0) return;
  await prisma.moveType.createMany({
    data: DEFAULT_MOVE_TYPES.map((name, i) => ({ name, sort_order: i })),
  });
}

// ── Company Settings ──────────────────────────────────────────────────────────

const COMPANY_KEYS = [
  'company_name', 'company_email', 'company_phone',
  'company_website', 'company_address', 'company_registration',
  'zoom_meeting_link',
];

router.get('/company', wrap(async (_req, res) => {
  const rows = await prisma.companySetting.findMany({ where: { key: { in: COMPANY_KEYS } } });
  const result = Object.fromEntries(COMPANY_KEYS.map(k => [k, '']));
  for (const row of rows) result[row.key] = row.value ?? '';
  res.json(result);
}));

router.put('/company', wrap(async (req, res) => {
  const updates = {};
  for (const k of COMPANY_KEYS) {
    if (k in req.body) updates[k] = String(req.body[k] ?? '');
  }
  await prisma.$transaction(
    Object.entries(updates).map(([key, value]) =>
      prisma.companySetting.upsert({ where: { key }, update: { value }, create: { key, value } })
    )
  );
  res.json({ ok: true });
}));

// ── Job Statuses ──────────────────────────────────────────────────────────────

router.get('/statuses', wrap(async (_req, res) => {
  await ensureStatusDefaults();
  const rows = await prisma.jobStatus.findMany({ orderBy: [{ sort_order: 'asc' }, { id: 'asc' }] });
  res.json(rows);
}));

router.post('/statuses', wrap(async (req, res) => {
  const { name, color } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: 'Name is required' });
  const existing = await prisma.jobStatus.findUnique({ where: { name: name.trim() } });
  if (existing) return res.status(400).json({ error: 'A status with that name already exists' });
  const agg = await prisma.jobStatus.aggregate({ _max: { sort_order: true } });
  const sort_order = (agg._max.sort_order ?? 0) + 1;
  const row = await prisma.jobStatus.create({
    data: { name: name.trim(), color: color || '#64748b', sort_order },
  });
  res.status(201).json(row);
}));

router.put('/statuses/reorder', wrap(async (req, res) => {
  const items = req.body;
  if (!Array.isArray(items)) return res.status(400).json({ error: 'Expected array' });
  await prisma.$transaction(
    items.map(({ id, sort_order }) => prisma.jobStatus.update({ where: { id }, data: { sort_order } }))
  );
  res.json({ ok: true });
}));

router.put('/statuses/:id', wrap(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const { name, color } = req.body;
  const data = {};
  if (name !== undefined) data.name = name.trim();
  if (color !== undefined) data.color = color;
  const updated = await prisma.jobStatus.update({ where: { id }, data });
  res.json(updated);
}));

router.delete('/statuses/:id', wrap(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const status = await prisma.jobStatus.findUnique({ where: { id } });
  if (!status) return res.status(404).json({ error: 'Status not found' });
  const inUse = await prisma.crmJob.count({ where: { status: status.name } });
  if (inUse > 0) return res.status(400).json({ error: `Cannot delete: ${inUse} job(s) use this status. Reassign them first.` });
  await prisma.jobStatus.delete({ where: { id } });
  res.json({ ok: true });
}));

// ── Lead Sources ──────────────────────────────────────────────────────────────

router.get('/lead-sources', wrap(async (_req, res) => {
  await ensureLeadSourceDefaults();
  const rows = await prisma.leadSource.findMany({ orderBy: [{ sort_order: 'asc' }, { id: 'asc' }] });
  res.json(rows);
}));

router.post('/lead-sources', wrap(async (req, res) => {
  const { name } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: 'Name is required' });
  const existing = await prisma.leadSource.findUnique({ where: { name: name.trim() } });
  if (existing) return res.status(400).json({ error: 'That lead source already exists' });
  const agg = await prisma.leadSource.aggregate({ _max: { sort_order: true } });
  const sort_order = (agg._max.sort_order ?? 0) + 1;
  const row = await prisma.leadSource.create({ data: { name: name.trim(), sort_order } });
  res.status(201).json(row);
}));

router.put('/lead-sources/reorder', wrap(async (req, res) => {
  const items = req.body;
  if (!Array.isArray(items)) return res.status(400).json({ error: 'Expected array' });
  await prisma.$transaction(
    items.map(({ id, sort_order }) => prisma.leadSource.update({ where: { id }, data: { sort_order } }))
  );
  res.json({ ok: true });
}));

router.put('/lead-sources/:id', wrap(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const { name } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: 'Name is required' });
  const updated = await prisma.leadSource.update({ where: { id }, data: { name: name.trim() } });
  res.json(updated);
}));

router.delete('/lead-sources/:id', wrap(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  await prisma.leadSource.delete({ where: { id } });
  res.json({ ok: true });
}));

// ── Move Types ────────────────────────────────────────────────────────────────

router.get('/move-types', wrap(async (_req, res) => {
  await ensureMoveTypeDefaults();
  const rows = await prisma.moveType.findMany({ orderBy: [{ sort_order: 'asc' }, { id: 'asc' }] });
  res.json(rows);
}));

router.post('/move-types', wrap(async (req, res) => {
  const { name } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: 'Name is required' });
  const existing = await prisma.moveType.findUnique({ where: { name: name.trim() } });
  if (existing) return res.status(400).json({ error: 'That move type already exists' });
  const agg = await prisma.moveType.aggregate({ _max: { sort_order: true } });
  const sort_order = (agg._max.sort_order ?? 0) + 1;
  const row = await prisma.moveType.create({ data: { name: name.trim(), sort_order } });
  res.status(201).json(row);
}));

router.put('/move-types/reorder', wrap(async (req, res) => {
  const items = req.body;
  if (!Array.isArray(items)) return res.status(400).json({ error: 'Expected array' });
  await prisma.$transaction(
    items.map(({ id, sort_order }) => prisma.moveType.update({ where: { id }, data: { sort_order } }))
  );
  res.json({ ok: true });
}));

router.put('/move-types/:id', wrap(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const { name } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: 'Name is required' });
  const updated = await prisma.moveType.update({ where: { id }, data: { name: name.trim() } });
  res.json(updated);
}));

router.delete('/move-types/:id', wrap(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  await prisma.moveType.delete({ where: { id } });
  res.json({ ok: true });
}));

// ── Email Templates ───────────────────────────────────────────────────────────

router.get('/email-templates', wrap(async (_req, res) => {
  const templates = await prisma.emailTemplate.findMany({
    orderBy: { name: 'asc' },
    select: { id: true, name: true, slug: true, subject: true, body_html: true, variables: true },
  });
  res.json(templates);
}));

router.put('/email-templates/:id', wrap(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const { subject, body_html } = req.body;
  const data = {};
  if (subject !== undefined) data.subject = String(subject);
  if (body_html !== undefined) data.body_html = String(body_html);
  if (!Object.keys(data).length) return res.status(400).json({ error: 'Nothing to update' });
  const updated = await prisma.emailTemplate.update({ where: { id }, data });
  res.json(updated);
}));

// ── Inventory Catalog ─────────────────────────────────────────────────────────
// Stored as a single JSON blob in CompanySetting so every device reads the same order.

router.get('/catalog', wrap(async (_req, res) => {
  const row = await prisma.companySetting.findUnique({ where: { key: 'inventory-catalog' } });
  if (!row?.value) return res.json(null); // client falls back to DEFAULT_CATALOG
  res.json(JSON.parse(row.value));
}));

router.put('/catalog', wrap(async (req, res) => {
  if (!Array.isArray(req.body)) return res.status(400).json({ error: 'Expected array' });
  const value = JSON.stringify(req.body);
  await prisma.companySetting.upsert({
    where:  { key: 'inventory-catalog' },
    update: { value },
    create: { key: 'inventory-catalog', value },
  });
  res.json({ ok: true });
}));

// ── Distance Price Bands ──────────────────────────────────────────────────────
// Stored as a JSON array in CompanySetting. Each band: { upToMiles, ratePerCuFt }.

const DEFAULT_DISTANCE_BANDS = [
  { upToMiles: 10,  ratePerCuFt: 0.85 },
  { upToMiles: 30,  ratePerCuFt: 0.95 },
  { upToMiles: 60,  ratePerCuFt: 1.05 },
  { upToMiles: 100, ratePerCuFt: 1.25 },
  { upToMiles: 200, ratePerCuFt: 1.50 },
];

router.get('/distance-price-bands', wrap(async (_req, res) => {
  const row = await prisma.companySetting.findUnique({ where: { key: 'distance_price_bands' } });
  res.json(row?.value ? JSON.parse(row.value) : DEFAULT_DISTANCE_BANDS);
}));

router.put('/distance-price-bands', wrap(async (req, res) => {
  if (!Array.isArray(req.body)) return res.status(400).json({ error: 'Expected array' });
  const value = JSON.stringify(req.body);
  await prisma.companySetting.upsert({
    where:  { key: 'distance_price_bands' },
    update: { value },
    create: { key: 'distance_price_bands', value },
  });
  res.json({ ok: true });
}));

module.exports = router;
