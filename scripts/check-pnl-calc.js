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
// overtime folds on top of the line items (mirrors the invoice's overtime line)
assert.strictEqual(
  pnl.eventIncomeSuggestion({ items: [{ total: 100 }] }, 75),
  175
);
assert.strictEqual(pnl.eventIncomeSuggestion(null, 50), 50); // overtime-only (empty job)
assert.strictEqual(pnl.eventIncomeSuggestion({ items: [{ total: 100 }] }, 0), 100);

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
