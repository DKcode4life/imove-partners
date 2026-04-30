/**
 * Invoice & Receipt routes — handles the 4 non-quote document flows:
 *   - Deposit Invoice  (POST /jobs/:id/invoices?type=deposit + send-email)
 *   - Main Invoice     (POST /jobs/:id/invoices?type=main + send-email)
 *   - Deposit Receipt  (POST /jobs/:id/invoices/:invoiceId/send-receipt)
 *   - Move Receipt     (POST /jobs/:id/invoices/:invoiceId/send-receipt)
 *
 * Receipts are NOT separate Invoice rows — they're rendered against an
 * existing paid Invoice plus its Payment records.
 */
const express = require('express');
const prisma = require('../db/prisma');
const { authenticate, requireAdmin } = require('../middleware/auth');
const wrap = require('../lib/async-handler');
const { generateInvoicePDF } = require('../services/pdf');
const { sendTemplated } = require('../services/email');

const router = express.Router();
router.use(authenticate, requireAdmin);

function generateInvoiceNumber(prefix = 'INV') {
  const ts = Date.now().toString().slice(-6);
  const rnd = Math.floor(Math.random() * 100).toString().padStart(2, '0');
  return `${prefix}-${ts}${rnd}`;
}

function fullAddress(line1, city, postcode) {
  if (!line1) return null;
  return `${line1}, ${city || ''} ${postcode || ''}`.trim();
}

// ─── GET: list all invoices for a job ────────────────────────────────────
router.get('/jobs/:id/invoices', wrap(async (req, res) => {
  const jobId = parseInt(req.params.id);
  if (isNaN(jobId)) return res.status(400).json({ error: 'Invalid job ID' });

  const invoices = await prisma.invoice.findMany({
    where: { job_id: jobId },
    include: { items: true, payments: true },
    orderBy: { created_at: 'desc' },
  });
  res.json(invoices);
}));

// ─── POST: create a new invoice (deposit or main) ────────────────────────
router.post('/jobs/:id/invoices', wrap(async (req, res) => {
  const jobId = parseInt(req.params.id);
  if (isNaN(jobId)) return res.status(400).json({ error: 'Invalid job ID' });

  const {
    invoice_type = 'main',           // 'deposit' | 'main'
    quote_id,
    notes,
    subtotal = 0,
    tax_amount = 0,
    total = 0,
    due_date,
    items = [],
  } = req.body;

  if (!['deposit', 'main'].includes(invoice_type)) {
    return res.status(400).json({ error: "invoice_type must be 'deposit' or 'main'" });
  }
  if (!items.length) {
    return res.status(400).json({ error: 'At least one line item is required' });
  }

  const job = await prisma.crmJob.findUnique({ where: { id: jobId } });
  if (!job) return res.status(404).json({ error: 'Job not found' });

  const invoice = await prisma.invoice.create({
    data: {
      job_id: jobId,
      quote_id: quote_id ? parseInt(quote_id) : null,
      invoice_type,
      invoice_number: generateInvoiceNumber(invoice_type === 'deposit' ? 'DEP' : 'INV'),
      subtotal: parseFloat(subtotal) || 0,
      tax_amount: parseFloat(tax_amount) || 0,
      total: parseFloat(total) || 0,
      due_date: due_date || null,
      notes: notes || null,
      items: {
        create: items.map((item, idx) => ({
          description: item.description || '',
          quantity: parseFloat(item.quantity) || 1,
          unit_price: parseFloat(item.unit_price) || 0,
          total: parseFloat(item.total) || 0,
          sort_order: idx,
        })),
      },
    },
    include: { items: true, payments: true },
  });

  await prisma.crmActivity.create({
    data: {
      job_id: jobId,
      type: 'note',
      note: `Created ${invoice_type} invoice ${invoice.invoice_number} for £${invoice.total.toFixed(2)}`,
    },
  });

  res.status(201).json(invoice);
}));

// ─── GET: PDF preview of an invoice ──────────────────────────────────────
router.get('/jobs/:id/invoices/:invoiceId/pdf', wrap(async (req, res) => {
  const jobId = parseInt(req.params.id);
  const invoiceId = parseInt(req.params.invoiceId);
  if (isNaN(jobId) || isNaN(invoiceId)) {
    return res.status(400).json({ error: 'Invalid IDs' });
  }

  const invoice = await prisma.invoice.findFirst({
    where: { id: invoiceId, job_id: jobId },
    include: { items: true, payments: true, job: true },
  });
  if (!invoice) return res.status(404).json({ error: 'Invoice not found' });

  const job = invoice.job;

  // Sum existing payments on the job's deposit invoices (for main-invoice deposit-paid line)
  let depositPaid = 0;
  if (invoice.invoice_type === 'main') {
    const depositInvoices = await prisma.invoice.findMany({
      where: { job_id: jobId, invoice_type: 'deposit', status: 'paid' },
      include: { payments: true },
    });
    depositPaid = depositInvoices.reduce((s, inv) =>
      s + inv.payments.reduce((ps, p) => ps + p.amount, 0), 0);
  }

  const pdf = await generateInvoicePDF({
    mode: invoice.invoice_type === 'deposit' ? 'deposit-invoice' : 'main-invoice',
    invoice_number: invoice.invoice_number,
    customer_name: job.full_name,
    customer_email: job.email,
    customer_phone: job.phone,
    from_address: fullAddress(job.from_line1, job.from_city, job.from_postcode),
    to_address: fullAddress(job.to_line1, job.to_city, job.to_postcode),
    move_date: job.confirmed_move_date || job.preferred_move_date,
    due_date: invoice.due_date,
    items: invoice.items.map(i => ({ description: i.description, quantity: i.quantity, unit_price: i.unit_price, total: i.total })),
    subtotal: invoice.subtotal,
    tax_amount: invoice.tax_amount,
    total: invoice.total,
    deposit_paid: depositPaid,
    balance: invoice.total - depositPaid,
    notes: invoice.notes,
  });

  res.setHeader('Content-Type', pdf.mimeType);
  res.setHeader('Content-Disposition', `inline; filename="${pdf.filename}"`);
  res.send(pdf.buffer);
}));

// ─── POST: email an invoice (deposit or main) ────────────────────────────
router.post('/jobs/:id/invoices/:invoiceId/send-email', wrap(async (req, res) => {
  const jobId = parseInt(req.params.id);
  const invoiceId = parseInt(req.params.invoiceId);
  if (isNaN(jobId) || isNaN(invoiceId)) {
    return res.status(400).json({ error: 'Invalid IDs' });
  }

  const { to, subject, body_html, attach_pdf = true } = req.body;
  if (!to) return res.status(400).json({ error: 'Recipient email is required' });

  const invoice = await prisma.invoice.findFirst({
    where: { id: invoiceId, job_id: jobId },
    include: { items: true, payments: true, job: true },
  });
  if (!invoice) return res.status(404).json({ error: 'Invoice not found' });

  const job = invoice.job;

  // Sum any existing deposit payments (used in main-invoice PDF balance calculation)
  let depositPaid = 0;
  if (invoice.invoice_type === 'main') {
    const depositInvoices = await prisma.invoice.findMany({
      where: { job_id: jobId, invoice_type: 'deposit', status: 'paid' },
      include: { payments: true },
    });
    depositPaid = depositInvoices.reduce((s, inv) =>
      s + inv.payments.reduce((ps, p) => ps + p.amount, 0), 0);
  }
  const balance = invoice.total - depositPaid;

  // Build PDF attachment
  let pdfAttachment = null;
  if (attach_pdf) {
    const pdf = await generateInvoicePDF({
      mode: invoice.invoice_type === 'deposit' ? 'deposit-invoice' : 'main-invoice',
      invoice_number: invoice.invoice_number,
      customer_name: job.full_name,
      customer_email: job.email,
      customer_phone: job.phone,
      from_address: fullAddress(job.from_line1, job.from_city, job.from_postcode),
      to_address: fullAddress(job.to_line1, job.to_city, job.to_postcode),
      move_date: job.confirmed_move_date || job.preferred_move_date,
      due_date: invoice.due_date,
      items: invoice.items.map(i => ({ description: i.description, quantity: i.quantity, unit_price: i.unit_price, total: i.total })),
      subtotal: invoice.subtotal,
      tax_amount: invoice.tax_amount,
      total: invoice.total,
      deposit_paid: depositPaid,
      balance,
      notes: invoice.notes,
    });
    pdfAttachment = { filename: pdf.filename, content: pdf.buffer, contentType: pdf.mimeType };
  }

  const variables = {
    job_id: jobId,
    customer_name: job.full_name,
    invoice_number: invoice.invoice_number,
    amount: invoice.total.toFixed(2),
    total: invoice.total.toFixed(2),
    deposit_paid: depositPaid.toFixed(2),
    balance: balance.toFixed(2),
    due_date: invoice.due_date || 'within 7 days',
    move_date: job.confirmed_move_date || job.preferred_move_date || 'to be confirmed',
  };

  const templateSlug = invoice.invoice_type === 'deposit' ? 'deposit-invoice' : 'main-invoice';

  const emailResult = await sendTemplated({
    to,
    templateSlug,
    variables,
    subjectOverride: subject || undefined,
    bodyOverride: body_html || undefined,
    attachments: pdfAttachment ? [pdfAttachment] : [],
  });

  await prisma.invoice.update({
    where: { id: invoiceId },
    data: { status: 'sent', sent_at: new Date(), sent_to: to },
  });

  await prisma.crmActivity.create({
    data: {
      job_id: jobId,
      type: 'note',
      note: `${invoice.invoice_type === 'deposit' ? 'Deposit invoice' : 'Final invoice'} ${invoice.invoice_number} emailed to ${to}`,
    },
  });

  res.json({ success: true, email: emailResult, invoice: { id: invoice.id, invoice_number: invoice.invoice_number } });
}));

// ─── POST: record a payment against an invoice (marks it paid) ───────────
router.post('/jobs/:id/invoices/:invoiceId/payments', wrap(async (req, res) => {
  const jobId = parseInt(req.params.id);
  const invoiceId = parseInt(req.params.invoiceId);
  if (isNaN(jobId) || isNaN(invoiceId)) {
    return res.status(400).json({ error: 'Invalid IDs' });
  }

  const { amount, method = 'bank_transfer', reference, notes, paid_at } = req.body;
  if (!amount || parseFloat(amount) <= 0) {
    return res.status(400).json({ error: 'Valid amount required' });
  }

  const invoice = await prisma.invoice.findFirst({
    where: { id: invoiceId, job_id: jobId },
    include: { payments: true },
  });
  if (!invoice) return res.status(404).json({ error: 'Invoice not found' });

  const payment = await prisma.payment.create({
    data: {
      invoice_id: invoiceId,
      amount: parseFloat(amount),
      method,
      reference: reference || null,
      notes: notes || null,
      paid_at: paid_at ? new Date(paid_at) : new Date(),
    },
  });

  // Recalculate total paid; if >= invoice total, mark invoice as paid
  const totalPaid = invoice.payments.reduce((s, p) => s + p.amount, 0) + parseFloat(amount);
  const isFullyPaid = totalPaid >= invoice.total;

  if (isFullyPaid) {
    await prisma.invoice.update({
      where: { id: invoiceId },
      data: { status: 'paid', paid_at: new Date() },
    });

    // Reflect on the parent job
    if (invoice.invoice_type === 'deposit') {
      await prisma.crmJob.update({ where: { id: jobId }, data: { deposit_paid: true } });
    }
  }

  await prisma.crmActivity.create({
    data: {
      job_id: jobId,
      type: 'note',
      note: `Recorded £${parseFloat(amount).toFixed(2)} payment via ${method}${isFullyPaid ? ' — invoice marked PAID' : ''}`,
    },
  });

  res.status(201).json({ payment, invoiceFullyPaid: isFullyPaid });
}));

// ─── POST: send a receipt for a paid invoice ─────────────────────────────
router.post('/jobs/:id/invoices/:invoiceId/send-receipt', wrap(async (req, res) => {
  const jobId = parseInt(req.params.id);
  const invoiceId = parseInt(req.params.invoiceId);
  if (isNaN(jobId) || isNaN(invoiceId)) {
    return res.status(400).json({ error: 'Invalid IDs' });
  }

  const { to, subject, body_html } = req.body;
  if (!to) return res.status(400).json({ error: 'Recipient email is required' });

  const invoice = await prisma.invoice.findFirst({
    where: { id: invoiceId, job_id: jobId },
    include: { payments: true, job: true },
  });
  if (!invoice) return res.status(404).json({ error: 'Invoice not found' });
  if (invoice.status !== 'paid') {
    return res.status(400).json({ error: 'Cannot send receipt — invoice is not yet marked paid' });
  }

  const job = invoice.job;
  const totalPaid = invoice.payments.reduce((s, p) => s + p.amount, 0);
  const lastPayment = invoice.payments.sort((a, b) => b.paid_at - a.paid_at)[0];

  // For deposit receipt, calculate what's still owed (job total − deposit paid)
  let balance = 0;
  if (invoice.invoice_type === 'deposit') {
    // Look up the latest fixed quote total to know balance after deposit
    const latestQuote = await prisma.quote.findFirst({
      where: { job_id: jobId, quote_type: 'fixed' },
      orderBy: { created_at: 'desc' },
    });
    if (latestQuote) balance = latestQuote.total - totalPaid;
  }

  const isMoveReceipt = invoice.invoice_type === 'main';

  const pdf = await generateInvoicePDF({
    mode: isMoveReceipt ? 'move-receipt' : 'deposit-receipt',
    invoice_number: invoice.invoice_number,
    customer_name: job.full_name,
    customer_email: job.email,
    customer_phone: job.phone,
    from_address: fullAddress(job.from_line1, job.from_city, job.from_postcode),
    to_address: fullAddress(job.to_line1, job.to_city, job.to_postcode),
    move_date: job.confirmed_move_date || job.preferred_move_date,
    amount_paid: totalPaid,
    total: invoice.total,
    balance,
    payment_method: lastPayment?.method,
    payment_date: lastPayment?.paid_at?.toLocaleDateString('en-GB'),
    notes: invoice.notes,
  });

  const variables = {
    job_id: jobId,
    customer_name: job.full_name,
    amount: totalPaid.toFixed(2),
    total: invoice.total.toFixed(2),
    balance: balance.toFixed(2),
    move_date: job.confirmed_move_date || job.preferred_move_date || 'your moving day',
  };

  const templateSlug = isMoveReceipt ? 'move-receipt' : 'deposit-receipt';

  const emailResult = await sendTemplated({
    to,
    templateSlug,
    variables,
    subjectOverride: subject || undefined,
    bodyOverride: body_html || undefined,
    attachments: [{ filename: pdf.filename, content: pdf.buffer, contentType: pdf.mimeType }],
  });

  await prisma.crmActivity.create({
    data: {
      job_id: jobId,
      type: 'note',
      note: `${isMoveReceipt ? 'Final move receipt' : 'Deposit receipt'} for ${invoice.invoice_number} emailed to ${to}`,
    },
  });

  res.json({ success: true, email: emailResult });
}));

module.exports = router;
