/**
 * Contract Jobs routes — manages contractor pricing items, daily jobs, and
 * weekly invoices for B2B contract work.
 *
 * Routes are grouped under /api/contract-jobs:
 *   - /contractors/:id/items          — per-contractor pricing items CRUD
 *   - /contractors/:id/jobs           — daily contract jobs CRUD (syncs to planner)
 *   - /contractors/:id/invoices       — weekly invoices CRUD
 *   - /contractors/:id/invoices/auto  — auto-draft a weekly invoice from jobs
 *   - /invoices/:id/pdf               — PDF preview/download
 *   - /invoices/:id/send-email        — email invoice with PDF attachment
 */
const express = require('express');
const router = express.Router();
const prisma = require('../db/prisma');
const { authenticate, requireAdmin } = require('../middleware/auth');
const wrap = require('../lib/async-handler');
const { nextReferenceNumberWithRetry } = require('../lib/reference-numbers');
const { generateContractInvoicePDF } = require('../services/pdf');
const { send: sendEmail } = require('../services/email');
const { reconcileDraftInvoice, syncDraftInvoiceForJobDate } = require('../lib/contract-invoice-sync');
const { computeOvertimeLines } = require('../lib/overtime-calc');
const { resolveBankSnapshot } = require('../lib/bank-account-snapshot');

router.use(authenticate, requireAdmin);

// ── Helpers ────────────────────────────────────────────────────────────────

function num(v, d = 0) {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : d;
}

function intOrNull(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : null;
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

function weekRange(weekStart) {
  // weekStart is YYYY-MM-DD (Monday). Returns { start, end } YYYY-MM-DD strings.
  const d = new Date(weekStart + 'T00:00:00');
  const end = new Date(d);
  end.setDate(d.getDate() + 6);
  return { start: weekStart, end: end.toISOString().slice(0, 10) };
}

function defaultHeader(weekStart) {
  const d = new Date(weekStart + 'T00:00:00');
  const opts = { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' };
  const formatted = d.toLocaleDateString('en-GB', opts);
  return `We commenced work on ${formatted}.`;
}

/**
 * Sync a contract job to a PlannerEvent so it appears on the planner calendar.
 * Returns the planner_event_id to store on the contract job row.
 */
async function syncPlannerEvent(contractJob, contract) {
  const title = contractJob.description?.trim()
    ? `${contract.company_name} — ${contractJob.description}`
    : `${contract.company_name} — Contract Job`;
  const crewBits = [];
  if (contractJob.men_needed) crewBits.push(`${contractJob.men_needed} crew`);
  if (contractJob.vans_needed) crewBits.push(`${contractJob.vans_needed} van${contractJob.vans_needed === 1 ? '' : 's'}`);
  if (contractJob.hgv_needed) crewBits.push(`${contractJob.hgv_needed} HGV`);
  const noteParts = [];
  if (crewBits.length) noteParts.push(crewBits.join(', '));
  if (contractJob.notes) noteParts.push(contractJob.notes);
  const eventNotes = noteParts.join(' · ') || null;

  if (contractJob.planner_event_id) {
    try {
      return await prisma.plannerEvent.update({
        where: { id: contractJob.planner_event_id },
        data: {
          title,
          category: 'Contract Job',
          customer_name: contract.company_name,
          address: contract.address || null,
          event_date: contractJob.job_date,
          notes: eventNotes,
          contract_id: contract.id,
        },
      });
    } catch (e) {
      // event row may have been deleted out from under us; fall through to create
      console.warn('[contract-jobs] planner_event update failed, recreating:', e.message);
    }
  }

  return prisma.plannerEvent.create({
    data: {
      title,
      category: 'Contract Job',
      customer_name: contract.company_name,
      address: contract.address || null,
      event_date: contractJob.job_date,
      notes: eventNotes,
      contract_id: contract.id,
    },
  });
}


// ── Contract items (per-contractor price list) ─────────────────────────────

router.get('/contractors/:cid/items', wrap(async (req, res) => {
  const cid = parseInt(req.params.cid, 10);
  if (!Number.isFinite(cid)) return res.status(400).json({ error: 'Invalid contractor id' });
  const items = await prisma.contractItem.findMany({
    where: { contract_id: cid, archived: false },
    orderBy: [{ sort_order: 'asc' }, { name: 'asc' }],
  });
  res.json(items);
}));

router.post('/contractors/:cid/items', wrap(async (req, res) => {
  const cid = parseInt(req.params.cid, 10);
  if (!Number.isFinite(cid)) return res.status(400).json({ error: 'Invalid contractor id' });
  const { name, unit_price, sort_order } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: 'Item name is required' });
  const row = await prisma.contractItem.create({
    data: {
      contract_id: cid,
      name: name.trim(),
      unit_price: num(unit_price, 0),
      sort_order: intOrNull(sort_order) ?? 0,
    },
  });
  res.status(201).json(row);
}));

router.put('/contractors/:cid/items/:id', wrap(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const { name, unit_price, sort_order, archived } = req.body;
  const updated = await prisma.contractItem.update({
    where: { id },
    data: {
      ...(name !== undefined ? { name: String(name).trim() } : {}),
      ...(unit_price !== undefined ? { unit_price: num(unit_price, 0) } : {}),
      ...(sort_order !== undefined ? { sort_order: intOrNull(sort_order) ?? 0 } : {}),
      ...(archived !== undefined ? { archived: !!archived } : {}),
    },
  });
  res.json(updated);
}));

router.delete('/contractors/:cid/items/:id', wrap(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  // Soft delete to preserve historical line items
  const used = await prisma.contractJobItem.count({ where: { contract_item_id: id } });
  if (used > 0) {
    const updated = await prisma.contractItem.update({ where: { id }, data: { archived: true } });
    return res.json({ archived: true, item: updated });
  }
  await prisma.contractItem.delete({ where: { id } });
  res.json({ ok: true });
}));

// ── Contract jobs ──────────────────────────────────────────────────────────

router.get('/contractors/:cid/jobs', wrap(async (req, res) => {
  const cid = parseInt(req.params.cid, 10);
  const { start, end } = req.query;
  const where = { contract_id: cid };
  if (start && end) where.job_date = { gte: String(start), lte: String(end) };

  const jobs = await prisma.contractJob.findMany({
    where,
    include: { items: { orderBy: { sort_order: 'asc' } } },
    orderBy: [{ job_date: 'desc' }, { created_at: 'desc' }],
  });
  res.json(jobs);
}));

router.get('/jobs/:id', wrap(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const job = await prisma.contractJob.findUnique({
    where: { id },
    include: { items: { orderBy: { sort_order: 'asc' } }, contract: true },
  });
  if (!job) return res.status(404).json({ error: 'Job not found' });
  res.json(job);
}));

router.post('/contractors/:cid/jobs', wrap(async (req, res) => {
  const cid = parseInt(req.params.cid, 10);
  const contract = await prisma.contract.findUnique({ where: { id: cid } });
  if (!contract) return res.status(404).json({ error: 'Contractor not found' });

  const { job_date, description, notes, men_needed, vans_needed, hgv_needed, items = [] } = req.body;
  if (!job_date) return res.status(400).json({ error: 'job_date is required' });

  const job = await prisma.contractJob.create({
    data: {
      contract_id: cid,
      job_date: String(job_date),
      description: description?.trim() || null,
      notes: notes?.trim() || null,
      men_needed: intOrNull(men_needed) ?? 0,
      vans_needed: intOrNull(vans_needed) ?? 0,
      hgv_needed: intOrNull(hgv_needed) ?? 0,
      items: {
        create: items.map((it, idx) => ({
          contract_item_id: intOrNull(it.contract_item_id),
          description: String(it.description || '').trim(),
          quantity: num(it.quantity, 1),
          unit_price: num(it.unit_price, 0),
          total: +(num(it.quantity, 1) * num(it.unit_price, 0)).toFixed(2),
          sort_order: idx,
        })),
      },
    },
    include: { items: { orderBy: { sort_order: 'asc' } } },
  });

  const event = await syncPlannerEvent(job, contract);
  const updated = await prisma.contractJob.update({
    where: { id: job.id },
    data: { planner_event_id: event.id },
    include: { items: { orderBy: { sort_order: 'asc' } } },
  });

  await syncDraftInvoiceForJobDate(cid, updated.job_date);

  res.status(201).json(updated);
}));

router.put('/jobs/:id', wrap(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const existing = await prisma.contractJob.findUnique({
    where: { id },
    include: { contract: true },
  });
  if (!existing) return res.status(404).json({ error: 'Job not found' });
  if (existing.invoiced) {
    return res.status(400).json({ error: 'Cannot edit a job already on a finalised invoice' });
  }

  const { job_date, description, notes, men_needed, vans_needed, hgv_needed, items } = req.body;

  await prisma.$transaction(async (tx) => {
    await tx.contractJob.update({
      where: { id },
      data: {
        ...(job_date !== undefined ? { job_date: String(job_date) } : {}),
        ...(description !== undefined ? { description: description?.trim() || null } : {}),
        ...(notes !== undefined ? { notes: notes?.trim() || null } : {}),
        ...(men_needed !== undefined ? { men_needed: intOrNull(men_needed) ?? 0 } : {}),
        ...(vans_needed !== undefined ? { vans_needed: intOrNull(vans_needed) ?? 0 } : {}),
        ...(hgv_needed !== undefined ? { hgv_needed: intOrNull(hgv_needed) ?? 0 } : {}),
      },
    });

    if (Array.isArray(items)) {
      await tx.contractJobItem.deleteMany({ where: { contract_job_id: id } });
      if (items.length > 0) {
        await tx.contractJobItem.createMany({
          data: items.map((it, idx) => ({
            contract_job_id: id,
            contract_item_id: intOrNull(it.contract_item_id),
            description: String(it.description || '').trim(),
            quantity: num(it.quantity, 1),
            unit_price: num(it.unit_price, 0),
            total: +(num(it.quantity, 1) * num(it.unit_price, 0)).toFixed(2),
            sort_order: idx,
          })),
        });
      }
    }
  });

  const refreshed = await prisma.contractJob.findUnique({
    where: { id },
    include: { items: { orderBy: { sort_order: 'asc' } } },
  });
  await syncPlannerEvent(refreshed, existing.contract);
  await syncDraftInvoiceForJobDate(existing.contract_id, refreshed.job_date);
  // If job_date moved, also reconcile the draft for the old date in case the
  // old week had a draft holding this job item.
  if (existing.job_date !== refreshed.job_date) {
    await syncDraftInvoiceForJobDate(existing.contract_id, existing.job_date);
  }

  res.json(refreshed);
}));

router.delete('/jobs/:id', wrap(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const job = await prisma.contractJob.findUnique({ where: { id } });
  if (!job) return res.status(404).json({ error: 'Job not found' });
  if (job.invoiced) {
    return res.status(400).json({ error: 'Cannot delete a job already on a finalised invoice' });
  }

  if (job.planner_event_id) {
    await prisma.plannerEvent.delete({ where: { id: job.planner_event_id } }).catch(() => {});
  }
  await prisma.contractJob.delete({ where: { id } });
  await syncDraftInvoiceForJobDate(job.contract_id, job.job_date);
  res.json({ ok: true });
}));

// ── Contract invoices ──────────────────────────────────────────────────────

router.get('/contractors/:cid/invoices', wrap(async (req, res) => {
  const cid = parseInt(req.params.cid, 10);
  const invoices = await prisma.contractInvoice.findMany({
    where: { contract_id: cid },
    orderBy: [{ week_start: 'desc' }, { created_at: 'desc' }],
  });
  res.json(invoices);
}));

router.get('/invoices/:id', wrap(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const head = await prisma.contractInvoice.findUnique({ where: { id }, select: { status: true } });
  if (!head) return res.status(404).json({ error: 'Invoice not found' });
  if (head.status === 'draft') {
    const reconciled = await reconcileDraftInvoice(id);
    return res.json(reconciled);
  }
  const inv = await prisma.contractInvoice.findUnique({
    where: { id },
    include: {
      items: { orderBy: [{ sort_order: 'asc' }, { job_date: 'asc' }] },
      contract: true,
    },
  });
  res.json(inv);
}));

/**
 * Auto-draft a weekly invoice for the given Monday: pulls every uninvoiced
 * job in [Mon..Sun] for the contractor, expands their items into invoice
 * lines (grouped/ordered by job_date), and creates a draft invoice.
 */
router.post('/contractors/:cid/invoices/auto', wrap(async (req, res) => {
  const cid = parseInt(req.params.cid, 10);
  const contract = await prisma.contract.findUnique({ where: { id: cid } });
  if (!contract) return res.status(404).json({ error: 'Contractor not found' });

  const { week_start, tax_rate = 20, include_invoiced = false } = req.body;
  if (!week_start || !/^\d{4}-\d{2}-\d{2}$/.test(week_start)) {
    return res.status(400).json({ error: 'week_start (YYYY-MM-DD) is required' });
  }

  const { start, end } = weekRange(week_start);

  const jobs = await prisma.contractJob.findMany({
    where: {
      contract_id: cid,
      job_date: { gte: start, lte: end },
      ...(include_invoiced ? {} : { invoiced: false }),
    },
    include: { items: { orderBy: { sort_order: 'asc' } } },
    orderBy: [{ job_date: 'asc' }, { created_at: 'asc' }],
  });

  // Flatten job items → invoice lines. Each line carries the source job id and date.
  const lines = [];
  let order = 0;
  for (const job of jobs) {
    if (job.items.length === 0) {
      // Job with no priced items — emit a single descriptive line @ £0 so it appears on the invoice.
      // No source_contract_job_item_id since there's no item to link to; reconcile will treat it as free-form.
      lines.push({
        source_contract_job_id: job.id,
        source_contract_job_item_id: null,
        job_date: job.job_date,
        description: job.description || 'Contract job',
        quantity: 1,
        unit_price: 0,
        total: 0,
        sort_order: order++,
      });
      continue;
    }
    for (const it of job.items) {
      lines.push({
        source_contract_job_id: job.id,
        source_contract_job_item_id: it.id,
        job_date: job.job_date,
        description: it.description,
        quantity: it.quantity,
        unit_price: it.unit_price,
        total: +(it.quantity * it.unit_price).toFixed(2),
        sort_order: order++,
      });
    }
  }

  // Interleave one overtime line after each day that has overtime, so it sits
  // within that day's block on the invoice. Recomputed live thereafter by
  // reconcileDraftInvoice.
  const overtimeLines = await computeOvertimeLines(prisma, contract, start, end);
  const otByDate = new Map(overtimeLines.map(l => [l.job_date, l]));
  const merged = [];
  for (let i = 0; i < lines.length; i++) {
    merged.push(lines[i]);
    const lastOfDay = i === lines.length - 1 || lines[i + 1].job_date !== lines[i].job_date;
    const ot = lastOfDay ? otByDate.get(lines[i].job_date) : undefined;
    if (ot) {
      merged.push({
        source_contract_job_id: null,
        source_contract_job_item_id: null,
        job_date: ot.job_date,
        description: ot.description,
        quantity: ot.hours,
        unit_price: ot.fee,
        total: ot.total,
        is_overtime: true,
      });
      otByDate.delete(ot.job_date);
    }
  }
  // Overtime on a day with no priced job lines (shouldn't normally happen) — append.
  for (const ot of otByDate.values()) {
    merged.push({
      source_contract_job_id: null,
      source_contract_job_item_id: null,
      job_date: ot.job_date,
      description: ot.description,
      quantity: ot.hours,
      unit_price: ot.fee,
      total: ot.total,
      is_overtime: true,
    });
  }
  merged.forEach((l, idx) => { l.sort_order = idx; });

  const totals = recalc(merged, tax_rate);

  const earliestDate = jobs[0]?.job_date || start;
  const bankSnapshot = await resolveBankSnapshot(prisma, req.body?.bank_account_id);

  const created = await nextReferenceNumberWithRetry(prisma, 'contract', (invoice_number) =>
    prisma.contractInvoice.create({
      data: {
        contract_id: cid,
        invoice_number,
        week_start: start,
        week_end: end,
        header_description: defaultHeader(earliestDate),
        tax_rate: num(tax_rate, 20),
        ...totals,
        ...bankSnapshot,
        items: { create: merged },
      },
      include: {
        items: { orderBy: [{ job_date: 'asc' }, { sort_order: 'asc' }] },
        contract: true,
      },
    }),
  );

  res.status(201).json(created);
}));

router.put('/invoices/:id', wrap(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const existing = await prisma.contractInvoice.findUnique({
    where: { id },
    include: { items: true },
  });
  if (!existing) return res.status(404).json({ error: 'Invoice not found' });
  if (existing.status === 'paid') {
    return res.status(400).json({ error: 'Paid invoices are locked' });
  }

  const { header_description, notes, tax_rate, items, status, bank_account_id } = req.body;
  const isDraft = existing.status === 'draft' && (status === undefined || status === 'draft');

  // Re-snapshot bank details if the client sent a bank_account_id field.
  // undefined = leave existing snapshot alone.
  const bankPatch = bank_account_id === undefined
    ? {}
    : await resolveBankSnapshot(prisma, bank_account_id);

  // Invoice-level metadata first (always safe to update on non-paid invoices).
  await prisma.contractInvoice.update({
    where: { id },
    data: {
      ...(header_description !== undefined ? { header_description: header_description || null } : {}),
      ...(notes !== undefined ? { notes: notes || null } : {}),
      ...(tax_rate !== undefined ? { tax_rate: num(tax_rate, existing.tax_rate) } : {}),
      ...(status !== undefined ? { status: String(status) } : {}),
      ...bankPatch,
    },
  });

  if (Array.isArray(items)) {
    if (isDraft) {
      // Bidirectional sync for drafts:
      //  - linked lines (have source_contract_job_item_id) → write back to ContractJobItem
      //  - free-form lines (no source ids) → store on invoice only
      //  - removed linked lines → delete the source ContractJobItem
      //  - removed free-form lines → delete the invoice line
      //  - new lines → stored as free-form (source ids null); to create a real job item the user goes via Jobs tab
      const existingById = new Map(existing.items.map(l => [l.id, l]));
      const incomingIds = new Set(items.filter(it => it.id).map(it => it.id));

      // Removals
      const removedJobItemIds = [];
      const removedInvoiceLineIds = [];
      for (const line of existing.items) {
        if (incomingIds.has(line.id)) continue;
        if (line.source_contract_job_item_id) {
          removedJobItemIds.push(line.source_contract_job_item_id);
        } else {
          removedInvoiceLineIds.push(line.id);
        }
      }
      if (removedJobItemIds.length > 0) {
        await prisma.contractJobItem.deleteMany({ where: { id: { in: removedJobItemIds } } });
      }
      if (removedInvoiceLineIds.length > 0) {
        await prisma.contractInvoiceItem.deleteMany({ where: { id: { in: removedInvoiceLineIds } } });
      }

      // Updates + creates
      for (let idx = 0; idx < items.length; idx++) {
        const it = items[idx];
        const prior = it.id ? existingById.get(it.id) : null;
        const desc = String(it.description || '').trim();
        const qty = num(it.quantity, 1);
        const price = num(it.unit_price, 0);

        if (prior && prior.source_contract_job_item_id) {
          // Linked → push edit back to the underlying job item. Job_date on the
          // line itself is authoritative-from-job, so don't honor date changes here.
          await prisma.contractJobItem.update({
            where: { id: prior.source_contract_job_item_id },
            data: { description: desc, quantity: qty, unit_price: price, total: +(qty * price).toFixed(2) },
          });
        } else if (prior) {
          // Free-form existing line → update in place.
          await prisma.contractInvoiceItem.update({
            where: { id: prior.id },
            data: {
              job_date: String(it.job_date),
              description: desc,
              quantity: qty,
              unit_price: price,
              total: +(qty * price).toFixed(2),
              sort_order: idx,
            },
          });
        } else {
          // New free-form line.
          await prisma.contractInvoiceItem.create({
            data: {
              contract_invoice_id: id,
              source_contract_job_id: null,
              source_contract_job_item_id: null,
              job_date: String(it.job_date),
              description: desc,
              quantity: qty,
              unit_price: price,
              total: +(qty * price).toFixed(2),
              sort_order: idx,
            },
          });
        }
      }
    } else {
      // Sent invoices: still let admins fix typos but don't push back to jobs.
      await prisma.$transaction(async (tx) => {
        await tx.contractInvoiceItem.deleteMany({ where: { contract_invoice_id: id } });
        if (items.length > 0) {
          await tx.contractInvoiceItem.createMany({
            data: items.map((it, idx) => ({
              contract_invoice_id: id,
              source_contract_job_id: intOrNull(it.source_contract_job_id),
              source_contract_job_item_id: intOrNull(it.source_contract_job_item_id),
              job_date: String(it.job_date),
              description: String(it.description || '').trim(),
              quantity: num(it.quantity, 1),
              unit_price: num(it.unit_price, 0),
              total: +(num(it.quantity, 1) * num(it.unit_price, 0)).toFixed(2),
              sort_order: idx,
            })),
          });
        }
      });
    }
  }

  // Recompute totals from current items + reconcile (for drafts, reconcile also re-orders).
  if (isDraft) {
    await reconcileDraftInvoice(id);
  } else {
    const lines = await prisma.contractInvoiceItem.findMany({ where: { contract_invoice_id: id } });
    const totals = recalc(lines, tax_rate ?? existing.tax_rate);
    await prisma.contractInvoice.update({ where: { id }, data: totals });
  }

  const refreshed = await prisma.contractInvoice.findUnique({
    where: { id },
    include: {
      items: { orderBy: [{ sort_order: 'asc' }, { job_date: 'asc' }] },
      contract: true,
    },
  });
  res.json(refreshed);
}));

router.patch('/invoices/:id/status', wrap(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const { status } = req.body;
  if (!['draft', 'sent', 'paid'].includes(status)) {
    return res.status(400).json({ error: 'status must be draft | sent | paid' });
  }

  const existing = await prisma.contractInvoice.findUnique({
    where: { id },
    include: { items: true },
  });
  if (!existing) return res.status(404).json({ error: 'Invoice not found' });

  const updated = await prisma.$transaction(async (tx) => {
    const data = { status };
    if (status === 'paid') data.paid_at = new Date();
    if (status !== 'paid') data.paid_at = null;
    const inv = await tx.contractInvoice.update({ where: { id }, data });

    // Lock the source jobs once the invoice leaves draft so they can't be
    // edited or double-invoiced.
    const jobIds = [...new Set(existing.items.map(i => i.source_contract_job_id).filter(Boolean))];
    if (jobIds.length > 0) {
      await tx.contractJob.updateMany({
        where: { id: { in: jobIds } },
        data: { invoiced: status === 'draft' ? false : true },
      });
    }
    return inv;
  });

  res.json(updated);
}));

router.delete('/invoices/:id', wrap(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const inv = await prisma.contractInvoice.findUnique({
    where: { id },
    include: { items: true },
  });
  if (!inv) return res.status(404).json({ error: 'Invoice not found' });
  if (inv.status === 'paid') {
    return res.status(400).json({ error: 'Paid invoices cannot be deleted' });
  }

  await prisma.$transaction(async (tx) => {
    const jobIds = [...new Set(inv.items.map(i => i.source_contract_job_id).filter(Boolean))];
    await tx.contractInvoice.delete({ where: { id } });
    if (jobIds.length > 0) {
      await tx.contractJob.updateMany({ where: { id: { in: jobIds } }, data: { invoiced: false } });
    }
  });

  res.json({ ok: true });
}));

// ── PDF + email ────────────────────────────────────────────────────────────

async function buildInvoicePdfData(invoiceId) {
  const inv = await prisma.contractInvoice.findUnique({
    where: { id: invoiceId },
    include: {
      items: { orderBy: [{ job_date: 'asc' }, { sort_order: 'asc' }] },
      contract: true,
    },
  });
  if (!inv) return null;
  return {
    invoice_number: inv.invoice_number,
    contract: {
      company_name: inv.contract.company_name,
      contact_name: inv.contract.contact_name,
      address: inv.contract.address,
      email: inv.contract.email,
      office_number: inv.contract.office_number,
      direct_line: inv.contract.direct_line,
    },
    week_start: inv.week_start,
    week_end: inv.week_end,
    header_description: inv.header_description,
    notes: inv.notes,
    items: inv.items.map(i => ({
      job_date: i.job_date,
      description: i.description,
      quantity: i.quantity,
      unit_price: i.unit_price,
      total: i.total,
    })),
    subtotal: inv.subtotal,
    tax_rate: inv.tax_rate,
    tax_amount: inv.tax_amount,
    total: inv.total,
    created_at: inv.created_at,
    bank_account_name:   inv.bank_account_name   || null,
    bank_sort_code:      inv.bank_sort_code      || null,
    bank_account_number: inv.bank_account_number || null,
  };
}

router.get('/invoices/:id/pdf', wrap(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const data = await buildInvoicePdfData(id);
  if (!data) return res.status(404).json({ error: 'Invoice not found' });
  const pdf = await generateContractInvoicePDF(data);
  res.setHeader('Content-Type', pdf.mimeType);
  res.setHeader('Content-Disposition', `inline; filename="${pdf.filename}"`);
  res.send(pdf.buffer);
}));

router.post('/invoices/:id/send-email', wrap(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const { to, subject, body_html, attach_pdf = true } = req.body;
  if (!to) return res.status(400).json({ error: 'Recipient email is required' });

  const data = await buildInvoicePdfData(id);
  if (!data) return res.status(404).json({ error: 'Invoice not found' });

  const weekLabel = (() => {
    const d = new Date(data.week_start + 'T00:00:00');
    return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
  })();

  let attachments = [];
  if (attach_pdf) {
    const pdf = await generateContractInvoicePDF(data);
    attachments.push({ filename: pdf.filename, content: pdf.buffer, contentType: pdf.mimeType });
  }

  const finalSubject = subject?.trim()
    || `Invoice ${data.invoice_number} — week commencing ${weekLabel}`;

  const finalHtml = body_html?.trim() || `
    <p>Hi ${data.contract.contact_name || data.contract.company_name},</p>
    <p>Please find attached invoice <strong>${data.invoice_number}</strong> for the week commencing <strong>${weekLabel}</strong>.</p>
    <p>Total due: <strong>£${data.total.toFixed(2)}</strong> (incl. VAT).</p>
    <p>Kind regards,<br/>iMove Relocations Ltd</p>
  `;

  const result = await sendEmail({ to, subject: finalSubject, html: finalHtml, attachments });

  await prisma.contractInvoice.update({
    where: { id },
    data: {
      status: 'sent',
      sent_at: new Date(),
      sent_to: to,
    },
  });

  // Lock source jobs once invoice is sent
  const items = await prisma.contractInvoiceItem.findMany({ where: { contract_invoice_id: id } });
  const jobIds = [...new Set(items.map(i => i.source_contract_job_id).filter(Boolean))];
  if (jobIds.length > 0) {
    await prisma.contractJob.updateMany({ where: { id: { in: jobIds } }, data: { invoiced: true } });
  }

  res.json({ success: true, email: result });
}));

module.exports = router;
