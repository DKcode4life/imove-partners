/**
 * Settle a job's deposit or main invoice when the QuoteBuilder "paid" tick is
 * saved: flip the invoice to 'paid' and record the covering Payment so the
 * receipt PDF has a real amount and date to print.
 *
 * The covering amount is what the customer actually hands over at that step:
 *   deposit invoice → its own total minus anything already recorded on it
 *   main invoice    → the job total minus deposits paid on their own
 *                     invoice(s), minus anything already recorded on it
 *
 * Target the invoice either by explicit `invoiceId` (send-receipt self-heal)
 * or by `invoiceType` (quote-state save). Returns the settled invoice with
 * its payments, or null when there's no matching invoice / it's already paid.
 */
async function settleInvoiceFromQuoteState(prisma, { jobId, invoiceType, invoiceId, paidAt }) {
  const where = invoiceId != null
    ? { id: invoiceId, job_id: jobId }
    : { job_id: jobId, invoice_type: invoiceType };
  const invoice = await prisma.invoice.findFirst({ where, include: { payments: true } });
  if (!invoice || invoice.status === 'paid') return null;

  const when = paidAt || new Date();
  await prisma.invoice.update({
    where: { id: invoice.id },
    data: { status: 'paid', paid_at: when },
  });

  // Deposits paid on their own invoice(s) reduce what the final payment covers.
  let depositPaid = 0;
  if (invoice.invoice_type === 'main') {
    const depositInvoices = await prisma.invoice.findMany({
      where: { job_id: jobId, invoice_type: 'deposit', status: 'paid' },
      include: { payments: true },
    });
    depositPaid = depositInvoices.reduce(
      (s, inv) => s + inv.payments.reduce((ps, p) => ps + p.amount, 0), 0);
  }
  const alreadyPaid = invoice.payments.reduce((s, p) => s + p.amount, 0);
  const remaining = invoice.total - depositPaid - alreadyPaid;
  if (remaining > 0) {
    await prisma.payment.create({
      data: { invoice_id: invoice.id, amount: remaining, method: 'bank_transfer', paid_at: when },
    });
  }

  return prisma.invoice.findFirst({
    where: { id: invoice.id },
    include: { payments: true },
  });
}

module.exports = { settleInvoiceFromQuoteState };
