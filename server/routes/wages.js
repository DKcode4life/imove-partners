const express = require('express');
const router = express.Router();
const prisma = require('../db/prisma');
const { authenticate, requireAdmin } = require('../middleware/auth');
const wrap = require('../lib/async-handler');
const { computeAssignmentWage } = require('../lib/wage-calc');
const pnlCalc = require('../lib/pnl-calc');
const jobCats = require('../lib/job-categories');
const { jobValidDates } = require('../lib/move-schedule');

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

router.use(authenticate, requireAdmin);

function weekDates(start) {
  // Walk 7 calendar days from `start` (YYYY-MM-DD) using a pure date arithmetic
  // approach — avoids Date/UTC drift entirely.
  const dates = [];
  const [y, m, d] = start.split('-').map(Number);
  const base = new Date(Date.UTC(y, m - 1, d));
  for (let i = 0; i < 7; i++) {
    const cur = new Date(base);
    cur.setUTCDate(base.getUTCDate() + i);
    dates.push(cur.toISOString().slice(0, 10));
  }
  return dates;
}

// Returns the wage rollup for the week starting at ?start=YYYY-MM-DD (Monday).
//
// Pulls every staff assignment in the week, groups by staff, and merges in the
// editable per-week fields (expenses, advances, notes, paid). Earnings come
// from the assignment.daily_rate set on the planner.
router.get('/week', wrap(async (req, res) => {
  const { start } = req.query;
  if (!start || !/^\d{4}-\d{2}-\d{2}$/.test(start)) {
    return res.status(400).json({ error: 'start is required (YYYY-MM-DD)' });
  }

  const dates = weekDates(start);
  const endDate = dates[dates.length - 1];

  const [assignments, periods, settings] = await Promise.all([
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
        job:   { select: { status: true, confirmed_move_date: true, preferred_move_date: true, move_schedule: true } },
        event: { select: { event_date: true, event_time: true, contract: { select: { id: true, is_lux: true } } } },
      },
      orderBy: { assigned_date: 'asc' },
    }),
    prisma.wagePeriod.findMany({ where: { week_start: start } }),
    loadWageSettings(),
  ]);

  // Look up vehicle assets referenced by these assignments in one query.
  const vehicleIds = [...new Set(assignments.map(a => a.vehicle_asset_id).filter(Boolean))];
  const vehicles = vehicleIds.length
    ? await prisma.plannerAsset.findMany({
        where: { id: { in: vehicleIds } },
        select: { id: true, is_lorry: true },
      })
    : [];
  const vehicleById = new Map(vehicles.map(v => [v.id, v]));

  const periodByAsset = new Map(periods.map(p => [p.asset_id, p]));
  const staffMap = new Map();

  for (const a of assignments) {
    // Skip orphan assignments — rows where the underlying job/event no longer
    // matches this date. These accumulate when a job is moved to another day,
    // marked Lost / Cancelled, or its move date is cleared. Without this filter,
    // wages would show stale earnings the planner no longer displays.
    if (a.job_id) {
      if (!a.job) continue; // cascade should have removed it; defensive
      if (a.job.status === 'Lost / Cancelled') continue;
      // Valid on the move date OR any additional day (packing, delivery, …) so
      // crew get paid for extra-day work. Orphans (date matches nothing) skip.
      if (!jobValidDates(a.job).has(a.assigned_date)) continue;
    } else if (a.event_id) {
      if (!a.event) continue;
      if (String(a.event.event_date).slice(0, 10) !== a.assigned_date) continue;
    } else {
      // Assignment with neither job nor event — orphan
      continue;
    }

    const id = a.asset_id;
    if (!staffMap.has(id)) {
      staffMap.set(id, {
        asset_id: id,
        name: a.asset.name,
        role: a.asset.role,
        days: {},          // date -> { rate, role, ref }
        total: 0,
      });
    }
    const entry = staffMap.get(id);
    const wage = computeAssignmentWage({
      assignment: a,
      asset: a.asset,
      vehicle: vehicleById.get(a.vehicle_asset_id) || null,
      contract: a.event?.contract || null,
      event: a.event || null,
      luxHourlyRate: settings.luxHourlyRate,
      lorryBonus: settings.lorryBonus,
    });
    const rate = wage.total;
    const role = a.assigned_role || a.asset.role;
    // Aggregate (in case the same person has two assignments on the same day)
    const prev = entry.days[a.assigned_date];
    entry.days[a.assigned_date] = {
      rate: (prev?.rate ?? 0) + rate,
      role,
      count: (prev?.count ?? 0) + 1,
    };
    entry.total += rate;
  }

  const staff = Array.from(staffMap.values())
    .map(s => {
      const p = periodByAsset.get(s.asset_id);
      const expenses = p?.expenses ?? 0;
      const advances = p?.advances ?? 0;
      const balance = s.total + expenses - advances;
      return {
        ...s,
        expenses,
        advances,
        balance,
        notes: p?.notes ?? '',
        paid: p?.paid ?? false,
        paid_at: p?.paid_at ?? null,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));

  // Company-side rollup by role
  const byRole = {};
  let companyTotal = 0;
  for (const s of staff) {
    const key = (s.role || 'other').toLowerCase();
    if (!byRole[key]) byRole[key] = { role: key, headcount: 0, total: 0 };
    byRole[key].headcount += 1;
    byRole[key].total += s.total;
    companyTotal += s.total;
  }

  res.json({
    week_start: start,
    dates,
    staff,
    summary: {
      total_earnings: companyTotal,
      by_role: Object.values(byRole),
      headcount: staff.length,
    },
  });
}));

// Upsert the editable fields for one staff member's week.
router.put('/period', wrap(async (req, res) => {
  const { asset_id, week_start, expenses, advances, notes, paid } = req.body;
  if (!asset_id || !week_start || !/^\d{4}-\d{2}-\d{2}$/.test(week_start)) {
    return res.status(400).json({ error: 'asset_id and week_start (YYYY-MM-DD) are required' });
  }

  const data = {};
  if (expenses !== undefined) data.expenses = Number(expenses) || 0;
  if (advances !== undefined) data.advances = Number(advances) || 0;
  if (notes !== undefined)    data.notes    = notes || null;
  if (paid !== undefined) {
    data.paid = !!paid;
    data.paid_at = paid ? new Date() : null;
  }

  const row = await prisma.wagePeriod.upsert({
    where: { asset_id_week_start: { asset_id: Number(asset_id), week_start } },
    create: { asset_id: Number(asset_id), week_start, ...data },
    update: data,
  });
  res.json(row);
}));

// Weekly Profit & Loss rollup for the wages page. Lists every job/event in the
// week with income, wages, expenses and profit, sorted most-profitable-first.
router.get('/pnl', wrap(async (req, res) => {
  const { start } = req.query;
  if (!start || !/^\d{4}-\d{2}-\d{2}$/.test(start)) {
    return res.status(400).json({ error: 'start is required (YYYY-MM-DD)' });
  }

  const dates = weekDates(start);
  const endDate = dates[dates.length - 1];

  const [jobs, events, assignments, lines, settings] = await Promise.all([
    prisma.crmJob.findMany({
      where: {
        status: { not: 'Lost / Cancelled' },
        OR: [
          { confirmed_move_date: { gte: start, lte: endDate } },
          { AND: [{ confirmed_move_date: null }, { preferred_move_date: { gte: start, lte: endDate } }] },
        ],
      },
      select: {
        id: true, full_name: true, quote_amount: true, pnl_income: true,
        vat_flat_rate: true,
        confirmed_move_date: true, preferred_move_date: true,
      },
    }),
    prisma.plannerEvent.findMany({
      where: { event_date: { gte: start, lte: endDate } },
      select: {
        id: true, title: true, event_date: true, pnl_income: true, category: true,
        vat_flat_rate: true,
        contract_job: { select: { items: { select: { total: true } } } },
      },
    }),
    prisma.plannerAssignment.findMany({
      where: { assigned_date: { gte: start, lte: endDate }, asset: { type: 'staff' } },
      select: {
        id: true, asset_id: true, assigned_date: true, daily_rate: true,
        assigned_role: true, job_id: true, event_id: true,
        start_time: true, finish_time: true, vehicle_asset_id: true, wage_override: true,
        asset: { select: { id: true, role: true, driver_daily_rate: true, porter_daily_rate: true, lux_hourly_rate: true } },
        job:   { select: { status: true, confirmed_move_date: true, preferred_move_date: true, move_schedule: true } },
        event: { select: { event_date: true, event_time: true, contract: { select: { id: true, is_lux: true } } } },
      },
    }),
    prisma.jobLedgerLine.findMany({
      where: {
        OR: [
          { job:   { OR: [
            { confirmed_move_date: { gte: start, lte: endDate } },
            { AND: [{ confirmed_move_date: null }, { preferred_move_date: { gte: start, lte: endDate } }] },
          ] } },
          { event: { event_date: { gte: start, lte: endDate } } },
        ],
      },
    }),
    loadWageSettings(),
  ]);

  // Categories toggled out of the P&L are hidden from the list (and totals).
  const categories = await jobCats.loadCategories(prisma);
  const excludedPnl = jobCats.excludedPnlNames(categories);
  const removalExcluded = excludedPnl.has('Removal Job');

  // Vehicles referenced by these assignments (for the lorry bonus).
  const vehicleIds = [...new Set(assignments.map(a => a.vehicle_asset_id).filter(Boolean))];
  const vehicles = vehicleIds.length
    ? await prisma.plannerAsset.findMany({ where: { id: { in: vehicleIds } }, select: { id: true, is_lorry: true } })
    : [];
  const vehicleById = new Map(vehicles.map(v => [v.id, v]));

  // Group wages by job/event, skipping orphan/stale assignments (same filter as /wages/week).
  const wagesByKey = new Map(); // key = `${source}|${id}`
  function addWage(key, total) { wagesByKey.set(key, (wagesByKey.get(key) || 0) + total); }
  for (const a of assignments) {
    if (a.job_id) {
      if (!a.job || a.job.status === 'Lost / Cancelled') continue;
      // Move date OR an additional day → fold into this job's wages (keyed by
      // job_id, listed once at the move date). Extra days never get their own row.
      if (!jobValidDates(a.job).has(a.assigned_date)) continue;
    } else if (a.event_id) {
      if (!a.event || String(a.event.event_date).slice(0, 10) !== a.assigned_date) continue;
    } else continue;
    const wage = computeAssignmentWage({
      assignment: a, asset: a.asset,
      vehicle: a.vehicle_asset_id ? (vehicleById.get(a.vehicle_asset_id) || null) : null,
      contract: a.event?.contract || null, event: a.event || null,
      luxHourlyRate: settings.luxHourlyRate, lorryBonus: settings.lorryBonus,
    });
    addWage(`${a.job_id ? 'job' : 'event'}|${a.job_id || a.event_id}`, wage.total);
  }

  // Group ledger lines by job/event.
  const linesByKey = new Map();
  for (const l of lines) {
    const key = `${l.job_id ? 'job' : 'event'}|${l.job_id || l.event_id}`;
    if (!linesByKey.has(key)) linesByKey.set(key, []);
    linesByKey.get(key).push(l);
  }

  const rows = [];
  for (const j of jobs) {
    if (removalExcluded) continue;
    const key = `job|${j.id}`;
    const myLines = linesByKey.get(key) || [];
    const baseIncome = pnlCalc.effectiveBaseIncome(j.pnl_income, pnlCalc.jobIncomeSuggestion(j));
    const wages = pnlCalc.round2(wagesByKey.get(key) || 0);
    const { totalIncome, totalExpenses, profit } = pnlCalc.rollup({
      baseIncome, incomeLines: pnlCalc.sumLines(myLines, 'income'),
      expenseLines: pnlCalc.sumLines(myLines, 'expense'), wages,
    });
    rows.push({
      source: 'job', id: j.id, label: j.full_name,
      date: String(j.confirmed_move_date || j.preferred_move_date || '').slice(0, 10),
      income: totalIncome, wages, expenses: totalExpenses, profit,
      vat_flat_rate: !!j.vat_flat_rate,
    });
  }
  for (const e of events) {
    if (e.category && excludedPnl.has(e.category)) continue;
    const key = `event|${e.id}`;
    const myLines = linesByKey.get(key) || [];
    const baseIncome = pnlCalc.effectiveBaseIncome(e.pnl_income, pnlCalc.eventIncomeSuggestion(e.contract_job));
    const wages = pnlCalc.round2(wagesByKey.get(key) || 0);
    const { totalIncome, totalExpenses, profit } = pnlCalc.rollup({
      baseIncome, incomeLines: pnlCalc.sumLines(myLines, 'income'),
      expenseLines: pnlCalc.sumLines(myLines, 'expense'), wages,
    });
    rows.push({
      source: 'event', id: e.id, label: e.title,
      date: String(e.event_date).slice(0, 10),
      income: totalIncome, wages, expenses: totalExpenses, profit,
      vat_flat_rate: !!e.vat_flat_rate,
    });
  }

  rows.sort((a, b) => b.profit - a.profit);

  const totals = rows.reduce((t, r) => {
    t.income += r.income; t.wages += r.wages; t.expenses += r.expenses; t.profit += r.profit;
    return t;
  }, { income: 0, wages: 0, expenses: 0, profit: 0 });
  for (const k of Object.keys(totals)) totals[k] = pnlCalc.round2(totals[k]);

  res.json({ week_start: start, jobs: rows, totals });
}));

// Toggle the Flat Rate VAT uplift flag for a single P&L row (a CRM job or a
// planner event). The 8% uplift itself is applied client-side for the P&L view.
router.patch('/pnl/flat-rate', wrap(async (req, res) => {
  const { source, id, vat_flat_rate } = req.body;
  const rowId = parseInt(id, 10);
  if (!Number.isFinite(rowId) || (source !== 'job' && source !== 'event')) {
    return res.status(400).json({ error: 'source (job|event) and numeric id are required' });
  }
  const data = { vat_flat_rate: !!vat_flat_rate };
  if (source === 'job') {
    await prisma.crmJob.update({ where: { id: rowId }, data });
  } else {
    await prisma.plannerEvent.update({ where: { id: rowId }, data });
  }
  res.json({ ok: true, source, id: rowId, vat_flat_rate: data.vat_flat_rate });
}));

module.exports = router;
