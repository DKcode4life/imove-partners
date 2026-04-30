const express = require('express');
const prisma = require('../db/prisma');
const { authenticate, requireAdmin } = require('../middleware/auth');
const wrap = require('../lib/async-handler');
const { generateQuotePDF } = require('../services/pdf');
const { sendTemplated } = require('../services/email');

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
    quote_number,
    notes,
    subtotal,
    tax_amount,
    total,
    deposit,
    valid_until,
    items = [],
  } = req.body;

  // Validate required fields
  if (!quote_number) {
    return res.status(400).json({ error: 'Quote number is required' });
  }

  if (!items || items.length === 0) {
    return res.status(400).json({ error: 'At least one line item is required' });
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

    // Create quote
    const quote = await prisma.quote.create({
      data: {
        job_id: jobId,
        quote_type,
        quote_number,
        notes: notes || null,
        subtotal: parseFloat(subtotal) || 0,
        tax_amount: parseFloat(tax_amount) || 0,
        total: parseFloat(total) || 0,
        deposit: parseFloat(deposit) || 0,
        valid_until: valid_until || null,
        created_by: req.user.id,
        items: {
          create: items.map(item => ({
            description: item.description || '',
            quantity: parseFloat(item.quantity) || 1,
            unit_price: parseFloat(item.unit_price) || 0,
            total: parseFloat(item.total) || 0,
            notes: item.notes || null,
          })),
        },
      },
      include: {
        items: true,
      },
    });

    // Log activity
    await prisma.crmActivity.create({
      data: {
        job_id: jobId,
        type: 'note',
        note: `Created ${quote_type === 'fixed' ? 'fixed' : 'estimate'} quote ${quote_number} for £${total.toFixed(2)}`,
      },
    });

    res.status(201).json(quote);
  } catch (error) {
    console.error('[Quote] Error creating quote:', error);
    res.status(500).json({ error: 'Failed to create quote' });
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
    const pdfData = {
      quote_number: quote.quote_number,
      quote_type: quote.quote_type,
      customer_name: quote.job.full_name,
      customer_email: quote.job.email,
      customer_phone: quote.job.phone,
      from_address: quote.job.from_line1 
        ? `${quote.job.from_line1}, ${quote.job.from_city || ''} ${quote.job.from_postcode || ''}`.trim()
        : null,
      to_address: quote.job.to_line1
        ? `${quote.job.to_line1}, ${quote.job.to_city || ''} ${quote.job.to_postcode || ''}`.trim()
        : null,
      move_date: quote.job.confirmed_move_date || quote.job.preferred_move_date,
      items: quote.items.map(item => ({
        description: item.description,
        quantity: item.quantity,
        unit_price: item.unit_price,
        total: item.total,
      })),
      subtotal: quote.subtotal,
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
          ? `${job.from_line1}, ${job.from_city || ''} ${job.from_postcode || ''}`.trim()
          : null,
        to_address: job.to_line1
          ? `${job.to_line1}, ${job.to_city || ''} ${job.to_postcode || ''}`.trim()
          : null,
        move_date: job.confirmed_move_date || job.preferred_move_date,
        items: quote.items.map(item => ({
          description: item.description,
          quantity: item.quantity,
          unit_price: item.unit_price,
          total: item.total,
        })),
        subtotal: quote.subtotal,
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
      quote_type: quote.quote_type === 'fixed' ? 'Fixed Quote' : 'Estimate Quote',
      quote_amount: `£${quote.total.toFixed(2)}`,
      valid_until: quote.valid_until || '30 days',
      move_date: job.confirmed_move_date || job.preferred_move_date || 'To be confirmed',
      from_address: job.from_line1 || 'To be confirmed',
      to_address: job.to_line1 || 'To be confirmed',
    };

    // Send email
    const emailResult = await sendTemplated({
      to,
      templateSlug: 'quote-sent',
      variables,
      attachments: pdfAttachment ? [pdfAttachment] : [],
    });

    // Update job status and quote sent date
    await prisma.crmJob.update({
      where: { id: jobId },
      data: {
        status: 'Quote Sent',
        quote_sent_date: new Date(),
        quote_amount: quote.total,
      },
    });

    // Update quote sent status
    await prisma.quote.update({
      where: { id: quoteId },
      data: {
        sent_at: new Date(),
        sent_to: to,
      },
    });

    // Log activity
    await prisma.crmActivity.create({
      data: {
        job_id: jobId,
        type: 'note',
        note: `Quote ${quote.quote_number} emailed to ${to}`,
      },
    });

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
    res.status(500).json({ error: 'Failed to send quote email' });
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