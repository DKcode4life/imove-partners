const test = require('node:test');
const assert = require('node:assert');

const {
  computeContentHash,
  nextVersion,
  buildTitle,
  buildDescription,
} = require('./sent-document');

test('computeContentHash is stable for identical input', () => {
  const a = computeContentHash({ pdfArgs: { total: 1000 }, subject: 'Quote', bodyHtml: '<p>hi</p>' });
  const b = computeContentHash({ pdfArgs: { total: 1000 }, subject: 'Quote', bodyHtml: '<p>hi</p>' });
  assert.strictEqual(a, b);
});

test('computeContentHash changes when pdf args change', () => {
  const a = computeContentHash({ pdfArgs: { total: 1000 }, subject: 'Quote', bodyHtml: '<p>hi</p>' });
  const b = computeContentHash({ pdfArgs: { total: 1200 }, subject: 'Quote', bodyHtml: '<p>hi</p>' });
  assert.notStrictEqual(a, b);
});

test('computeContentHash changes when the email body changes', () => {
  const a = computeContentHash({ pdfArgs: { total: 1000 }, subject: 'Quote', bodyHtml: '<p>hi</p>' });
  const b = computeContentHash({ pdfArgs: { total: 1000 }, subject: 'Quote', bodyHtml: '<p>hello</p>' });
  assert.notStrictEqual(a, b);
});

test('nextVersion returns 1 for the first send', () => {
  assert.strictEqual(nextVersion(null, 'hash-a', 0), 1);
});

test('nextVersion reuses the version when content is unchanged (plain re-send)', () => {
  const latest = { version: 2, content_hash: 'hash-a' };
  assert.strictEqual(nextVersion(latest, 'hash-a', 2), 2);
});

test('nextVersion bumps from the max version when content changes', () => {
  const latest = { version: 2, content_hash: 'hash-a' };
  assert.strictEqual(nextVersion(latest, 'hash-b', 2), 3);
});

test('nextVersion bumps off maxVersion even if the latest row is an older version', () => {
  // latest by sent_at could be a re-send of v1 while v3 already exists
  const latest = { version: 1, content_hash: 'hash-old' };
  assert.strictEqual(nextVersion(latest, 'hash-new', 3), 4);
});

test('buildTitle omits the version suffix for v1', () => {
  assert.strictEqual(buildTitle('fixed-quote', 'iMQ-00101', 1), 'Fixed Quote iMQ-00101');
});

test('buildTitle adds a (vN) suffix for later versions', () => {
  assert.strictEqual(buildTitle('fixed-quote', 'iMQ-00101', 2), 'Fixed Quote iMQ-00101 (v2)');
});

test('buildTitle maps every known doc type to a friendly label', () => {
  assert.strictEqual(buildTitle('estimate-quote', 'EST-1', 1), 'Estimate Quote EST-1');
  assert.strictEqual(buildTitle('deposit-invoice', 'DEP-1', 1), 'Deposit Invoice DEP-1');
  assert.strictEqual(buildTitle('main-invoice', 'INV-1', 1), 'Final Invoice INV-1');
  assert.strictEqual(buildTitle('move-receipt', 'INV-1', 1), 'Move Receipt INV-1');
});

test('buildDescription for a final invoice shows total, deposit and balance', () => {
  const desc = buildDescription('main-invoice', { total: 1200, deposit: 100, balance: 1100 });
  assert.strictEqual(desc, 'Total £1,200.00 · deposit £100.00 · balance £1,100.00');
});

test('buildDescription for a fixed quote shows the total', () => {
  const desc = buildDescription('fixed-quote', { total: 1000 });
  assert.strictEqual(desc, 'Total £1,000.00');
});

test('buildDescription for a deposit invoice shows the deposit amount', () => {
  const desc = buildDescription('deposit-invoice', { amount: 100, balance: 900 });
  assert.strictEqual(desc, 'Deposit £100.00 · balance £900.00');
});
