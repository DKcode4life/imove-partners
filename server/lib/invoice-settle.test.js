const test = require('node:test');
const assert = require('node:assert/strict');
const { settleInvoiceFromQuoteState } = require('./invoice-settle');

// Minimal in-memory stand-in for the Prisma calls the helper makes. Rows are
// plain objects; `update` mutates them so a follow-up findFirst sees the new
// status, exactly like the real client would.
function fakePrisma({ invoices, payments = [] }) {
  const allPayments = [...payments];
  const matches = (row, where) =>
    (where.id === undefined || row.id === where.id) &&
    (where.job_id === undefined || row.job_id === where.job_id) &&
    (where.invoice_type === undefined || row.invoice_type === where.invoice_type) &&
    (where.status === undefined || row.status === where.status);
  const withPayments = row => ({
    ...row,
    payments: allPayments.filter(p => p.invoice_id === row.id),
  });
  return {
    createdPayments: allPayments,
    invoice: {
      findFirst: async ({ where }) => {
        const row = invoices.find(r => matches(r, where));
        return row ? withPayments(row) : null;
      },
      findMany: async ({ where }) => invoices.filter(r => matches(r, where)).map(withPayments),
      update: async ({ where, data }) => {
        const row = invoices.find(r => r.id === where.id);
        Object.assign(row, data);
        return withPayments(row);
      },
    },
    payment: {
      create: async ({ data }) => {
        allPayments.push(data);
        return data;
      },
    },
  };
}

test('settling a deposit invoice marks it paid and records its full total', async () => {
  const prisma = fakePrisma({
    invoices: [{ id: 1, job_id: 7, invoice_type: 'deposit', status: 'sent', total: 100 }],
  });

  const paidAt = new Date('2026-07-01');
  const settled = await settleInvoiceFromQuoteState(prisma, { jobId: 7, invoiceType: 'deposit', paidAt });

  assert.equal(settled.status, 'paid');
  assert.deepEqual(settled.paid_at, paidAt);
  assert.equal(settled.payments.length, 1);
  assert.equal(settled.payments[0].amount, 100);
  assert.deepEqual(settled.payments[0].paid_at, paidAt);
});

test('settling the main invoice records the balance (total minus paid deposit)', async () => {
  const prisma = fakePrisma({
    invoices: [
      { id: 1, job_id: 7, invoice_type: 'deposit', status: 'paid', total: 100 },
      { id: 2, job_id: 7, invoice_type: 'main', status: 'sent', total: 1200 },
    ],
    payments: [{ invoice_id: 1, amount: 100 }],
  });

  const settled = await settleInvoiceFromQuoteState(prisma, { jobId: 7, invoiceType: 'main', paidAt: new Date() });

  assert.equal(settled.status, 'paid');
  assert.equal(settled.payments.length, 1);
  assert.equal(settled.payments[0].amount, 1100);
});

test('an unpaid deposit invoice does not reduce the main balance', async () => {
  const prisma = fakePrisma({
    invoices: [
      { id: 1, job_id: 7, invoice_type: 'deposit', status: 'sent', total: 100 },
      { id: 2, job_id: 7, invoice_type: 'main', status: 'sent', total: 1200 },
    ],
  });

  const settled = await settleInvoiceFromQuoteState(prisma, { jobId: 7, invoiceType: 'main', paidAt: new Date() });

  assert.equal(settled.payments[0].amount, 1200);
});

test('payments already recorded on the main invoice reduce the covering payment', async () => {
  const prisma = fakePrisma({
    invoices: [
      { id: 1, job_id: 7, invoice_type: 'deposit', status: 'paid', total: 100 },
      { id: 2, job_id: 7, invoice_type: 'main', status: 'sent', total: 1200 },
    ],
    payments: [
      { invoice_id: 1, amount: 100 },
      { invoice_id: 2, amount: 500 },
    ],
  });

  const settled = await settleInvoiceFromQuoteState(prisma, { jobId: 7, invoiceType: 'main', paidAt: new Date() });

  assert.equal(settled.payments.length, 2);
  const added = settled.payments.find(p => p.amount !== 500);
  assert.equal(added.amount, 600); // 1200 − 100 deposit − 500 already recorded
});

test('marks paid without a payment row when nothing is left to cover', async () => {
  const prisma = fakePrisma({
    invoices: [{ id: 2, job_id: 7, invoice_type: 'main', status: 'sent', total: 1000 }],
    payments: [{ invoice_id: 2, amount: 1000 }],
  });

  const settled = await settleInvoiceFromQuoteState(prisma, { jobId: 7, invoiceType: 'main', paidAt: new Date() });

  assert.equal(settled.status, 'paid');
  assert.equal(settled.payments.length, 1); // no new row added
});

test('returns null when the invoice is already paid (no duplicate payment)', async () => {
  const prisma = fakePrisma({
    invoices: [{ id: 1, job_id: 7, invoice_type: 'deposit', status: 'paid', total: 100 }],
    payments: [{ invoice_id: 1, amount: 100 }],
  });

  const settled = await settleInvoiceFromQuoteState(prisma, { jobId: 7, invoiceType: 'deposit', paidAt: new Date() });

  assert.equal(settled, null);
  assert.equal(prisma.createdPayments.length, 1);
});

test('returns null when the job has no invoice of that type', async () => {
  const prisma = fakePrisma({ invoices: [] });
  const settled = await settleInvoiceFromQuoteState(prisma, { jobId: 7, invoiceType: 'main', paidAt: new Date() });
  assert.equal(settled, null);
});

test('targets a specific invoice by id when invoiceId is given', async () => {
  const prisma = fakePrisma({
    invoices: [
      { id: 5, job_id: 7, invoice_type: 'main', status: 'sent', total: 800 },
      { id: 6, job_id: 7, invoice_type: 'main', status: 'sent', total: 900 },
    ],
  });

  const settled = await settleInvoiceFromQuoteState(prisma, { jobId: 7, invoiceId: 6, paidAt: new Date() });

  assert.equal(settled.id, 6);
  assert.equal(settled.status, 'paid');
  assert.equal(settled.payments[0].amount, 900);
});
