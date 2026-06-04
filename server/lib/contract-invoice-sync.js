/**
 * Bidirectional sync helpers between ContractJob, ContractJobItem and
 * draft ContractInvoice / ContractInvoiceItem records.
 *
 * Used by:
 *   - server/routes/contract-jobs.js — job & invoice CRUD
 *   - server/routes/planner.js       — when an event move on the planner
 *                                       needs to propagate to its source job
 */
const prisma = require('../db/prisma');
const { computeOvertimeLines } = require('./overtime-calc');

function num(v, d = 0) {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : d;
}

function recalc(items, taxRate) {
  const subtotal = items.reduce((s, i) => s + (num(i.quantity, 1) * num(i.unit_price, 0)), 0);
  const tax_amount = +(subtotal * num(taxRate, 0) / 100).toFixed(2);
  return {
    subtotal: +subtotal.toFixed(2),
    tax_amount,
    total: +(subtotal + tax_amount).toFixed(2),
  };
}

/**
 * Reconcile a draft invoice against the current state of its week's jobs.
 * Paid/sent invoices are never touched.
 */
async function reconcileDraftInvoice(invoiceId) {
  const inv = await prisma.contractInvoice.findUnique({
    where: { id: invoiceId },
    include: { items: { orderBy: [{ job_date: 'asc' }, { sort_order: 'asc' }] } },
  });
  if (!inv || inv.status !== 'draft') return inv;

  const jobs = await prisma.contractJob.findMany({
    where: {
      contract_id: inv.contract_id,
      job_date: { gte: inv.week_start, lte: inv.week_end },
    },
    include: { items: { orderBy: { sort_order: 'asc' } } },
    orderBy: [{ job_date: 'asc' }, { created_at: 'asc' }],
  });

  // System-managed overtime lines: one per day with overtime, recomputed from
  // the planner times every reconcile. Keyed by job_date so each day's line is
  // flushed right after that day's job items (keeps the PDF's date grouping intact).
  const contract = await prisma.contract.findUnique({ where: { id: inv.contract_id } });
  const overtimeLines = await computeOvertimeLines(prisma, contract, inv.week_start, inv.week_end);
  const overtimeByDate = new Map(overtimeLines.map(l => [l.job_date, l]));

  const liveItemIds = new Set();
  const emptyJobIds = new Set();
  for (const job of jobs) {
    if (job.items.length === 0) emptyJobIds.add(job.id);
    for (const it of job.items) liveItemIds.add(it.id);
  }

  const existingLinkedByItemId = new Map();
  const existingEmptyJobLineByJobId = new Map();
  const existingOvertimeByDate = new Map();
  const freeForm = [];
  const stale = [];
  for (const line of inv.items) {
    if (line.is_overtime) {
      // Overtime lines are owned by the calculator — never treat as free-form.
      existingOvertimeByDate.set(line.job_date, line);
    } else if (line.source_contract_job_item_id && liveItemIds.has(line.source_contract_job_item_id)) {
      existingLinkedByItemId.set(line.source_contract_job_item_id, line);
    } else if (!line.source_contract_job_item_id && line.source_contract_job_id && emptyJobIds.has(line.source_contract_job_id)) {
      existingEmptyJobLineByJobId.set(line.source_contract_job_id, line);
    } else if (!line.source_contract_job_item_id && !line.source_contract_job_id) {
      freeForm.push(line);
    } else {
      stale.push(line);
    }
  }

  const ops = [];
  let sort = 0;

  // Emit (create/update) the overtime line for `date` at the current sort slot,
  // so it lands immediately after that date's job items.
  const flushOvertime = (date) => {
    const ot = overtimeByDate.get(date);
    if (!ot) return;
    const existing = existingOvertimeByDate.get(date);
    const data = {
      source_contract_job_id: null,
      source_contract_job_item_id: null,
      job_date: date,
      description: ot.description,
      quantity: ot.hours,
      unit_price: ot.fee,
      total: ot.total,
      sort_order: sort,
      is_overtime: true,
    };
    if (existing) {
      const needsUpdate =
        existing.description !== ot.description ||
        existing.quantity !== ot.hours ||
        existing.unit_price !== ot.fee ||
        existing.total !== ot.total ||
        existing.sort_order !== sort;
      if (needsUpdate) {
        ops.push(prisma.contractInvoiceItem.update({ where: { id: existing.id }, data }));
      }
    } else {
      ops.push(prisma.contractInvoiceItem.create({ data: { contract_invoice_id: inv.id, ...data } }));
    }
    sort += 1;
  };

  let prevDate = null;
  for (const job of jobs) {
    // Jobs are date-ordered: when the date advances, the previous day's items
    // are all emitted, so flush that day's overtime line before moving on.
    if (prevDate !== null && job.job_date !== prevDate) flushOvertime(prevDate);
    prevDate = job.job_date;
    if (job.items.length === 0) {
      const descDesc = job.description || 'Contract job';
      const existing = existingEmptyJobLineByJobId.get(job.id);
      if (existing) {
        const needsUpdate =
          existing.description !== descDesc ||
          existing.quantity !== 1 ||
          existing.unit_price !== 0 ||
          existing.total !== 0 ||
          existing.job_date !== job.job_date ||
          existing.sort_order !== sort;
        if (needsUpdate) {
          ops.push(prisma.contractInvoiceItem.update({
            where: { id: existing.id },
            data: {
              source_contract_job_id: job.id,
              source_contract_job_item_id: null,
              job_date: job.job_date,
              description: descDesc,
              quantity: 1,
              unit_price: 0,
              total: 0,
              sort_order: sort,
            },
          }));
        }
      } else {
        ops.push(prisma.contractInvoiceItem.create({
          data: {
            contract_invoice_id: inv.id,
            source_contract_job_id: job.id,
            source_contract_job_item_id: null,
            job_date: job.job_date,
            description: descDesc,
            quantity: 1,
            unit_price: 0,
            total: 0,
            sort_order: sort,
          },
        }));
      }
      sort += 1;
      continue;
    }

    for (const it of job.items) {
      const existing = existingLinkedByItemId.get(it.id);
      const lineTotal = +((Number(it.quantity) || 0) * (Number(it.unit_price) || 0)).toFixed(2);
      if (existing) {
        const needsUpdate =
          existing.description !== it.description ||
          existing.quantity !== it.quantity ||
          existing.unit_price !== it.unit_price ||
          existing.total !== lineTotal ||
          existing.job_date !== job.job_date ||
          existing.source_contract_job_id !== job.id ||
          existing.sort_order !== sort;
        if (needsUpdate) {
          ops.push(prisma.contractInvoiceItem.update({
            where: { id: existing.id },
            data: {
              source_contract_job_id: job.id,
              job_date: job.job_date,
              description: it.description,
              quantity: it.quantity,
              unit_price: it.unit_price,
              total: lineTotal,
              sort_order: sort,
            },
          }));
        }
      } else {
        ops.push(prisma.contractInvoiceItem.create({
          data: {
            contract_invoice_id: inv.id,
            source_contract_job_id: job.id,
            source_contract_job_item_id: it.id,
            job_date: job.job_date,
            description: it.description,
            quantity: it.quantity,
            unit_price: it.unit_price,
            total: lineTotal,
            sort_order: sort,
          },
        }));
      }
      sort += 1;
    }
  }

  // Flush the final day's overtime (the loop only flushes on a date change).
  if (prevDate !== null) flushOvertime(prevDate);

  // Drop overtime lines for days that no longer have any overtime.
  const staleOvertimeIds = [];
  for (const [date, line] of existingOvertimeByDate) {
    if (!overtimeByDate.has(date)) staleOvertimeIds.push(line.id);
  }

  const toDelete = [...stale.map(s => s.id), ...staleOvertimeIds];
  if (toDelete.length > 0) {
    ops.push(prisma.contractInvoiceItem.deleteMany({
      where: { id: { in: toDelete } },
    }));
  }

  for (const line of freeForm) {
    if (line.sort_order !== sort) {
      ops.push(prisma.contractInvoiceItem.update({
        where: { id: line.id },
        data: { sort_order: sort },
      }));
    }
    sort += 1;
  }

  if (ops.length > 0) await prisma.$transaction(ops);

  const synced = await prisma.contractInvoiceItem.findMany({
    where: { contract_invoice_id: inv.id },
  });
  const totals = recalc(synced, inv.tax_rate);
  if (totals.subtotal !== inv.subtotal || totals.tax_amount !== inv.tax_amount || totals.total !== inv.total) {
    await prisma.contractInvoice.update({ where: { id: inv.id }, data: totals });
  }

  return prisma.contractInvoice.findUnique({
    where: { id: invoiceId },
    include: {
      items: { orderBy: [{ sort_order: 'asc' }, { job_date: 'asc' }] },
      contract: true,
    },
  });
}

/**
 * Refresh any draft invoice that covers `jobDate` for this contractor.
 */
async function syncDraftInvoiceForJobDate(contractId, jobDate) {
  const inv = await prisma.contractInvoice.findFirst({
    where: {
      contract_id: contractId,
      status: 'draft',
      week_start: { lte: jobDate },
      week_end: { gte: jobDate },
    },
    select: { id: true },
  });
  if (inv) await reconcileDraftInvoice(inv.id);
}

module.exports = { reconcileDraftInvoice, syncDraftInvoiceForJobDate, recalc };
