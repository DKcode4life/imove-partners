const prisma = require('../../db/prisma');
const emailService = require('../../services/email');
const pdfService = require('../../services/pdf');

module.exports = async function sendInvoiceEmail({ invoice_id }) {
  const invoice = await prisma.invoice.findUnique({
    where: { id: invoice_id },
    include: { items: true, job: true },
  });

  if (!invoice) throw new Error(`Invoice ${invoice_id} not found`);
  if (!invoice.job.email) throw new Error(`No email address for job ${invoice.job_id}`);

  const pdf = await pdfService.generateInvoicePDF({
    invoice_number: invoice.invoice_number,
    customer_name: invoice.job.full_name,
    items: invoice.items,
    subtotal: invoice.subtotal,
    tax_amount: invoice.tax_amount,
    total: invoice.total,
    due_date: invoice.due_date,
    notes: invoice.notes,
  });

  await emailService.sendTemplated({
    to: invoice.job.email,
    templateSlug: 'invoice-sent',
    variables: {
      job_id: invoice.job_id,
      customer_name: invoice.job.full_name,
      invoice_number: invoice.invoice_number,
      invoice_total: `£${invoice.total.toFixed(2)}`,
      due_date: invoice.due_date || 'On receipt',
    },
  });

  await prisma.invoice.update({
    where: { id: invoice_id },
    data: { status: 'sent', sent_at: new Date() },
  });

  console.log(`[job] Invoice ${invoice.invoice_number} email sent to ${invoice.job.email}`);
};
