const express = require('express');
const router = express.Router();
const prisma = require('../db/prisma');
const { authenticate, requireAdmin } = require('../middleware/auth');
const wrap = require('../lib/async-handler');

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

  const [assignments, periods] = await Promise.all([
    prisma.plannerAssignment.findMany({
      where: {
        assigned_date: { gte: start, lte: endDate },
        asset: { type: 'staff' },
      },
      select: {
        id: true, asset_id: true, assigned_date: true, daily_rate: true,
        assigned_role: true, job_id: true, event_id: true,
        asset: { select: { id: true, name: true, role: true } },
      },
      orderBy: { assigned_date: 'asc' },
    }),
    prisma.wagePeriod.findMany({ where: { week_start: start } }),
  ]);

  const periodByAsset = new Map(periods.map(p => [p.asset_id, p]));
  const staffMap = new Map();

  for (const a of assignments) {
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
    const rate = a.daily_rate ?? 0;
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

module.exports = router;
