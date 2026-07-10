/**
 * Finance routes — cross-cutting money views for the Settings → Invoices tab.
 *
 * GET /invoices returns EVERY raised invoice in one normalized shape, across
 * both invoice families:
 *   - CrmJob invoices   (Invoice model: deposit | main | additional)
 *   - Contract invoices (ContractInvoice model: weekly contractor billing)
 *
 * "Raised" = not draft and not cancelled. Category buckets drive the client
 * filters: 'removal' (private CRM jobs), 'contract', and 'lux' (contract
 * whose contractor is flagged is_lux).
 */
const express = require('express');
const prisma = require('../db/prisma');
const { authenticate, requireAdmin } = require('../middleware/auth');
const wrap = require('../lib/async-handler');

const router = express.Router();
router.use(authenticate, requireAdmin);

router.get('/invoices', wrap(async (req, res) => {
  const [jobInvoices, contractInvoices] = await Promise.all([
    prisma.invoice.findMany({
      where: { status: { notIn: ['draft', 'cancelled'] } },
      select: {
        id: true, job_id: true, invoice_number: true, invoice_type: true,
        status: true, total: true, notes: true,
        sent_at: true, paid_at: true, created_at: true,
        job: { select: { id: true, full_name: true, quote_state: true } },
      },
    }),
    prisma.contractInvoice.findMany({
      where: { status: { not: 'draft' } },
      select: {
        id: true, contract_id: true, invoice_number: true, status: true, total: true,
        week_start: true, week_end: true,
        sent_at: true, paid_at: true, created_at: true,
        contract: { select: { id: true, company_name: true, is_lux: true } },
      },
    }),
  ]);

  const rows = [];

  for (const inv of jobInvoices) {
    // The QuoteBuilder "paid" ticks live in the job's quote_state; honour them
    // even when the invoice row itself hasn't been settled yet, so this list
    // always agrees with what the job profile shows.
    const qs = inv.job?.quote_state || {};
    const tickedPaid = inv.invoice_type === 'deposit'
      ? qs.depositPaid === true
      : inv.invoice_type === 'main'
        ? qs.balancePaid === true
        : false;
    const paid = inv.status === 'paid' || tickedPaid;
    rows.push({
      key: `job-${inv.id}`,
      family: 'job',
      category: 'removal',
      invoice_id: inv.id,
      invoice_number: inv.invoice_number,
      invoice_type: inv.invoice_type, // deposit | main | additional
      label: inv.job?.full_name || '(deleted job)',
      detail: inv.invoice_type === 'additional' ? (inv.notes || 'Ad-hoc charge') : null,
      performer: 'Private removals',
      total: inv.total,
      paid,
      status: paid ? 'paid' : inv.status,
      raised_at: (inv.sent_at || inv.created_at).toISOString(),
      paid_at: inv.paid_at ? inv.paid_at.toISOString() : null,
      job_id: inv.job_id,
      contract_id: null,
      is_lux: false,
    });
  }

  for (const inv of contractInvoices) {
    const isLux = !!inv.contract?.is_lux;
    rows.push({
      key: `contract-${inv.id}`,
      family: 'contract',
      category: isLux ? 'lux' : 'contract',
      invoice_id: inv.id,
      invoice_number: inv.invoice_number,
      invoice_type: 'contract',
      label: inv.contract?.company_name || '(deleted contract)',
      detail: `Week ${inv.week_start} – ${inv.week_end}`,
      performer: inv.contract?.company_name || '(deleted contract)',
      total: inv.total,
      paid: inv.status === 'paid',
      status: inv.status,
      raised_at: (inv.sent_at || inv.created_at).toISOString(),
      paid_at: inv.paid_at ? inv.paid_at.toISOString() : null,
      job_id: null,
      contract_id: inv.contract_id,
      is_lux: isLux,
    });
  }

  rows.sort((a, b) => b.raised_at.localeCompare(a.raised_at));
  res.json({ invoices: rows });
}));

module.exports = router;
