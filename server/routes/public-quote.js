/**
 * Public (UNAUTHENTICATED) quote-acceptance API.
 *
 * Powers the customer-facing /accept/:token page reached from the "Accept Your
 * Quote" button in the fixed-quote email. The only credential is the
 * unguessable `accept_token` minted when the fixed quote was sent — there is no
 * login. Because these routes are public, they:
 *   - expose only fixed quotes that have actually been sent (never drafts/estimates),
 *   - return just the data the customer needs to review and accept,
 *   - validate every field of the submitted payload server-side,
 *   - are idempotent: a second acceptance is a no-op that returns the frozen state.
 *
 * On acceptance the firm total is recomputed from the customer's optional-service
 * selection, the quote + job are marked accepted, an acceptance-form PDF is
 * generated and emailed to the customer (and to us), and an immutable
 * SentDocument snapshot is written so the form shows up in the CRM history.
 */
const express = require('express');
const prisma = require('../db/prisma');
const config = require('../config');
const wrap = require('../lib/async-handler');
const { generateAcceptancePDF } = require('../services/pdf');
const { sendTemplated, send } = require('../services/email');
const { recordSentDocument } = require('../lib/sent-document');
const {
  splitItems,
  computeAcceptedTotals,
  validateAcceptancePayload,
  applyAcceptanceToQuoteState,
} = require('../lib/quote-acceptance');

const router = express.Router();

// Where acceptance notifications land internally, and the terms link shown to
// the customer. Both overridable via env without a code change.
const COMPANY_EMAIL = process.env.COMPANY_NOTIFICATION_EMAIL || 'info@myimove.co.uk';
const TERMS_URL = process.env.TERMS_URL || 'https://www.myimove.co.uk/terms';

/** "12 High St, Flat 2, London SW1A 1AA" from a job's from/to address columns. */
function formatAddress(line1, line2, city, postcode) {
  if (!line1) return null;
  return `${line1}${line2 ? ', ' + line2 : ''}, ${city || ''} ${postcode || ''}`.trim();
}

/** Map a job + selected items into the argument object generateAcceptancePDF wants. */
function buildAcceptancePdfArgs(job, quote, acceptedItems, declaredValue, acceptedDate) {
  return {
    quote_number: quote.quote_number,
    customer_name: job.full_name,
    customer_email: job.email,
    customer_phone: job.phone,
    from_address: formatAddress(job.from_line1, job.from_line2, job.from_city, job.from_postcode),
    to_address: formatAddress(job.to_line1, job.to_line2, job.to_city, job.to_postcode),
    property_type_from: job.property_type_from,
    property_type_to: job.property_type_to,
    bedrooms: job.bedrooms,
    bedrooms_to: job.bedrooms_to,
    floor_from: job.floor_from,
    floor_to: job.floor_to,
    has_lift_from: job.has_lift_from,
    has_lift_to: job.has_lift_to,
    move_date: job.confirmed_move_date || job.preferred_move_date,
    items: acceptedItems.map((i) => ({
      description: i.description,
      quantity: i.quantity,
      unit_price: i.unit_price,
      total: i.total,
    })),
    subtotal: quote.subtotal,
    tax_rate: quote.tax_rate,
    tax_amount: quote.tax_amount,
    total: quote.accepted_total ?? quote.total,
    declared_value: declaredValue,
    accepted_date: acceptedDate,
  };
}

/** Load a sent FIXED quote by its public token, or null. */
async function findQuoteByToken(token) {
  if (!token || typeof token !== 'string') return null;
  const quote = await prisma.quote.findUnique({
    where: { accept_token: token },
    include: { items: { orderBy: { sort_order: 'asc' } }, job: true },
  });
  if (!quote) return null;
  // Never expose drafts or estimates through the public link.
  if (quote.quote_type !== 'fixed' || !quote.sent_at) return null;
  return quote;
}

/** Shape the public view of a quote for the acceptance page. */
function serializeQuote(quote) {
  const job = quote.job;
  const vatApplied = Number(quote.tax_amount) > 0;
  const { mandatory, optional } = splitItems(quote.items);
  const isAccepted = quote.status === 'accepted';

  const mapItem = (i) => ({
    id: i.id,
    description: i.description,
    total: i.total,
    accepted: i.accepted,
  });

  // Mandatory subtotal is always included. Optional adds on selection.
  const mandatorySubtotal = mandatory.reduce((s, i) => s + (Number(i.total) || 0), 0);

  return {
    quote_number: quote.quote_number,
    status: quote.status,
    is_accepted: isAccepted,
    accepted_at: quote.accepted_at,
    declared_value: quote.declared_value,
    accepted_total: quote.accepted_total,
    valid_until: quote.valid_until,
    vat_applied: vatApplied,
    tax_rate: quote.tax_rate,
    customer_name: job.full_name,
    move_date: job.confirmed_move_date || job.preferred_move_date || null,
    from_address: formatAddress(job.from_line1, job.from_line2, job.from_city, job.from_postcode),
    to_address: formatAddress(job.to_line1, job.to_line2, job.to_city, job.to_postcode),
    mandatory_items: mandatory.map(mapItem),
    optional_items: optional.map(mapItem),
    mandatory_subtotal: mandatorySubtotal,
    company: { name: 'iMove Relocations Ltd', phone: '01638 255 255', email: COMPANY_EMAIL },
    terms_url: TERMS_URL,
  };
}

// ─── GET: the quote a customer is about to accept ────────────────────────────
router.get('/quotes/:token', wrap(async (req, res) => {
  const quote = await findQuoteByToken(req.params.token);
  if (!quote) return res.status(404).json({ error: 'This quote link is invalid or has expired.' });
  res.json(serializeQuote(quote));
}));

// ─── POST: accept the quote ──────────────────────────────────────────────────
router.post('/quotes/:token/accept', wrap(async (req, res) => {
  const quote = await findQuoteByToken(req.params.token);
  if (!quote) return res.status(404).json({ error: 'This quote link is invalid or has expired.' });

  // Idempotent: a re-submit after acceptance just echoes the frozen state.
  if (quote.status === 'accepted') {
    return res.json({ ok: true, already_accepted: true, total: quote.accepted_total ?? quote.total });
  }

  const { ok, errors, selectedOptionalIds, declaredValue } = validateAcceptancePayload(req.body, quote.items);
  if (!ok) return res.status(400).json({ error: errors[0], errors });

  const vatApplied = Number(quote.tax_amount) > 0;
  const { acceptedItems, subtotal, taxAmount, total } = computeAcceptedTotals({
    items: quote.items,
    selectedOptionalIds,
    taxRate: quote.tax_rate,
    vatApplied,
  });

  const acceptedDate = new Date();
  const selectedSet = new Set(selectedOptionalIds);

  // Reflect the chosen optional services back into the QuoteBuilder's quote_state
  // so the CRM shows them ticked and the Fix Quotation total + deposit recompute.
  const acceptedOptionalItems = acceptedItems
    .filter((i) => i.is_optional)
    .map((i) => ({ description: i.description, total: i.total }));
  const { quoteState: updatedQuoteState, changed: quoteStateChanged } =
    applyAcceptanceToQuoteState(quote.job.quote_state, acceptedOptionalItems);

  // Persist acceptance atomically. Mandatory items are untouched; optional items
  // get their `accepted` flag set to reflect the customer's tick boxes.
  await prisma.$transaction([
    ...quote.items
      .filter((i) => i.is_optional)
      .map((i) =>
        prisma.quoteItem.update({
          where: { id: i.id },
          data: { accepted: selectedSet.has(i.id) },
        }),
      ),
    prisma.quote.update({
      where: { id: quote.id },
      data: {
        status: 'accepted',
        accepted_at: acceptedDate,
        declared_value: declaredValue,
        accepted_total: total,
        subtotal,
        tax_amount: taxAmount,
        total,
      },
    }),
    prisma.crmJob.update({
      where: { id: quote.job_id },
      data: {
        quote_accepted: true,
        status: 'Quote Accepted',
        quote_amount: total,
        ...(quoteStateChanged ? { quote_state: updatedQuoteState } : {}),
      },
    }),
    prisma.crmActivity.create({
      data: {
        job_id: quote.job_id,
        type: 'note',
        note: `Quote ${quote.quote_number} accepted online — total £${total.toFixed(2)}, declared item value £${declaredValue.toFixed(2)}`,
      },
    }),
  ]);

  // Reload the accepted total onto the quote object for the PDF args.
  const pdfArgs = buildAcceptancePdfArgs(
    quote.job,
    { ...quote, accepted_total: total, subtotal, tax_amount: taxAmount },
    acceptedItems,
    declaredValue,
    acceptedDate,
  );

  // Best-effort delivery + bookkeeping: never let a post-accept failure surface
  // as an error to the customer who has already accepted.
  const safe = async (label, fn) => {
    try { return await fn(); }
    catch (err) { console.error(`[Accept] ${label} failed:`, err.message); return null; }
  };

  const pdf = await safe('generate PDF', () => generateAcceptancePDF(pdfArgs));
  const attachment = pdf
    ? [{ filename: pdf.filename, content: pdf.buffer, contentType: pdf.mimeType }]
    : [];

  const customerEmail = quote.job.email;
  let emailResult = null;
  if (customerEmail) {
    emailResult = await safe('customer email', () =>
      sendTemplated({
        to: customerEmail,
        templateSlug: 'quote-accepted',
        variables: {
          job_id: quote.job_id,
          customer_name: quote.job.full_name,
          quote_number: quote.quote_number,
          amount: total.toFixed(2),
          declared_value: declaredValue.toFixed(2),
          move_date: quote.job.confirmed_move_date || quote.job.preferred_move_date || 'to be confirmed',
        },
        attachments: attachment,
      }),
    );
  }

  // Immutable snapshot so the acceptance form appears in the CRM "Sent to
  // Clients" history with a regenerable, byte-identical PDF.
  await safe('sent-document snapshot', () =>
    recordSentDocument(prisma, {
      jobId: quote.job_id,
      docType: 'quote-acceptance',
      reference: quote.quote_number,
      toEmail: customerEmail || '',
      subject: emailResult?.subject || `Quote ${quote.quote_number} accepted`,
      bodyHtml: emailResult?.html || '',
      amount: total,
      total,
      deposit: quote.deposit || 0,
      balance: 0,
      pdfGenerator: 'acceptance',
      pdfArgs,
      sourceQuoteId: quote.id,
    }),
  );

  // Internal notification to the office.
  await safe('internal notification', () =>
    send({
      to: COMPANY_EMAIL,
      subject: `✅ Quote ${quote.quote_number} accepted by ${quote.job.full_name}`,
      html: `
        <p><strong>${quote.job.full_name}</strong> has accepted quote <strong>${quote.quote_number}</strong> online.</p>
        <ul>
          <li>Accepted total: <strong>£${total.toFixed(2)}</strong></li>
          <li>Declared item value (insurance): <strong>£${declaredValue.toFixed(2)}</strong></li>
          <li>Optional services selected: ${selectedOptionalIds.length}</li>
        </ul>
        <p>Next step: send the deposit invoice from the CRM. The signed acceptance form is attached.</p>`,
      attachments: attachment,
    }),
  );

  res.json({ ok: true, total });
}));

// ─── GET: download the acceptance form PDF (after accepting) ──────────────────
router.get('/quotes/:token/acceptance-pdf', wrap(async (req, res) => {
  const quote = await findQuoteByToken(req.params.token);
  if (!quote || quote.status !== 'accepted') {
    return res.status(404).json({ error: 'No acceptance form is available for this quote yet.' });
  }

  const acceptedItems = quote.items.filter((i) => !i.is_optional || i.accepted);
  const pdfArgs = buildAcceptancePdfArgs(
    quote.job, quote, acceptedItems, quote.declared_value, quote.accepted_at,
  );
  const pdf = await generateAcceptancePDF(pdfArgs);

  res.setHeader('Content-Type', pdf.mimeType);
  res.setHeader('Content-Disposition', `inline; filename="${pdf.filename}"`);
  res.setHeader('Content-Length', pdf.buffer.length);
  res.send(pdf.buffer);
}));

module.exports = router;
