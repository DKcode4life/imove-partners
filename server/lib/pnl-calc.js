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
 * job's line-item totals plus any overtime billed to this event (the per-job
 * slice of the weekly contract invoice — which itself bills overtime on top of
 * the line items). Plain quick events (no linked contract job) suggest 0 unless
 * overtime is attributed to them.
 * @param {{ items?: {total:number}[] }|null} contractJob
 * @param {number} [overtime] — overtime income attributed to this event (£)
 */
function eventIncomeSuggestion(contractJob, overtime = 0) {
  const items = contractJob && Array.isArray(contractJob.items)
    ? contractJob.items.reduce((s, it) => s + (Number(it.total) || 0), 0)
    : 0;
  return round2(items + (Number(overtime) || 0));
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
