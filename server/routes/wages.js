const express = require('express');
const router = express.Router();
const prisma = require('../db/prisma');
const { authenticate, requireAdmin } = require('../middleware/auth');
const wrap = require('../lib/async-handler');
const { computeAssignmentWage } = require('../lib/wage-calc');
const { weekDates, loadWageSettings: loadWageSettingsShared, loadPnlContext, computeWeekPnl } = require('../lib/weekly-pnl');
const { jobValidDates } = require('../lib/move-schedule');

const loadWageSettings = () => loadWageSettingsShared(prisma);

router.use(authenticate, requireAdmin);

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

// Weekly Profit & Loss rollup. Lists every job/event in the week with income,
// wages, expenses and profit, sorted most-profitable-first. The computation
// lives in lib/weekly-pnl.js, shared with the Finances overview.
router.get('/pnl', wrap(async (req, res) => {
  const { start } = req.query;
  if (!start || !/^\d{4}-\d{2}-\d{2}$/.test(start)) {
    return res.status(400).json({ error: 'start is required (YYYY-MM-DD)' });
  }
  const ctx = await loadPnlContext(prisma);
  res.json(await computeWeekPnl(prisma, start, ctx));
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
