const express = require('express');
const prisma = require('../db/prisma');
const { authenticate, requireAdmin } = require('../middleware/auth');
const wrap = require('../lib/async-handler');
const { generateQuotePDF } = require('../services/pdf');
const { sendTemplated } = require('../services/email');
const { nextReferenceNumberWithRetry } = require('../lib/reference-numbers');

const router = express.Router();
router.use(authenticate, requireAdmin);

/**
 * GET /api/crm/jobs/:id/quotes
 * 
 * Get all quotes for a job
 */
router.get('/jobs/:id/quotes', wrap(async (req, res) => {
  const jobId = parseInt(req.params.id);
  if (isNaN(jobId)) {
    return res.status(400).json({ error: 'Invalid job ID' });
  }

  const quotes = await prisma.quote.findMany({
    where: { job_id: jobId },
    include: {
      items: true,
    },
    orderBy: { created_at: 'desc' },
  });

  res.json(quotes);
}));

/**
 * POST /api/crm/jobs/:id/quotes
 * 
 * Create a new quote for a job
 */
router.post('/jobs/:id/quotes', wrap(async (req, res) => {
  const jobId = parseInt(req.params.id);
  if (isNaN(jobId)) {
    return res.status(400).json({ error: 'Invalid job ID' });
  }

  const {
    quote_type = 'estimate',
    notes,
    subtotal,
    tax_rate,
    tax_amount,
    total,
    deposit,
    valid_until,
    items = [],
  } = req.body;

  // NOTE: We deliberately ignore any client-supplied `quote_number` — the
  // reference number is *always* generated server-side via the shared
  // numbering helper so it stays consistent (EST-##### or iMQ-#####) and
  // can never drift out of sync with what's saved on the row.

  if (!items || items.length === 0) {
    return res.status(400).json({ error: 'At least one line item is required' });
  }

  if (!['estimate', 'fixed'].includes(quote_type)) {
    return res.status(400).json({ error: "quote_type must be 'estimate' or 'fixed'" });
  }

  try {
    // Check if job exists
    const job = await prisma.crmJob.findUnique({
      where: { id: jobId },
      include: { customer: true },
    });

    if (!job) {
      return res.status(404).json({ error: 'Job not found' });
    }

    // Generate the reference number + create the quote in one shot, retrying
    // on the unlikely event of a unique-constraint collision under concurrency.
    const refType = quote_type === 'fixed' ? 'fixed' : 'estimate';
    const quote = await nextReferenceNumberWithRetry(prisma, refType, (quote_number) =>
      prisma.quote.create({
        data: {
          job_id: jobId,
          quote_type,
          quote_number,
          notes: notes || null,
          subtotal: parseFloat(subtotal) || 0,
          tax_rate: tax_rate != null ? parseFloat(tax_rate) : 20,
          tax_amount: parseFloat(tax_amount) || 0,
          total: parseFloat(total) || 0,
          deposit: parseFloat(deposit) || 0,
          valid_until: valid_until || null,
          items: {
            create: items.map((item, idx) => ({
              description: item.description || '',
              quantity: parseFloat(item.quantity) || 1,
              unit_price: parseFloat(item.unit_price) || 0,
              total: parseFloat(item.total) || 0,
              sort_order: idx,
              is_optional: item.is_optional || false,
            })),
          },
        },
        include: {
          items: true,
        },
      }),
    );

    // Log activity
    await prisma.crmActivity.create({
      data: {
        job_id: jobId,
        type: 'note',
        note: `Created ${quote_type === 'fixed' ? 'fixed' : 'estimate'} quote ${quote.quote_number} for £${(parseFloat(total) || 0).toFixed(2)}`,
      },
    });

    res.status(201).json(quote);
  } catch (error) {
    console.error('[Quote] Error creating quote:', error);
    res.status(500).json({ error: 'Failed to create quote' });
  }
}));

/**
 * PATCH /api/crm/jobs/:id/quotes/:quoteId/financials
 *
 * Update the financial fields (subtotal, tax_rate, tax_amount, total, deposit)
 * of an existing quote without changing its quote_number. If `items` is
 * provided, the existing line items are replaced with the new set (used so
 * mandatory/selected/optional addon changes flow through to a re-sent PDF).
 */
router.patch('/jobs/:id/quotes/:quoteId/financials', wrap(async (req, res) => {
  const jobId   = parseInt(req.params.id);
  const quoteId = parseInt(req.params.quoteId);
  if (isNaN(jobId) || isNaN(quoteId)) {
    return res.status(400).json({ error: 'Invalid job ID or quote ID' });
  }

  const { subtotal, tax_rate, tax_amount, total, deposit, items } = req.body;

  try {
    const quote = await prisma.quote.findFirst({ where: { id: quoteId, job_id: jobId } });
    if (!quote) return res.status(404).json({ error: 'Quote not found' });

    const updated = await prisma.$transaction(async (tx) => {
      if (Array.isArray(items)) {
        await tx.quoteItem.deleteMany({ where: { quote_id: quoteId } });
        if (items.length > 0) {
          await tx.quoteItem.createMany({
            data: items.map((item, idx) => ({
              quote_id: quoteId,
              description: item.description || '',
              quantity: parseFloat(item.quantity) || 1,
              unit_price: parseFloat(item.unit_price) || 0,
              total: parseFloat(item.total) || 0,
              sort_order: idx,
              is_optional: item.is_optional || false,
            })),
          });
        }
      }

      return tx.quote.update({
        where: { id: quoteId },
        data: {
          subtotal:   subtotal   != null ? parseFloat(subtotal)   : quote.subtotal,
          tax_rate:   tax_rate   != null ? parseFloat(tax_rate)   : quote.tax_rate,
          tax_amount: tax_amount != null ? parseFloat(tax_amount) : quote.tax_amount,
          total:      total      != null ? parseFloat(total)      : quote.total,
          deposit:    deposit    != null ? parseFloat(deposit)    : quote.deposit,
        },
      });
    });

    res.json({ ok: true, id: updated.id, total: updated.total });
  } catch (error) {
    console.error('[Quote] Error updating quote financials:', error);
    res.status(500).json({ error: 'Failed to update quote' });
  }
}));

/**
 * GET /api/crm/jobs/:id/quotes/:quoteId/pdf
 *
 * Generate PDF for a quote
 */
router.get('/jobs/:id/quotes/:quoteId/pdf', wrap(async (req, res) => {
  const jobId = parseInt(req.params.id);
  const quoteId = parseInt(req.params.quoteId);
  
  if (isNaN(jobId) || isNaN(quoteId)) {
    return res.status(400).json({ error: 'Invalid job ID or quote ID' });
  }

  try {
    const quote = await prisma.quote.findFirst({
      where: { id: quoteId, job_id: jobId },
      include: {
        items: true,
        job: {
          include: { customer: true },
        },
      },
    });

    if (!quote) {
      return res.status(404).json({ error: 'Quote not found' });
    }

    // Prepare data for PDF generation
    const j = quote.job;
    const pdfData = {
      quote_number: quote.quote_number,
      quote_type: quote.quote_type,
      customer_name: j.full_name,
      customer_email: j.email,
      customer_phone: j.phone,
      from_address: j.from_line1
        ? `${j.from_line1}${j.from_line2 ? ', ' + j.from_line2 : ''}, ${j.from_city || ''} ${j.from_postcode || ''}`.trim()
        : null,
      to_address: j.to_line1
        ? `${j.to_line1}${j.to_line2 ? ', ' + j.to_line2 : ''}, ${j.to_city || ''} ${j.to_postcode || ''}`.trim()
        : null,
      // Pass property fields so the PDF builder can assemble "Property details" lines
      property_type_from: j.property_type_from,
      property_type_to: j.property_type_to,
      bedrooms: j.bedrooms,
      bedrooms_to: j.bedrooms_to,
      floor_from: j.floor_from,
      floor_to: j.floor_to,
      has_lift_from: j.has_lift_from,
      has_lift_to: j.has_lift_to,
      move_date: j.confirmed_move_date || j.preferred_move_date,
      items: quote.items.map(item => ({
        description: item.description,
        quantity: item.quantity,
        unit_price: item.unit_price,
        total: item.total,
      })),
      subtotal: quote.subtotal,
      tax_rate: quote.tax_rate,
      tax_amount: quote.tax_amount,
      total: quote.total,
      deposit: quote.deposit,
      notes: quote.notes,
      valid_until: quote.valid_until,
    };

    const pdf = await generateQuotePDF(pdfData);

    // Set response headers
    res.setHeader('Content-Type', pdf.mimeType);
    res.setHeader('Content-Disposition', `inline; filename="${pdf.filename}"`);
    res.setHeader('Content-Length', pdf.buffer.length);

    res.send(pdf.buffer);
  } catch (error) {
    console.error('[Quote PDF] Error generating PDF:', error);
    res.status(500).json({ error: 'Failed to generate PDF' });
  }
}));

/**
 * POST /api/crm/jobs/:id/quotes/:quoteId/send-email
 * 
 * Send quote via email to client
 */
router.post('/jobs/:id/quotes/:quoteId/send-email', wrap(async (req, res) => {
  const jobId = parseInt(req.params.id);
  const quoteId = parseInt(req.params.quoteId);
  
  if (isNaN(jobId) || isNaN(quoteId)) {
    return res.status(400).json({ error: 'Invalid job ID or quote ID' });
  }

  const {
    to,
    cc = [],
    bcc = [],
    subject,
    body_html,
    attach_pdf = true,
  } = req.body;

  if (!to) {
    return res.status(400).json({ error: 'Recipient email (to) is required' });
  }

  try {
    // Get quote and job details
    const quote = await prisma.quote.findFirst({
      where: { id: quoteId, job_id: jobId },
      include: {
        items: true,
        job: true,
      },
    });

    if (!quote) {
      return res.status(404).json({ error: 'Quote not found' });
    }

    const job = quote.job;

    // Generate PDF if requested
    let pdfAttachment = null;
    if (attach_pdf) {
      const pdfData = {
        quote_number: quote.quote_number,
        quote_type: quote.quote_type,
        customer_name: job.full_name,
        customer_email: job.email,
        customer_phone: job.phone,
        from_address: job.from_line1
          ? `${job.from_line1}${job.from_line2 ? ', ' + job.from_line2 : ''}, ${job.from_city || ''} ${job.from_postcode || ''}`.trim()
          : null,
        to_address: job.to_line1
          ? `${job.to_line1}${job.to_line2 ? ', ' + job.to_line2 : ''}, ${job.to_city || ''} ${job.to_postcode || ''}`.trim()
          : null,
        // Property fields for "Property details" lines
        property_type_from: job.property_type_from,
        property_type_to: job.property_type_to,
        bedrooms: job.bedrooms,
        bedrooms_to: job.bedrooms_to,
        floor_from: job.floor_from,
        floor_to: job.floor_to,
        has_lift_from: job.has_lift_from,
        has_lift_to: job.has_lift_to,
        move_date: job.confirmed_move_date || job.preferred_move_date,
        items: quote.items.filter(item => !item.is_optional).map(item => ({
          description: item.description,
          quantity: item.quantity,
          unit_price: item.unit_price,
          total: item.total,
        })),
        optional_items: quote.items.filter(item => item.is_optional).map(item => ({
          description: item.description,
          quantity: item.quantity,
          unit_price: item.unit_price,
          total: item.total,
        })),
        subtotal: quote.subtotal,
        tax_rate: quote.tax_rate,
        tax_amount: quote.tax_amount,
        total: quote.total,
        deposit: quote.deposit,
        notes: quote.notes,
        valid_until: quote.valid_until,
      };

      const pdf = await generateQuotePDF(pdfData);
      pdfAttachment = {
        filename: pdf.filename,
        content: pdf.buffer,
        contentType: pdf.mimeType,
      };
    }

    // Prepare email variables
    const variables = {
      job_id: jobId,
      customer_name: job.full_name,
      quote_number: quote.quote_number,
      amount: quote.total.toFixed(2),
      deposit: quote.deposit ? quote.deposit.toFixed(2) : '0.00',
      valid_until: quote.valid_until || 'within 30 days',
      move_date: job.confirmed_move_date || job.preferred_move_date || 'to be confirmed',
      from_address: job.from_line1 || 'TBC',
      to_address: job.to_line1 || 'TBC',
    };

    // Pick the right template based on quote type
    const templateSlug = quote.quote_type === 'fixed' ? 'fixed-quote' : 'estimate-quote';

    // Send email — pass user's edited subject/body from the modal as overrides
    // NOTE: From this point on, any failure in the DB bookkeeping below MUST NOT
    // cause this endpoint to return 5xx — otherwise the client shows
    // "Failed to send email" even though the message has already gone out.
    const emailResult = await sendTemplated({
      to,
      templateSlug,
      variables,
      subjectOverride: subject || undefined,
      bodyOverride: body_html || undefined,
      attachments: pdfAttachment ? [pdfAttachment] : [],
    });

    // Best-effort post-send bookkeeping. Each step is wrapped individually so
    // a single failure (e.g. schema drift, concurrent edit) doesn't mask a
    // successful send.
    const safeUpdate = async (label, fn) => {
      try { await fn(); }
      catch (bookkeepErr) { console.error(`[Quote Email] post-send ${label} failed:`, bookkeepErr.message); }
    };

    await safeUpdate('job status', () => prisma.crmJob.update({
      where: { id: jobId },
      data: {
        status: quote.quote_type === 'estimate' ? 'Estimate Sent' : 'Quote Sent',
        // quote_sent_date is a String column in the schema — store ISO date string
        quote_sent_date: new Date().toISOString().slice(0, 10),
        quote_amount: quote.total,
      },
    }));

    await safeUpdate('quote sent flag', () => prisma.quote.update({
      where: { id: quoteId },
      data: { sent_at: new Date(), sent_to: to },
    }));

    await safeUpdate('activity log', () => prisma.crmActivity.create({
      data: {
        job_id: jobId,
        type: 'note',
        note: `Quote ${quote.quote_number} emailed to ${to}`,
      },
    }));

    res.json({
      success: true,
      message: 'Quote emailed successfully',
      email: emailResult,
      quote: {
        id: quote.id,
        quote_number: quote.quote_number,
        sent_at: new Date(),
        sent_to: to,
      },
    });
  } catch (error) {
    console.error('[Quote Email] Error sending email:', error);
    res.status(500).json({ error: error?.message || 'Failed to send quote email' });
  }
}));

/**
 * DELETE /api/crm/jobs/:id/quotes/:quoteId
 * 
 * Delete a quote
 */
router.delete('/jobs/:id/quotes/:quoteId', wrap(async (req, res) => {
  const jobId = parseInt(req.params.id);
  const quoteId = parseInt(req.params.quoteId);
  
  if (isNaN(jobId) || isNaN(quoteId)) {
    return res.status(400).json({ error: 'Invalid job ID or quote ID' });
  }

  try {
    const quote = await prisma.quote.findFirst({
      where: { id: quoteId, job_id: jobId },
    });

    if (!quote) {
      return res.status(404).json({ error: 'Quote not found' });
    }

    // Delete quote items first (cascade)
    await prisma.quoteItem.deleteMany({
      where: { quote_id: quoteId },
    });

    // Delete quote
    await prisma.quote.delete({
      where: { id: quoteId },
    });

    // Log activity
    await prisma.crmActivity.create({
      data: {
        job_id: jobId,
        type: 'note',
        note: `Deleted quote ${quote.quote_number}`,
      },
    });

    res.json({ success: true, message: 'Quote deleted' });
  } catch (error) {
    console.error('[Quote] Error deleting quote:', error);
    res.status(500).json({ error: 'Failed to delete quote' });
  }
}));

module.exports = router;