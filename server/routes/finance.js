/**
 * Finance routes — cross-cutting money views for the Settings → Invoices tab.
 *
 * GET /invoices returns EVERY raised invoice in one normalized shape, across
 * both invoice families:
 *   - CrmJob invoices   (Invoice model: deposit | main | additional)
 *   - Contract invoices (ContractInvoice model: weekly contractor billing)
 *
 * "Raised" = not draft and not cancelled. Category buckets drive the client
 * filters: 'removal' (private CRM jobs), 'contract', and 'lux' (contract
 * whose contractor is flagged is_lux).
 */
const express = require('express');
const prisma = require('../db/prisma');
const { authenticate, requireAdmin } = require('../middleware/auth');
const wrap = require('../lib/async-handler');
const { loadPnlContext, computeWeekPnl, upliftedTotals } = require('../lib/weekly-pnl');

const router = express.Router();
router.use(authenticate, requireAdmin);

const MONDAY_RE = /^\d{4}-\d{2}-\d{2}$/;

// Walk Mondays from `from` to `to` inclusive (both YYYY-MM-DD Mondays).
function mondaysBetween(from, to) {
  const out = [];
  const [y, m, d] = from.split('-').map(Number);
  const cur = new Date(Date.UTC(y, m - 1, d));
  while (true) {
    const iso = cur.toISOString().slice(0, 10);
    if (iso > to) break;
    out.push(iso);
    cur.setUTCDate(cur.getUTCDate() + 7);
  }
  return out;
}

// ── Finances overview — weekly P&L totals over a range, for charts/months ────
//
// GET /overview?from=YYYY-MM-DD&to=YYYY-MM-DD (both Mondays). Returns one
// totals row per week (with the Flat Rate VAT uplift applied so figures match
// the weekly P&L panel), every manual extra-income entry in the range, and
// the full admin-costs list. All month grouping happens client-side.
router.get('/overview', wrap(async (req, res) => {
  const { from, to } = req.query;
  if (!MONDAY_RE.test(from || '') || !MONDAY_RE.test(to || '') || from > to) {
    return res.status(400).json({ error: 'from and to are required (YYYY-MM-DD, from <= to)' });
  }
  const mondays = mondaysBetween(from, to);
  if (mondays.length > 130) {
    return res.status(400).json({ error: 'Range too large (max 130 weeks)' });
  }

  const ctx = await loadPnlContext(prisma);
  const weeks = [];
  for (const monday of mondays) {
    const { jobs } = await computeWeekPnl(prisma, monday, ctx);
    weeks.push({ week_start: monday, job_count: jobs.length, ...upliftedTotals(jobs) });
  }

  const [extraIncome, adminCosts] = await Promise.all([
    prisma.extraIncome.findMany({
      where: { week_start: { gte: from, lte: to } },
      orderBy: [{ week_start: 'asc' }, { id: 'asc' }],
    }),
    prisma.adminCost.findMany({ orderBy: [{ sort_order: 'asc' }, { id: 'asc' }] }),
  ]);

  res.json({ from, to, weeks, extra_income: extraIncome, admin_costs: adminCosts });
}));

// ── Extra income (manual weekly side-business entries) ───────────────────────

router.get('/extra-income', wrap(async (req, res) => {
  const { from, to } = req.query;
  const where = {};
  if (from && to) where.week_start = { gte: from, lte: to };
  const rows = await prisma.extraIncome.findMany({
    where,
    orderBy: [{ week_start: 'asc' }, { id: 'asc' }],
  });
  res.json(rows);
}));

router.post('/extra-income', wrap(async (req, res) => {
  const { week_start, label, income, profit } = req.body;
  if (!MONDAY_RE.test(week_start || '')) return res.status(400).json({ error: 'week_start (YYYY-MM-DD) is required' });
  if (!label || !String(label).trim()) return res.status(400).json({ error: 'label is required' });
  const inc = Number(income) || 0;
  // Profit defaults to the income amount when not given (100% margin entry).
  const prof = profit === undefined || profit === null || profit === '' ? inc : Number(profit) || 0;
  const row = await prisma.extraIncome.create({
    data: { week_start, label: String(label).trim(), income: inc, profit: prof },
  });
  res.status(201).json(row);
}));

router.patch('/extra-income/:id', wrap(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const existing = await prisma.extraIncome.findUnique({ where: { id } });
  if (!existing) return res.status(404).json({ error: 'Entry not found' });
  const data = {};
  if ('label' in req.body) {
    if (!req.body.label || !String(req.body.label).trim()) return res.status(400).json({ error: 'label cannot be empty' });
    data.label = String(req.body.label).trim();
  }
  if ('income' in req.body) data.income = Number(req.body.income) || 0;
  if ('profit' in req.body) data.profit = Number(req.body.profit) || 0;
  if ('week_start' in req.body) {
    if (!MONDAY_RE.test(req.body.week_start || '')) return res.status(400).json({ error: 'Invalid week_start' });
    data.week_start = req.body.week_start;
  }
  const row = await prisma.extraIncome.update({ where: { id }, data });
  res.json(row);
}));

router.delete('/extra-income/:id', wrap(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const existing = await prisma.extraIncome.findUnique({ where: { id } });
  if (!existing) return res.status(404).json({ error: 'Entry not found' });
  await prisma.extraIncome.delete({ where: { id } });
  res.json({ ok: true });
}));

// ── Admin costs (fixed monthly overheads) ────────────────────────────────────

router.get('/admin-costs', wrap(async (_req, res) => {
  const rows = await prisma.adminCost.findMany({ orderBy: [{ sort_order: 'asc' }, { id: 'asc' }] });
  res.json(rows);
}));

router.post('/admin-costs', wrap(async (req, res) => {
  const { label, monthly_cost } = req.body;
  if (!label || !String(label).trim()) return res.status(400).json({ error: 'label is required' });
  const max = await prisma.adminCost.aggregate({ _max: { sort_order: true } });
  const row = await prisma.adminCost.create({
    data: {
      label: String(label).trim(),
      monthly_cost: Number(monthly_cost) || 0,
      sort_order: (max._max.sort_order ?? -1) + 1,
    },
  });
  res.status(201).json(row);
}));

router.patch('/admin-costs/:id', wrap(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const existing = await prisma.adminCost.findUnique({ where: { id } });
  if (!existing) return res.status(404).json({ error: 'Cost not found' });
  const data = {};
  if ('label' in req.body) {
    if (!req.body.label || !String(req.body.label).trim()) return res.status(400).json({ error: 'label cannot be empty' });
    data.label = String(req.body.label).trim();
  }
  if ('monthly_cost' in req.body) data.monthly_cost = Number(req.body.monthly_cost) || 0;
  const row = await prisma.adminCost.update({ where: { id }, data });
  res.json(row);
}));

router.delete('/admin-costs/:id', wrap(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const existing = await prisma.adminCost.findUnique({ where: { id } });
  if (!existing) return res.status(404).json({ error: 'Cost not found' });
  await prisma.adminCost.delete({ where: { id } });
  res.json({ ok: true });
}));

router.get('/invoices', wrap(async (req, res) => {
  const [jobInvoices, contractInvoices] = await Promise.all([
    prisma.invoice.findMany({
      where: { status: { notIn: ['draft', 'cancelled'] } },
      select: {
        id: true, job_id: true, invoice_number: true, invoice_type: true,
        status: true, total: true, notes: true,
        sent_at: true, paid_at: true, created_at: true,
        job: { select: { id: true, full_name: true, quote_state: true } },
      },
    }),
    prisma.contractInvoice.findMany({
      where: { status: { not: 'draft' } },
      select: {
        id: true, contract_id: true, invoice_number: true, status: true, total: true,
        week_start: true, week_end: true,
        sent_at: true, paid_at: true, created_at: true,
        contract: { select: { id: true, company_name: true, is_lux: true } },
      },
    }),
  ]);

  const rows = [];

  for (const inv of jobInvoices) {
    // The QuoteBuilder "paid" ticks live in the job's quote_state; honour them
    // even when the invoice row itself hasn't been settled yet, so this list
    // always agrees with what the job profile shows.
    const qs = inv.job?.quote_state || {};
    const tickedPaid = inv.invoice_type === 'deposit'
      ? qs.depositPaid === true
      : inv.invoice_type === 'main'
        ? qs.balancePaid === true
        : false;
    const paid = inv.status === 'paid' || tickedPaid;
    rows.push({
      key: `job-${inv.id}`,
      family: 'job',
      category: 'removal',
      invoice_id: inv.id,
      invoice_number: inv.invoice_number,
      invoice_type: inv.invoice_type, // deposit | main | additional
      label: inv.job?.full_name || '(deleted job)',
      detail: inv.invoice_type === 'additional' ? (inv.notes || 'Ad-hoc charge') : null,
      performer: 'Private removals',
      total: inv.total,
      paid,
      status: paid ? 'paid' : inv.status,
      raised_at: (inv.sent_at || inv.created_at).toISOString(),
      paid_at: inv.paid_at ? inv.paid_at.toISOString() : null,
      job_id: inv.job_id,
      contract_id: null,
      is_lux: false,
    });
  }

  for (const inv of contractInvoices) {
    const isLux = !!inv.contract?.is_lux;
    rows.push({
      key: `contract-${inv.id}`,
      family: 'contract',
      category: isLux ? 'lux' : 'contract',
      invoice_id: inv.id,
      invoice_number: inv.invoice_number,
      invoice_type: 'contract',
      label: inv.contract?.company_name || '(deleted contract)',
      detail: `Week ${inv.week_start} – ${inv.week_end}`,
      performer: inv.contract?.company_name || '(deleted contract)',
      total: inv.total,
      paid: inv.status === 'paid',
      status: inv.status,
      raised_at: (inv.sent_at || inv.created_at).toISOString(),
      paid_at: inv.paid_at ? inv.paid_at.toISOString() : null,
      job_id: null,
      contract_id: inv.contract_id,
      is_lux: isLux,
    });
  }

  rows.sort((a, b) => b.raised_at.localeCompare(a.raised_at));
  res.json({ invoices: rows });
}));

module.exports = router;
