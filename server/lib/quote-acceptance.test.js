const test = require('node:test');
const assert = require('node:assert');

const {
  generateAcceptToken,
  splitItems,
  computeAcceptedTotals,
  validateAcceptancePayload,
  applyAcceptanceToQuoteState,
  round2,
  MAX_DECLARED_VALUE,
} = require('./quote-acceptance');

// ── token ────────────────────────────────────────────────────────────────────
test('generateAcceptToken returns a 48-char hex string', () => {
  const t = generateAcceptToken();
  assert.match(t, /^[0-9a-f]{48}$/);
});

test('generateAcceptToken is unique across calls', () => {
  assert.notStrictEqual(generateAcceptToken(), generateAcceptToken());
});

// ── splitItems ────────────────────────────────────────────────────────────────
test('splitItems separates mandatory and optional', () => {
  const { mandatory, optional } = splitItems([
    { id: 1, is_optional: false },
    { id: 2, is_optional: true },
    { id: 3 },
  ]);
  assert.deepStrictEqual(mandatory.map((i) => i.id), [1, 3]);
  assert.deepStrictEqual(optional.map((i) => i.id), [2]);
});

test('splitItems tolerates non-array input', () => {
  const { mandatory, optional } = splitItems(undefined);
  assert.deepStrictEqual(mandatory, []);
  assert.deepStrictEqual(optional, []);
});

// ── computeAcceptedTotals ─────────────────────────────────────────────────────
const ITEMS = [
  { id: 1, total: 1000, is_optional: false }, // mandatory move
  { id: 2, total: 200, is_optional: true },   // packing
  { id: 3, total: 50, is_optional: true },    // mattress covers
];

test('mandatory-only acceptance totals the compulsory services', () => {
  const r = computeAcceptedTotals({ items: ITEMS, selectedOptionalIds: [] });
  assert.strictEqual(r.subtotal, 1000);
  assert.strictEqual(r.total, 1000);
  assert.deepStrictEqual(r.acceptedItems.map((i) => i.id), [1]);
});

test('selecting an optional service adds it to the accepted total', () => {
  const r = computeAcceptedTotals({ items: ITEMS, selectedOptionalIds: [2] });
  assert.strictEqual(r.subtotal, 1200);
  assert.strictEqual(r.total, 1200);
  assert.deepStrictEqual(r.acceptedItems.map((i) => i.id), [1, 2]);
});

test('selecting all optional services sums everything', () => {
  const r = computeAcceptedTotals({ items: ITEMS, selectedOptionalIds: [2, 3] });
  assert.strictEqual(r.total, 1250);
});

test('VAT is applied only when the original quote charged VAT', () => {
  const withVat = computeAcceptedTotals({
    items: ITEMS, selectedOptionalIds: [2], taxRate: 20, vatApplied: true,
  });
  assert.strictEqual(withVat.subtotal, 1200);
  assert.strictEqual(withVat.taxAmount, 240);
  assert.strictEqual(withVat.total, 1440);

  const noVat = computeAcceptedTotals({
    items: ITEMS, selectedOptionalIds: [2], taxRate: 20, vatApplied: false,
  });
  assert.strictEqual(noVat.taxAmount, 0);
  assert.strictEqual(noVat.total, 1200);
});

test('unknown optional ids are ignored in the total', () => {
  const r = computeAcceptedTotals({ items: ITEMS, selectedOptionalIds: [999] });
  assert.strictEqual(r.total, 1000);
});

// ── validateAcceptancePayload ─────────────────────────────────────────────────
test('valid payload passes and normalizes the selection', () => {
  const r = validateAcceptancePayload(
    { accept_terms: true, declared_value: 25000, selected_optional_ids: [2] },
    ITEMS,
  );
  assert.strictEqual(r.ok, true);
  assert.deepStrictEqual(r.errors, []);
  assert.deepStrictEqual(r.selectedOptionalIds, [2]);
  assert.strictEqual(r.declaredValue, 25000);
});

test('rejects when terms are not agreed', () => {
  const r = validateAcceptancePayload(
    { accept_terms: false, declared_value: 25000, selected_optional_ids: [] },
    ITEMS,
  );
  assert.strictEqual(r.ok, false);
  assert.ok(r.errors.some((e) => /terms/i.test(e)));
});

test('rejects a missing or non-positive declared value', () => {
  for (const bad of [undefined, 0, -5, 'abc']) {
    const r = validateAcceptancePayload(
      { accept_terms: true, declared_value: bad, selected_optional_ids: [] },
      ITEMS,
    );
    assert.strictEqual(r.ok, false, `declared_value=${bad} should fail`);
  }
});

test('rejects a declared value over the cap', () => {
  const r = validateAcceptancePayload(
    { accept_terms: true, declared_value: MAX_DECLARED_VALUE + 1, selected_optional_ids: [] },
    ITEMS,
  );
  assert.strictEqual(r.ok, false);
});

test('rejects selecting an id that is not an optional item on this quote', () => {
  const r = validateAcceptancePayload(
    { accept_terms: true, declared_value: 25000, selected_optional_ids: [1] }, // 1 is mandatory
    ITEMS,
  );
  assert.strictEqual(r.ok, false);
});

// ── applyAcceptanceToQuoteState ───────────────────────────────────────────────
const QUOTE_STATE = {
  quotationItems: [{ id: 'm1', description: 'Full house move', price: 1000 }],
  quotationAddons: [
    { id: 'a1', description: 'Packing service', price: 300, selected: false },
    { id: 'a2', description: 'Dismantling', price: 100, selected: false },
  ],
  depositType: 'percentage',
  depositValue: '10',
};

test('accepting an optional service flips its addon to selected', () => {
  const { quoteState, changed } = applyAcceptanceToQuoteState(QUOTE_STATE, [
    { description: 'Packing service', total: 300 },
  ]);
  assert.strictEqual(changed, true);
  const packing = quoteState.quotationAddons.find((a) => a.id === 'a1');
  const dismantle = quoteState.quotationAddons.find((a) => a.id === 'a2');
  assert.strictEqual(packing.selected, true);
  assert.strictEqual(dismantle.selected, false);
});

test('does not mutate the original quote_state', () => {
  applyAcceptanceToQuoteState(QUOTE_STATE, [{ description: 'Packing service', total: 300 }]);
  assert.strictEqual(QUOTE_STATE.quotationAddons[0].selected, false);
});

test('matches case-insensitively and trims whitespace', () => {
  const { quoteState, changed } = applyAcceptanceToQuoteState(QUOTE_STATE, [
    { description: '  packing SERVICE ', total: 300 },
  ]);
  assert.strictEqual(changed, true);
  assert.strictEqual(quoteState.quotationAddons.find((a) => a.id === 'a1').selected, true);
});

test('flips each duplicate-named addon at most once', () => {
  const state = {
    quotationAddons: [
      { id: 'a1', description: 'Box bundle', price: 25, selected: false },
      { id: 'a2', description: 'Box bundle', price: 25, selected: false },
    ],
  };
  const { quoteState } = applyAcceptanceToQuoteState(state, [{ description: 'Box bundle', total: 25 }]);
  const selectedCount = quoteState.quotationAddons.filter((a) => a.selected).length;
  assert.strictEqual(selectedCount, 1);
});

test('returns unchanged when there is no quote_state or no addons', () => {
  assert.deepStrictEqual(applyAcceptanceToQuoteState(null, [{ description: 'x', total: 1 }]), {
    quoteState: null,
    changed: false,
  });
  const noAddons = { quotationItems: [] };
  assert.strictEqual(applyAcceptanceToQuoteState(noAddons, [{ description: 'x', total: 1 }]).changed, false);
});

test('returns unchanged when nothing matches', () => {
  const { changed } = applyAcceptanceToQuoteState(QUOTE_STATE, [
    { description: 'Storage', total: 50 },
  ]);
  assert.strictEqual(changed, false);
});

test('round2 avoids binary-float drift', () => {
  assert.strictEqual(round2(1200 * 0.2), 240); // 240.00000000000003 → 240
  assert.strictEqual(round2(50.555), 50.56);
  assert.strictEqual(round2(0.1 + 0.2), 0.3);
});
