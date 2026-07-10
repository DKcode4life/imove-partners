/**
 * Weekly Profit & Loss computation, shared by:
 *   - GET /wages/pnl        (single week, detailed rows for the P&L panel)
 *   - GET /finance/overview (many weeks, totals only, for charts/months)
 *
 * Lists every job/event in the week with income, wages, expenses and profit.
 * The Flat Rate VAT uplift (8% on flagged rows) is NOT applied to the row
 * values — the P&L panel applies it client-side — but upliftedTotals() gives
 * aggregate figures WITH it applied so overview charts match the panel.
 */
const { computeAssignmentWage } = require('./wage-calc');
const pnlCalc = require('./pnl-calc');
const { computeOvertimeIncomeByEvent } = require('./overtime-calc');
const jobCats = require('./job-categories');
const { jobValidDates } = require('./move-schedule');

// Flat Rate VAT scheme: flagged rows earn an extra 8% income → straight profit.
const FLAT_RATE_UPLIFT = 0.08;

function weekDates(start) {
  // Walk 7 calendar days from `start` (YYYY-MM-DD) using pure date arithmetic —
  // avoids Date/UTC drift entirely.
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

async function loadWageSettings(prisma) {
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

// Loads the per-request constants (wage settings + P&L category exclusions)
// once, so multi-week loops don't refetch them for every week.
async function loadPnlContext(prisma) {
  const [settings, categories] = await Promise.all([
    loadWageSettings(prisma),
    jobCats.loadCategories(prisma),
  ]);
  return { settings, excludedPnl: jobCats.excludedPnlNames(categories) };
}

async function computeWeekPnl(prisma, start, ctx) {
  const { settings, excludedPnl } = ctx;
  const dates = weekDates(start);
  const endDate = dates[dates.length - 1];

  const [jobs, events, assignments, lines, overtimeByEvent] = await Promise.all([
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
    computeOvertimeIncomeByEvent(prisma, start, endDate),
  ]);

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
    const baseIncome = pnlCalc.effectiveBaseIncome(
      e.pnl_income,
      pnlCalc.eventIncomeSuggestion(e.contract_job, overtimeByEvent.get(e.id) || 0),
    );
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

  return { week_start: start, jobs: rows, totals };
}

// Aggregate totals WITH the Flat Rate VAT uplift applied to flagged rows —
// what the P&L panel shows after its client-side uplift, so overview charts
// and month summaries agree with the weekly panel.
function upliftedTotals(rows) {
  const t = { income: 0, wages: 0, expenses: 0, profit: 0 };
  for (const r of rows) {
    const uplift = r.vat_flat_rate ? r.income * FLAT_RATE_UPLIFT : 0;
    t.income += r.income + uplift;
    t.wages += r.wages;
    t.expenses += r.expenses;
    t.profit += r.profit + uplift;
  }
  for (const k of Object.keys(t)) t[k] = pnlCalc.round2(t[k]);
  return t;
}

module.exports = { FLAT_RATE_UPLIFT, weekDates, loadWageSettings, loadPnlContext, computeWeekPnl, upliftedTotals };
