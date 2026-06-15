/**
 * Sent-to-Clients history (read-only).
 *
 * Surfaces the immutable `SentDocument` snapshots written on every client send
 * (see server/lib/sent-document.js). Powers the history list under the six
 * "Send to Client" buttons:
 *   - list   → rows with title/description/amounts (no heavy body/pdf payload)
 *   - body   → the exact rendered email that was sent (for the View Email modal)
 *   - pdf    → regenerates the byte-identical PDF from the frozen args
 */
const express = require('express');
const prisma = require('../db/prisma');
const { authenticate, requireAdmin } = require('../middleware/auth');
const wrap = require('../lib/async-handler');
const { generateQuotePDF, generateInvoicePDF, generateAcceptancePDF } = require('../services/pdf');

const router = express.Router();
router.use(authenticate, requireAdmin);

// ─── GET: list every document sent for a job ─────────────────────────────
router.get('/jobs/:id/sent-documents', wrap(async (req, res) => {
  const jobId = parseInt(req.params.id);
  if (isNaN(jobId)) return res.status(400).json({ error: 'Invalid job ID' });

  const docs = await prisma.sentDocument.findMany({
    where: { job_id: jobId },
    orderBy: { sent_at: 'desc' },
    select: {
      id: true,
      doc_type: true,
      reference: true,
      version: true,
      title: true,
      description: true,
      to_email: true,
      subject: true,
      amount: true,
      total: true,
      deposit: true,
      balance: true,
      sent_at: true,
    },
  });

  res.json(docs);
}));

// ─── GET: the exact email body that was sent ─────────────────────────────
router.get('/jobs/:id/sent-documents/:sentId/body', wrap(async (req, res) => {
  const jobId = parseInt(req.params.id);
  const sentId = parseInt(req.params.sentId);
  if (isNaN(jobId) || isNaN(sentId)) return res.status(400).json({ error: 'Invalid IDs' });

  const doc = await prisma.sentDocument.findFirst({
    where: { id: sentId, job_id: jobId },
    select: { subject: true, body_html: true, to_email: true, sent_at: true, title: true },
  });
  if (!doc) return res.status(404).json({ error: 'Sent document not found' });

  res.json(doc);
}));

// ─── GET: regenerate the byte-identical PDF from the frozen snapshot ──────
router.get('/jobs/:id/sent-documents/:sentId/pdf', wrap(async (req, res) => {
  const jobId = parseInt(req.params.id);
  const sentId = parseInt(req.params.sentId);
  if (isNaN(jobId) || isNaN(sentId)) return res.status(400).json({ error: 'Invalid IDs' });

  const doc = await prisma.sentDocument.findFirst({
    where: { id: sentId, job_id: jobId },
    select: { pdf_generator: true, pdf_args: true, reference: true },
  });
  if (!doc) return res.status(404).json({ error: 'Sent document not found' });

  // pdf_args is a Json column — already an object when read back.
  const args = typeof doc.pdf_args === 'string' ? JSON.parse(doc.pdf_args) : doc.pdf_args;

  try {
    const generators = {
      quote:      generateQuotePDF,
      acceptance: generateAcceptancePDF,
      invoice:    generateInvoicePDF,
    };
    const generate = generators[doc.pdf_generator] || generateInvoicePDF;
    const pdf = await generate(args);

    res.setHeader('Content-Type', pdf.mimeType);
    res.setHeader('Content-Disposition', `inline; filename="${pdf.filename}"`);
    res.setHeader('Content-Length', pdf.buffer.length);
    res.send(pdf.buffer);
  } catch (err) {
    console.error('[SentDocument PDF] Error regenerating PDF:', err);
    res.status(500).json({ error: 'Failed to generate PDF' });
  }
}));

module.exports = router;
