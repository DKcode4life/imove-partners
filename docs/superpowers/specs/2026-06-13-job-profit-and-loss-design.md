# Job Profit & Loss — Design

**Date:** 2026-06-13
**Status:** Approved (pending spec review)

## Goal

Track operational profit and loss for every job on the planner, and surface a
weekly P&L summary on the wages page. For each job the user can record income
(what the job brought in) and expenses (diesel, hotel, food, …); the system
already computes wages from staff assignments. Profit is reported per job and
rolled up per week, ranked so the user can see which jobs made the most money.

**Profit = total income − wages − total expenses** (operational only — no admin
overhead, no VAT).

## Scope

- **In scope:** Per-job income (base + additional lines), per-job expense lines,
  per-job profit shown on the planner, and a weekly P&L summary on the wages page.
- **Out of scope:** VAT handling, admin/overhead allocation, reporting beyond the
  single-week view, exporting, and any change to how wages themselves are
  calculated.

## What "a job" means

Both planner item types participate, consistent with how they already coexist
across the planner, wages, and assignment code:

- **Removal jobs** — `CrmJob`, dated by `confirmed_move_date || preferred_move_date`.
- **Quick / contract events** — `PlannerEvent`, dated by `event_date`.

A job belongs to a week by that date. Lost/cancelled jobs are excluded, matching
the existing planner/wages filters.

## Data model (additive — applied via `prisma db push`, no data loss)

### New nullable column on both `CrmJob` and `PlannerEvent`

```
pnl_income Float?
```

- `null` → income not set; the UI shows a **smart suggestion** (see below) but
  nothing is persisted.
- A number → the income the user typed, including an explicit override of the
  suggestion. Clearing the field reverts to `null` (suggestion shows again).

### New model `JobLedgerLine`

Mirrors the dual-nullable-FK polymorphism already used by `PlannerAssignment`
(`job_id` / `event_id`). One table serves both additional income and expenses,
distinguished by `kind`.

```prisma
model JobLedgerLine {
  id         Int      @id @default(autoincrement())
  job_id     Int?
  event_id   Int?
  kind       String   // 'income' | 'expense'
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

Back-relations (`job_ledger_lines JobLedgerLine[]`) added to `CrmJob` and
`PlannerEvent`. Cascade delete cleans up lines when a job/event is removed.

## Income — "manual, prefilled smart"

The base income field prefills a **suggestion** (display-only, never auto-saved)
when `pnl_income` is null:

- **Removal job (`CrmJob`)** → `quote_amount`.
- **Contract event (`PlannerEvent`** with a linked `ContractJob`) → sum of that
  job's `ContractJobItem.total` values. This is the per-job slice of the weekly
  contract invoice — a clean 1:1 figure, unlike the aggregated weekly invoice.
- **Plain quick event** (no contract) → blank (0 suggestion).

Once the user types a value it is stored in `pnl_income`. The suggestion is shown
as greyed placeholder text so it's obvious whether a number is saved or merely
suggested.

### Additional income lines

An **"+ Add income"** button under the base income field adds
`JobLedgerLine` rows with `kind = 'income'` (description + amount) — for tips,
extra services paid on the day, etc. Each line is editable and removable.

**Total income = base income (or suggestion if unset) + Σ income lines.**

## Expenses

- The expanded job card always renders a starter **"Diesel"** expense row (blank)
  when the job has no saved expense lines. It is persisted only when the user
  enters a value or adds another line — so there are no phantom £0 rows, and a
  deleted Diesel line never silently reappears.
- **"+ Add expense"** adds further labelled `JobLedgerLine` rows with
  `kind = 'expense'` (hotel, food, …).

**Total expenses = Σ expense lines.**

## Wages per job

Reuses the existing `server/lib/wage-calc.js` `computeAssignmentWage` — the
per-job wage total is the sum over every `PlannerAssignment` on that job/event,
computed exactly as the wages and staff-week views already do. No new wage logic.

## Planner UI — P&L block in the expanded job card

A compact **"Profit & Loss"** section inside the card the user already expands to
assign staff (`JobCard` in `client/src/pages/admin/CRMPlanner.tsx`). Lazy-loaded
when the card expands (so the week payload is unchanged).

```
Income     [£ 1,250 ]      ← base; placeholder shows suggestion in grey
  + Add income
  Tip        [£ 50 ]  ✕     ← income lines (kind='income')
Wages                  £420  ← read-only, from assignments
Expenses
  Diesel     [£ 80 ]  ✕     ← starter row; expense lines (kind='expense')
  Hotel      [£ 95 ]  ✕
  + Add expense
──────────────────────────
Profit                 £605  ← green if ≥ 0, red if < 0
```

Money inputs save on blur, reusing the `MoneyInput` blur-commit pattern from the
wages page. Wages and profit recompute live as values change.

## Wages page — weekly P&L summary

A new **"Profit & Loss"** section directly below the existing wages table on
`client/src/pages/admin/CRMWages.tsx`:

- Four summary cards: **Income · Wages · Expenses · Operational profit**
  (reusing the existing `SummaryCard` component).
- A table of the week's jobs sorted by profit, most profitable first:
  `Job | Income | Wages | Expenses | Profit`. Each row links through to that job
  in the planner (same navigation pattern the wages day-cells already use).
- Jobs with no income yet still appear (profit shows as a loss = −(wages +
  expenses)), so nothing the user forgot to price is hidden.

## Endpoints

Planner-side editing (in `server/routes/planner.js`):

- `GET  /planner/pnl?source=&id=` →
  `{ income, income_suggestion, income_lines[], expense_lines[], wages_total, total_income, total_expenses, profit }`
- `PUT  /planner/pnl/income` → `{ source, id, income }` (null clears → suggestion)
- `POST /planner/pnl/line` → `{ source, id, kind, label, amount }`
- `PATCH /planner/pnl/line/:id` → `{ label?, amount? }`
- `DELETE /planner/pnl/line/:id`

Wages-page rollup (in `server/routes/wages.js`):

- `GET /wages/pnl?start=YYYY-MM-DD` → per-job rollup + week totals:
  `{ week_start, jobs: [{ source, id, label, date, income, wages, expenses, profit }], totals: { income, wages, expenses, profit } }`

`source` is `'job' | 'event'`; `id` is the `CrmJob` / `PlannerEvent` id.
All routes are admin-only, consistent with the existing planner/wages routers.

## Validation & edge cases

- Amounts: numbers ≥ 0; reject negatives at the route level (matches
  `parseRate` conventions in planner.js). Income may be 0.
- `income = null/''` clears the stored value (reverts to suggestion).
- A line must reference exactly one of `job_id` / `event_id`; `kind` must be
  `'income'` or `'expense'`.
- Deleting a job/event cascades its ledger lines.
- Orphan filtering in the weekly rollup follows the existing wages logic
  (skip Lost/Cancelled and date-mismatched items).

## Testing

- Wage rollup parity: per-job `wages_total` matches what `/wages/week` and
  `/planner/staff-week` compute for the same assignments.
- Income suggestion: correct source per job type (quote vs contract-job items vs
  blank); suggestion is not persisted until edited.
- Total income = base + income lines; total expenses = expense lines; profit
  formula correct including negative (loss) cases.
- Weekly rollup: jobs grouped into the correct week by date; lost/cancelled and
  date-mismatched excluded; jobs with no income still listed.
- Cascade delete removes ledger lines with their job/event.
```