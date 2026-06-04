# Overtime auto-billing — design

**Date:** 2026-06-04
**Status:** Approved

## Goal

Automatically detect overtime worked on contractor jobs and bill it on the weekly
contractor invoice, with zero manual line entry.

A contractor can be flagged as overtime-applicable with a per-hour fee and an
hours threshold. When staff start/finish times on the planner push a person past
the threshold on a day, the excess hours are overtime. All staff overtime for a
given day is summed and billed as a single invoice line for that day.

## Decisions (locked)

- **Threshold:** editable per contractor, defaults to 10 hours.
- **Scope:** overtime is computed for *any* job that has start/finish times that
  week — independent of the Lux Move flag.
- **Live sync:** the per-day overtime line auto-updates on a draft invoice
  whenever times change (not snapshotted at generation).
- **Aggregation:** overtime is a daily, per-person concept. A person's hours are
  summed across all their jobs that day, then `max(0, hours − threshold)` is the
  person's overtime. All persons' overtime for the day is summed into one line.

## Data model (schema.prisma; applied via `prisma db push`)

`Contract` — three new fields:
- `overtime_applicable Boolean @default(false)`
- `overtime_fee Float?` — £ per overtime hour
- `overtime_threshold_hours Float @default(10)`

`ContractInvoiceItem` — one new field:
- `is_overtime Boolean @default(false)` — marks system-managed overtime lines so
  `reconcileDraftInvoice` recomputes/replaces them rather than treating them as
  user free-form lines.

## Components

### `server/lib/overtime-calc.js` (new)
`computeOvertimeLines(contract, jobs)` → array of `{ job_date, hours, fee, total, description }`.
- Input `jobs`: the week's `ContractJob`s with their linked `planner_event` and
  that event's `assignments` (start_time, finish_time) plus `event_time`.
- For each assignment, derive hours via the same rule the wage calc uses
  (`deriveHours`, with `start_time` falling back to the event's `event_time`).
- Group hours by `(person asset_id, job_date)`, sum, apply
  `max(0, sum − threshold)`, then sum per `job_date`.
- Emit one line per day with overtime > 0:
  `quantity = hours`, `unit_price = fee`, `total = hours × fee`,
  `description = "Overtime — {hours} hrs @ £{fee}/hr"`.
- Returns `[]` when `!overtime_applicable` or no fee.

### `server/lib/contract-invoice-sync.js` (`reconcileDraftInvoice`)
- After reconciling job-item lines, compute overtime lines for the invoice's week.
- Reconcile existing `is_overtime` lines against the freshly computed set
  (create/update/delete), placing each day's overtime line after that day's items.
- Existing `is_overtime` lines are excluded from the free-form bucket.
- Totals (`recalc`) include overtime lines.

### `server/routes/contract-jobs.js` (`POST /contractors/:cid/invoices/auto`)
- After flattening job lines, append overtime lines (one per day) with
  `is_overtime: true`, ordered after that day's items.

### `server/routes/contracts.js` (POST `/`, PUT `/:id`)
- Accept and persist `overtime_applicable`, `overtime_fee`,
  `overtime_threshold_hours`. Sanitize numbers; threshold defaults to 10.

### `server/routes/planner.js` (`PATCH /assignments/:id`)
- After a time change, look up the assignment's event `contract_id` and
  `assigned_date` and call `syncDraftInvoiceForJobDate` so the draft's overtime
  line updates live.

### `client/src/pages/admin/CRMSettings.tsx` (ContractsTab)
- Extend `ContractForm` / `EMPTY_CONTRACT` / `openEdit` with the three fields.
- Below the Lux Move checkbox: an "Is overtime fee applicable" checkbox; when
  checked, show "Overtime fee (£ / hour)" and "Overtime threshold (hours)"
  (default 10) inputs. Saved by the existing form submit.

### `client/src/types/index.ts`
- Add the three fields to the `Contract` interface.

## Out of scope (YAGNI)
- No per-job overtime override.
- No separate overtime tax rate — overtime flows into the existing subtotal/VAT.
- No historical recompute of already-sent/paid invoices (drafts only).
