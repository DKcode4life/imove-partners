const prisma = require('../../db/prisma');
const emailService = require('../../services/email');
const pdfService = require('../../services/pdf');

module.exports = async function sendQuoteEmail({ quote_id }) {
  const quote = await prisma.quote.findUnique({
    where: { id: quote_id },
    include: { items: true, job: true },
  });

  if (!quote) throw new Error(`Quote ${quote_id} not found`);
  if (!quote.job.email) throw new Error(`No email address for job ${quote.job_id}`);

  const pdf = await pdfService.generateQuotePDF({
    quote_number: quote.quote_number,
    customer_name: quote.job.full_name,
    items: quote.items,
    subtotal: quote.subtotal,
    tax_amount: quote.tax_amount,
    total: quote.total,
    valid_until: quote.valid_until,
    notes: quote.notes,
  });

  await emailService.sendTemplated({
    to: quote.job.email,
    templateSlug: 'quote-sent',
    variables: {
      job_id: quote.job_id,
      customer_name: quote.job.full_name,
      quote_number: quote.quote_number,
      quote_total: `£${quote.total.toFixed(2)}`,
      valid_until: quote.valid_until || 'N/A',
    },
  });

  await prisma.quote.update({
    where: { id: quote_id },
    data: { status: 'sent', sent_at: new Date() },
  });

  console.log(`[job] Quote ${quote.quote_number} email sent to ${quote.job.email}`);
};
