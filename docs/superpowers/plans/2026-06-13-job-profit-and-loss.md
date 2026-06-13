# Job Profit & Loss Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add per-job income/expense tracking on the planner and a weekly Profit & Loss summary on the wages page, where profit = total income − wages − total expenses.

**Architecture:** A nullable `pnl_income` column on `CrmJob` and `PlannerEvent` holds the base income; a single polymorphic `JobLedgerLine` table (kind `income`|`expense`) holds additional income lines and expense lines. A pure helper module (`pnl-calc.js`) does all the P&L math by reusing the existing `wage-calc.js`. New endpoints live in the existing `planner.js` (per-job editing) and `wages.js` (weekly rollup) routers. The planner job card gets a lazy-loaded P&L block; the wages page gets a P&L summary section below the existing table.

**Tech Stack:** Node/Express, Prisma (SQLite via `prisma db push`), React + TypeScript, Tailwind, axios.

**Note on testing:** This project has no test runner. Pure logic in `pnl-calc.js` is verified with a standalone `node` script (no framework). Endpoints and UI are verified by running the app (`npm run dev`) and checking behavior, matching how this codebase is already validated.

---

## File Structure

**Create:**
- `server/lib/pnl-calc.js` — pure P&L math (income suggestion, wage summing via wage-calc, totals, profit).
- `scripts/check-pnl-calc.js` — standalone sanity check for `pnl-calc.js`.
- `client/src/components/JobPnlPanel.tsx` — the P&L block rendered inside an expanded planner job card.

**Modify:**
- `prisma/schema.prisma` — add `pnl_income` to `CrmJob` and `PlannerEvent`; add `JobLedgerLine` model + back-relations.
- `server/routes/planner.js` — add `/pnl` GET + income/line write endpoints.
- `server/routes/wages.js` — add `GET /pnl` weekly rollup.
- `client/src/types/index.ts` — add P&L response types.
- `client/src/pages/admin/CRMPlanner.tsx` — render `JobPnlPanel` in the expanded `JobCard`.
- `client/src/pages/admin/CRMWages.tsx` — add the weekly P&L summary section.

---

## Task 1: Schema — income column + ledger line table

**Files:**
- Modify: `prisma/schema.prisma`

- [ ] **Step 1: Add `pnl_income` to `CrmJob`**

In `model CrmJob`, immediately after the `planner_color String?` line (around line 161), add:

```prisma
  // Per-job P&L base income (manual; UI prefills a smart suggestion when null)
  pnl_income              Float?
```

And add a back-relation in `CrmJob`'s relation block (after `change_logs JobChangeLog[]`):

```prisma
  ledger_lines        JobLedgerLine[]
```

- [ ] **Step 2: Add `pnl_income` to `PlannerEvent`**

In `model PlannerEvent`, after the `planner_color String?` line (around line 253), add:

```prisma
  pnl_income     Float?   // per-job P&L base income (manual; UI prefills suggestion when null)
```

And add a back-relation in `PlannerEvent` (after `contract_job ContractJob?`):

```prisma
  ledger_lines JobLedgerLine[]
```

- [ ] **Step 3: Add the `JobLedgerLine` model**

After `model PlannerAssignment { ... }` (after line 284), add:

```prisma
model JobLedgerLine {
  id         Int      @id @default(autoincrement())
  job_id     Int?
  event_id   Int?
  kind       String // 'income' | 'expense'
  label      String
  amount     Float    @default(0)
  sort_order Int      @default(0)
  created_at DateTime @default(now())

  job   CrmJob?       @relation(fields: [job_id], references: [id], onDelete: Cascade)
  event PlannerEvent? @relation(fields: [event_id], references: [id], onDelete: Cascade)

  @@index([job_id])
  @@index([event_id])
  @@map("job_ledger_lines")
}
```

- [ ] **Step 4: Apply schema + regenerate client**

Run: `npm run db:push`
Expected: Prisma reports the new column/table, ends with "Your database is now in sync with your Prisma schema." and "Generated Prisma Client".

- [ ] **Step 5: Commit**

```bash
git add prisma/schema.prisma
git commit -m "feat(pnl): add pnl_income columns and JobLedgerLine model"
```

---

## Task 2: Pure P&L math helper

**Files:**
- Create: `server/lib/pnl-calc.js`

- [ ] **Step 1: Write `pnl-calc.js`**

```js
/**
 * Profit & Loss math — pure functions shared by the planner per-job endpoint
 * and the wages weekly rollup. All DB access stays in the routes; this module
 * only does arithmetic so it can be reasoned about and checked in isolation.
 *
 * Profit = total income − wages − total expenses  (operational only, ex-VAT)
 */

const { computeAssignmentWage } = require('./wage-calc');

function round2(n) {
  return +(Number(n) || 0).toFixed(2);
}

/**
 * The income figure to display/use for a job: the manually saved value when set,
 * otherwise the smart suggestion (which is never persisted on its own).
 */
function effectiveBaseIncome(pnlIncome, suggestion) {
  return pnlIncome != null ? Number(pnlIncome) : Number(suggestion || 0);
}

/**
 * Smart suggestion for a removal job (CrmJob): its quote amount.
 */
function jobIncomeSuggestion(job) {
  return round2(job?.quote_amount);
}

/**
 * Smart suggestion for a contract event: the sum of that specific contract
 * job's line-item totals (the per-job slice of the weekly contract invoice).
 * Plain quick events (no linked contract job) suggest 0.
 * @param {{ items?: {total:number}[] }|null} contractJob
 */
function eventIncomeSuggestion(contractJob) {
  if (!contractJob || !Array.isArray(contractJob.items)) return 0;
  return round2(contractJob.items.reduce((s, it) => s + (Number(it.total) || 0), 0));
}

function sumLines(lines, kind) {
  return round2(
    (lines || [])
      .filter(l => l.kind === kind)
      .reduce((s, l) => s + (Number(l.amount) || 0), 0)
  );
}

/**
 * Total wages for a set of assignments, reusing the canonical wage calculator.
 * Each assignment must be loaded with `asset` and (for events) `event.contract`.
 * @param {Array} assignments
 * @param {{ vehicleById: Map, luxHourlyRate:number, lorryBonus:number }} ctx
 */
function sumAssignmentWages(assignments, { vehicleById, luxHourlyRate, lorryBonus }) {
  let total = 0;
  for (const a of assignments || []) {
    const wage = computeAssignmentWage({
      assignment: a,
      asset: a.asset,
      vehicle: a.vehicle_asset_id ? (vehicleById.get(a.vehicle_asset_id) || null) : null,
      contract: a.event?.contract || null,
      event: a.event || null,
      luxHourlyRate,
      lorryBonus,
    });
    total += wage.total;
  }
  return round2(total);
}

/**
 * Roll the parts into income/expense/profit. `baseIncome` is the effective base
 * (saved or suggestion); income lines are added on top.
 */
function rollup({ baseIncome, incomeLines, expenseLines, wages }) {
  const totalIncome = round2(Number(baseIncome || 0) + Number(incomeLines || 0));
  const totalExpenses = round2(expenseLines);
  const profit = round2(totalIncome - Number(wages || 0) - totalExpenses);
  return { totalIncome, totalExpenses, profit };
}

module.exports = {
  round2,
  effectiveBaseIncome,
  jobIncomeSuggestion,
  eventIncomeSuggestion,
  sumLines,
  sumAssignmentWages,
  rollup,
};
```

- [ ] **Step 2: Commit**

```bash
git add server/lib/pnl-calc.js
git commit -m "feat(pnl): add pure P&L math helper"
```

---

## Task 3: Sanity-check script for the helper

**Files:**
- Create: `scripts/check-pnl-calc.js`

- [ ] **Step 1: Write the check script**

```js
// Standalone sanity check for server/lib/pnl-calc.js — run with `node scripts/check-pnl-calc.js`.
// No test framework in this project; this asserts the pure math by hand.
const assert = require('assert');
const pnl = require('../server/lib/pnl-calc');

// effectiveBaseIncome: saved value wins; null falls back to suggestion
assert.strictEqual(pnl.effectiveBaseIncome(1200, 999), 1200);
assert.strictEqual(pnl.effectiveBaseIncome(null, 999), 999);
assert.strictEqual(pnl.effectiveBaseIncome(0, 999), 0); // explicit zero is a real value

// suggestions
assert.strictEqual(pnl.jobIncomeSuggestion({ quote_amount: 850.5 }), 850.5);
assert.strictEqual(pnl.jobIncomeSuggestion({ quote_amount: null }), 0);
assert.strictEqual(
  pnl.eventIncomeSuggestion({ items: [{ total: 100 }, { total: 49.99 }] }),
  149.99
);
assert.strictEqual(pnl.eventIncomeSuggestion(null), 0);

// line sums by kind
const lines = [
  { kind: 'expense', amount: 80 },
  { kind: 'expense', amount: 20 },
  { kind: 'income', amount: 50 },
];
assert.strictEqual(pnl.sumLines(lines, 'expense'), 100);
assert.strictEqual(pnl.sumLines(lines, 'income'), 50);

// rollup: income(base+lines) − wages − expenses
const r = pnl.rollup({ baseIncome: 1000, incomeLines: 50, expenseLines: 100, wages: 420 });
assert.strictEqual(r.totalIncome, 1050);
assert.strictEqual(r.totalExpenses, 100);
assert.strictEqual(r.profit, 530);

// loss case (no income yet)
const loss = pnl.rollup({ baseIncome: 0, incomeLines: 0, expenseLines: 80, wages: 300 });
assert.strictEqual(loss.profit, -380);

console.log('pnl-calc sanity checks passed');
```

- [ ] **Step 2: Run it**

Run: `node scripts/check-pnl-calc.js`
Expected: prints `pnl-calc sanity checks passed`, exit code 0.

- [ ] **Step 3: Commit**

```bash
git add scripts/check-pnl-calc.js
git commit -m "test(pnl): sanity-check script for P&L math helper"
```

---

## Task 4: Planner per-job P&L endpoints

**Files:**
- Modify: `server/routes/planner.js`

All snippets go **before** the final `module.exports = router;` line. The router already has `authenticate, requireAdmin` applied and imports `prisma`, `wrap`, `computeAssignmentWage`.

- [ ] **Step 1: Add the P&L imports near the top of `planner.js`**

After the existing `const { computeAssignmentWage } = require('../lib/wage-calc');` line (line 7), add:

```js
const pnlCalc = require('../lib/pnl-calc');
```

- [ ] **Step 2: Add a shared loader + the GET endpoint**

Insert before `module.exports = router;`:

```js
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
```

- [ ] **Step 3: Add the income + line write endpoints**

Insert directly after the GET `/pnl` route, still before `module.exports`:

```js
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
```

- [ ] **Step 4: Start the app and smoke-test the endpoints**

Run: `npm run dev`
Then in the planner UI (after Task 7 the panel exists; for now verify the server boots cleanly). Expected: server logs show it started with no Prisma errors and the new routes registered (no crash on require).

- [ ] **Step 5: Commit**

```bash
git add server/routes/planner.js
git commit -m "feat(pnl): planner per-job P&L endpoints (get/income/line CRUD)"
```

---

## Task 5: Wages weekly P&L rollup endpoint

**Files:**
- Modify: `server/routes/wages.js`

- [ ] **Step 1: Add the import**

After `const { computeAssignmentWage } = require('../lib/wage-calc');` (line 6), add:

```js
const pnlCalc = require('../lib/pnl-calc');
```

- [ ] **Step 2: Add the `GET /pnl` route**

Insert before `module.exports = router;`:

```js
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
        confirmed_move_date: true, preferred_move_date: true,
      },
    }),
    prisma.plannerEvent.findMany({
      where: { event_date: { gte: start, lte: endDate } },
      select: {
        id: true, title: true, event_date: true, pnl_income: true,
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
        job:   { select: { status: true, confirmed_move_date: true, preferred_move_date: true } },
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
      const d = String(a.job.confirmed_move_date || a.job.preferred_move_date || '').slice(0, 10);
      if (d !== a.assigned_date) continue;
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
    });
  }
  for (const e of events) {
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
```

- [ ] **Step 3: Verify the server still boots**

Run: `npm run dev` (if not already running; nodemon reloads on save).
Expected: no crash, server logs a clean restart.

- [ ] **Step 4: Commit**

```bash
git add server/routes/wages.js
git commit -m "feat(pnl): weekly P&L rollup endpoint on wages router"
```

---

## Task 6: Client types + API surface

**Files:**
- Modify: `client/src/types/index.ts`

- [ ] **Step 1: Add P&L types**

Append to the end of `client/src/types/index.ts`:

```ts
export interface JobLedgerLine {
  id: number;
  job_id?: number | null;
  event_id?: number | null;
  kind: 'income' | 'expense';
  label: string;
  amount: number;
  sort_order: number;
}

export interface JobPnl {
  source: 'job' | 'event';
  id: number;
  income: number | null;          // raw saved base income; null = using suggestion
  income_suggestion: number;
  income_lines: JobLedgerLine[];
  expense_lines: JobLedgerLine[];
  wages_total: number;
  total_income: number;
  total_expenses: number;
  profit: number;
}

export interface WeeklyPnlRow {
  source: 'job' | 'event';
  id: number;
  label: string;
  date: string;
  income: number;
  wages: number;
  expenses: number;
  profit: number;
}

export interface WeeklyPnlResponse {
  week_start: string;
  jobs: WeeklyPnlRow[];
  totals: { income: number; wages: number; expenses: number; profit: number };
}
```

- [ ] **Step 2: Verify the client type-checks**

Run: `cd client && npx tsc --noEmit`
Expected: completes with no errors (the new types are unused so far, which is fine).

- [ ] **Step 3: Commit**

```bash
git add client/src/types/index.ts
git commit -m "feat(pnl): client types for job P&L and weekly rollup"
```

---

## Task 7: Planner job-card P&L panel

**Files:**
- Create: `client/src/components/JobPnlPanel.tsx`
- Modify: `client/src/pages/admin/CRMPlanner.tsx`

- [ ] **Step 1: Write `JobPnlPanel.tsx`**

```tsx
import { useEffect, useState } from 'react';
import { Plus, X, TrendingUp } from 'lucide-react';
import api from '../lib/api';
import type { JobPnl, JobLedgerLine } from '../types';

function fmtMoney(n: number): string {
  return `£${(Number(n) || 0).toLocaleString('en-GB', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
}

// Inline money input that commits on blur. `placeholder` shows the suggestion in grey.
function MoneyField({
  value, placeholder, onCommit,
}: { value: number | ''; placeholder?: string; onCommit: (v: string) => void }) {
  const [text, setText] = useState(value === '' ? '' : String(value));
  useEffect(() => { setText(value === '' ? '' : String(value)); }, [value]);
  return (
    <div className="relative">
      <span className="absolute left-2 top-1/2 -translate-y-1/2 text-[11px] text-slate-400">£</span>
      <input
        type="text"
        inputMode="decimal"
        value={text}
        placeholder={placeholder}
        onChange={e => setText(e.target.value.replace(/[^0-9.]/g, ''))}
        onBlur={() => onCommit(text)}
        className="w-24 pl-5 pr-1 py-1 rounded border border-slate-200 text-xs text-right tabular-nums focus:outline-none focus:ring-1 focus:ring-indigo-400 focus:border-indigo-400"
      />
    </div>
  );
}

export default function JobPnlPanel({ source, id }: { source: 'job' | 'event'; id: number }) {
  const [pnl, setPnl] = useState<JobPnl | null>(null);
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    try {
      const r = await api.get<JobPnl>('/planner/pnl', { params: { source, id } });
      setPnl(r.data);
    } catch (err) {
      console.error('Failed to load P&L', err);
      setPnl(null);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [source, id]);

  async function saveIncome(v: string) {
    await api.put('/planner/pnl/income', { source, id, income: v === '' ? null : v });
    await load();
  }
  async function addLine(kind: 'income' | 'expense', label: string) {
    await api.post('/planner/pnl/line', { source, id, kind, label, amount: 0 });
    await load();
  }
  async function updateLine(lineId: number, patch: { label?: string; amount?: string }) {
    await api.patch(`/planner/pnl/line/${lineId}`, patch);
    await load();
  }
  async function deleteLine(lineId: number) {
    await api.delete(`/planner/pnl/line/${lineId}`);
    await load();
  }

  if (loading && !pnl) {
    return <div className="text-[11px] text-slate-400 py-2">Loading P&L…</div>;
  }
  if (!pnl) return null;

  // Diesel starter row: when there are no saved expense lines, show a single
  // editable Diesel row that only persists once the user gives it a value.
  const hasExpenses = pnl.expense_lines.length > 0;

  return (
    <div className="rounded-lg border border-slate-200/80 bg-white/70 p-2.5 space-y-2">
      <div className="flex items-center gap-1.5 text-[11px] font-bold text-slate-700 uppercase tracking-wider">
        <TrendingUp className="w-3 h-3 text-emerald-600" /> Profit &amp; Loss
      </div>

      {/* Income */}
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-medium text-slate-600">Income</span>
        <MoneyField
          value={pnl.income ?? ''}
          placeholder={pnl.income_suggestion ? String(pnl.income_suggestion) : '0'}
          onCommit={saveIncome}
        />
      </div>
      {pnl.income_lines.map(line => (
        <LineRow key={line.id} line={line} onUpdate={updateLine} onDelete={deleteLine} />
      ))}
      <button
        type="button"
        onClick={() => addLine('income', 'Extra income')}
        className="inline-flex items-center gap-1 text-[10px] font-semibold text-emerald-700 hover:text-emerald-800"
      >
        <Plus className="w-3 h-3" /> Add income
      </button>

      {/* Wages (read-only) */}
      <div className="flex items-center justify-between border-t border-slate-100 pt-1.5">
        <span className="text-[11px] font-medium text-slate-600">Wages</span>
        <span className="text-xs font-semibold text-slate-700 tabular-nums pr-1">{fmtMoney(pnl.wages_total)}</span>
      </div>

      {/* Expenses */}
      <div className="border-t border-slate-100 pt-1.5 space-y-1.5">
        <span className="text-[11px] font-medium text-slate-600">Expenses</span>
        {!hasExpenses && <DieselStarter source={source} id={id} onAdded={load} />}
        {pnl.expense_lines.map(line => (
          <LineRow key={line.id} line={line} onUpdate={updateLine} onDelete={deleteLine} />
        ))}
        <button
          type="button"
          onClick={() => addLine('expense', 'Expense')}
          className="inline-flex items-center gap-1 text-[10px] font-semibold text-amber-700 hover:text-amber-800"
        >
          <Plus className="w-3 h-3" /> Add expense
        </button>
      </div>

      {/* Profit */}
      <div className="flex items-center justify-between border-t border-slate-200 pt-1.5">
        <span className="text-[11px] font-bold text-slate-700">Profit</span>
        <span className={`text-sm font-bold tabular-nums pr-1 ${pnl.profit >= 0 ? 'text-emerald-700' : 'text-red-600'}`}>
          {fmtMoney(pnl.profit)}
        </span>
      </div>
    </div>
  );
}

// One editable income/expense line (label + amount + delete).
function LineRow({
  line, onUpdate, onDelete,
}: {
  line: JobLedgerLine;
  onUpdate: (id: number, patch: { label?: string; amount?: string }) => void;
  onDelete: (id: number) => void;
}) {
  const [label, setLabel] = useState(line.label);
  useEffect(() => { setLabel(line.label); }, [line.label]);
  return (
    <div className="flex items-center gap-1.5">
      <input
        type="text"
        value={label}
        onChange={e => setLabel(e.target.value)}
        onBlur={() => { if (label !== line.label) onUpdate(line.id, { label }); }}
        className="flex-1 min-w-0 px-2 py-1 rounded border border-slate-200 text-xs focus:outline-none focus:ring-1 focus:ring-indigo-400 focus:border-indigo-400"
      />
      <MoneyField value={line.amount} onCommit={v => onUpdate(line.id, { amount: v })} />
      <button
        type="button"
        onClick={() => onDelete(line.id)}
        title="Remove"
        className="p-1 text-slate-300 hover:text-red-500"
      >
        <X className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}

// Diesel starter: a blank Diesel row that only creates a real line when given a value.
function DieselStarter({ source, id, onAdded }: { source: 'job' | 'event'; id: number; onAdded: () => void }) {
  const [text, setText] = useState('');
  async function commit() {
    const amount = parseFloat(text);
    if (!Number.isFinite(amount) || amount <= 0) return; // nothing entered — don't persist
    await api.post('/planner/pnl/line', { source, id, kind: 'expense', label: 'Diesel', amount });
    setText('');
    await onAdded();
  }
  return (
    <div className="flex items-center gap-1.5">
      <input
        type="text"
        value="Diesel"
        disabled
        className="flex-1 min-w-0 px-2 py-1 rounded border border-slate-200 bg-slate-50 text-xs text-slate-500"
      />
      <div className="relative">
        <span className="absolute left-2 top-1/2 -translate-y-1/2 text-[11px] text-slate-400">£</span>
        <input
          type="text"
          inputMode="decimal"
          value={text}
          placeholder="0"
          onChange={e => setText(e.target.value.replace(/[^0-9.]/g, ''))}
          onBlur={commit}
          className="w-24 pl-5 pr-1 py-1 rounded border border-slate-200 text-xs text-right tabular-nums focus:outline-none focus:ring-1 focus:ring-indigo-400 focus:border-indigo-400"
        />
      </div>
      <span className="w-[26px]" />
    </div>
  );
}
```

- [ ] **Step 2: Import the panel in `CRMPlanner.tsx`**

After the existing `import Modal from '../../components/Modal';` (line 8), add:

```tsx
import JobPnlPanel from '../../components/JobPnlPanel';
```

- [ ] **Step 3: Render the panel inside the expanded `JobCard`**

In `CRMPlanner.tsx`, the expanded-detail block starts at `{isExpanded && (` (around line 855). Find the closing of that block — it is the `)}` that closes the expanded `<div className="px-3 pb-3 space-y-3 ...">`. Render the panel as the **last child** of that expanded div, immediately before its closing `</div>`. Surveys have no P&L, so guard on category.

Locate the desktop/mobile assignment section's end inside the expanded block and add, as the final element before the expanded `</div>`:

```tsx
          {/* ── Profit & Loss ── */}
          {!isSurveyEvent && (
            <JobPnlPanel source={item.source} id={item.id} />
          )}
```

(`isSurveyEvent` and `item` are already in scope in `JobCard`.)

- [ ] **Step 4: Verify type-check + build the client**

Run: `cd client && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Manual UI check**

Run: `npm run dev`, open the planner, expand a removal job card.
Expected:
- A "Profit & Loss" block appears with an Income field whose grey placeholder is the quote amount.
- A disabled "Diesel" row with an empty amount; typing e.g. `80` and blurring persists it and it reappears as a normal removable expense line.
- "Add income" / "Add expense" add editable rows; Wages shows the assignment total; Profit updates and is green/red.

- [ ] **Step 6: Commit**

```bash
git add client/src/components/JobPnlPanel.tsx client/src/pages/admin/CRMPlanner.tsx
git commit -m "feat(pnl): P&L panel in expanded planner job card"
```

---

## Task 8: Wages-page weekly P&L summary

**Files:**
- Modify: `client/src/pages/admin/CRMWages.tsx`

- [ ] **Step 1: Import the type and the navigate helper usage**

At the top of `CRMWages.tsx`, extend the existing type import. The file imports from `../../lib/api` already; add the P&L type import after the existing imports (after line 5):

```tsx
import type { WeeklyPnlResponse } from '../../types';
```

- [ ] **Step 2: Load the weekly P&L alongside the wages week**

Inside the `CRMWages` component, after the existing `const [savingId, setSavingId] = useState<number | null>(null);` (line 95), add:

```tsx
  const [pnl, setPnl] = useState<WeeklyPnlResponse | null>(null);
```

Then extend the `load` function so it fetches P&L too. Replace the body of `load` (lines 97-108) with:

```tsx
  async function load() {
    setLoading(true);
    try {
      const [wagesRes, pnlRes] = await Promise.all([
        api.get<WagesWeekResponse>('/wages/week', { params: { start: weekStart } }),
        api.get<WeeklyPnlResponse>('/wages/pnl', { params: { start: weekStart } }),
      ]);
      setData(wagesRes.data);
      setPnl(pnlRes.data);
    } catch (err) {
      console.error('Failed to load wages', err);
      setData(null);
      setPnl(null);
    } finally {
      setLoading(false);
    }
  }
```

- [ ] **Step 3: Render the P&L section below the company panel**

Find `<CompanyPanel summary={data?.summary} />` (line 402) and add the P&L section directly after it, still inside the outer `<div className="space-y-6">`:

```tsx
        {/* Weekly Profit & Loss */}
        <PnlPanel pnl={pnl} onOpenJob={(row) => navigate(`/admin/crm/planner?view=week&date=${row.date}`)} />
```

- [ ] **Step 4: Add the `PnlPanel` sub-component**

At the bottom of `CRMWages.tsx` (after the `MoneyInput` component), add:

```tsx
function PnlPanel({
  pnl, onOpenJob,
}: { pnl: WeeklyPnlResponse | null; onOpenJob: (row: WeeklyPnlResponse['jobs'][number]) => void }) {
  const jobs = pnl?.jobs ?? [];
  const totals = pnl?.totals ?? { income: 0, wages: 0, expenses: 0, profit: 0 };
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <h2 className="text-lg font-bold text-slate-900">Profit &amp; Loss</h2>
        <span className="text-xs text-slate-500">Operational, this week (ex-VAT)</span>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <SummaryCard label="Income" value={fmtMoney(totals.income)} accent="emerald" />
        <SummaryCard label="Wages" value={fmtMoney(totals.wages)} accent="violet" />
        <SummaryCard label="Expenses" value={fmtMoney(totals.expenses)} accent="amber" />
        <SummaryCard label="Operational profit" value={fmtMoney(totals.profit)} accent="blue" />
      </div>

      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr>
                <th className="text-left px-4 py-2 font-semibold text-slate-600">Job</th>
                <th className="text-right px-3 py-2 font-semibold text-slate-600">Income</th>
                <th className="text-right px-3 py-2 font-semibold text-slate-600">Wages</th>
                <th className="text-right px-3 py-2 font-semibold text-slate-600">Expenses</th>
                <th className="text-right px-3 py-2 font-semibold text-slate-700 bg-blue-50/50">Profit</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {jobs.length === 0 && (
                <tr><td colSpan={5} className="px-4 py-12 text-center text-sm text-slate-400">
                  No jobs this week. Schedule jobs on the planner to see P&amp;L here.
                </td></tr>
              )}
              {jobs.map(row => (
                <tr key={`${row.source}-${row.id}`}>
                  <td className="px-4 py-2">
                    <button
                      type="button"
                      onClick={() => onOpenJob(row)}
                      className="font-medium text-slate-800 hover:text-indigo-700 hover:underline text-left"
                      title="Open in planner"
                    >
                      {row.label}
                    </button>
                  </td>
                  <td className="text-right px-3 py-2 tabular-nums text-slate-700">{fmtMoney(row.income)}</td>
                  <td className="text-right px-3 py-2 tabular-nums text-slate-700">{fmtMoney(row.wages)}</td>
                  <td className="text-right px-3 py-2 tabular-nums text-slate-700">{fmtMoney(row.expenses)}</td>
                  <td className={`text-right px-3 py-2 font-bold tabular-nums bg-blue-50/40 ${row.profit >= 0 ? 'text-emerald-700' : 'text-red-600'}`}>
                    {fmtMoney(row.profit)}
                  </td>
                </tr>
              ))}
            </tbody>
            {jobs.length > 0 && (
              <tfoot className="bg-slate-50 border-t-2 border-slate-200">
                <tr>
                  <td className="px-4 py-2 text-xs uppercase tracking-wider font-bold text-slate-500">Week totals</td>
                  <td className="text-right px-3 py-2 font-semibold text-slate-700 tabular-nums">{fmtMoney(totals.income)}</td>
                  <td className="text-right px-3 py-2 font-semibold text-slate-700 tabular-nums">{fmtMoney(totals.wages)}</td>
                  <td className="text-right px-3 py-2 font-semibold text-slate-700 tabular-nums">{fmtMoney(totals.expenses)}</td>
                  <td className={`text-right px-3 py-2 font-bold tabular-nums bg-blue-100/60 ${totals.profit >= 0 ? 'text-emerald-700' : 'text-red-600'}`}>
                    {fmtMoney(totals.profit)}
                  </td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Verify type-check**

Run: `cd client && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Manual UI check**

Run: `npm run dev`, open the Wages page for a week with scheduled jobs.
Expected: below "Company spend" a "Profit & Loss" section shows four cards and a jobs table sorted by profit (highest first); clicking a job name navigates to that week in the planner; totals row matches the cards.

- [ ] **Step 7: Commit**

```bash
git add client/src/pages/admin/CRMWages.tsx
git commit -m "feat(pnl): weekly P&L summary on wages page"
```

---

## Task 9: Full verification pass

- [ ] **Step 1: Re-run the helper sanity check**

Run: `node scripts/check-pnl-calc.js`
Expected: `pnl-calc sanity checks passed`.

- [ ] **Step 2: Client type-check + production build**

Run: `cd client && npx tsc --noEmit && npm run build`
Expected: both succeed with no errors.

- [ ] **Step 3: End-to-end smoke test in the app**

Run: `npm run dev`. With the server + client up:
1. Planner → expand a removal job → set income (overwriting the quote suggestion), fill Diesel, add a "Tip" income line and a "Hotel" expense line. Confirm Profit = income(+tip) − wages − (diesel+hotel).
2. Open the Wages page for that job's week. Confirm the job appears with matching income/wages/expenses/profit, the four cards sum correctly, and rows are sorted by profit.
3. Expand a contract/Lux event → confirm income placeholder equals its contract-job line-item total, and Lux wages flow through.
4. Delete the job in the planner (or confirm via a test row) → its ledger lines are gone (cascade); the wages-page P&L no longer lists it.

Expected: all figures consistent between the planner card and the wages page.

- [ ] **Step 4: Final commit (if any cleanup was needed)**

```bash
git add -A
git commit -m "chore(pnl): verification pass cleanup"
```

(If nothing changed, skip this commit.)

---

## Self-Review Notes (coverage against spec)

- **`pnl_income` columns + `JobLedgerLine`** → Task 1.
- **Smart income suggestion** (quote / contract-job items / blank) → `pnl-calc.js` (Task 2), used in Tasks 4 & 5; UI placeholder in Task 7.
- **Additional income lines + expense lines via one `kind` table** → Tasks 1, 4, 7.
- **Diesel starter row, persists only when valued** → `DieselStarter` (Task 7).
- **Wages reused from `wage-calc`** → `sumAssignmentWages` (Task 2), Tasks 4 & 5.
- **Profit = income − wages − expenses** → `rollup` (Task 2); verified Task 3.
- **Planner P&L block in expanded card** → Task 7.
- **Weekly P&L summary (4 cards + ranked table, jobs with no income still shown, click-through)** → Tasks 5 & 8.
- **Both job types, week-by-date, lost/cancelled excluded** → Task 5 queries.
- **Admin-only, ex-VAT** → routes inherit `requireAdmin`; no VAT math anywhere.
