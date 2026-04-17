const prisma = require('../../db/prisma');
const emailService = require('../../services/email');

module.exports = async function paymentReminder({ invoice_id }) {
  const invoice = await prisma.invoice.findUnique({
    where: { id: invoice_id },
    include: { job: true, payments: true },
  });

  if (!invoice) throw new Error(`Invoice ${invoice_id} not found`);
  if (invoice.status === 'paid' || invoice.status === 'cancelled') return;
  if (!invoice.job.email) throw new Error(`No email address for job ${invoice.job_id}`);

  const totalPaid = invoice.payments.reduce((s, p) => s + p.amount, 0);
  const outstanding = invoice.total - totalPaid;

  if (outstanding <= 0) {
    await prisma.invoice.update({
      where: { id: invoice_id },
      data: { status: 'paid', paid_at: new Date() },
    });
    return;
  }

  await emailService.sendTemplated({
    to: invoice.job.email,
    templateSlug: 'payment-reminder',
    variables: {
      job_id: invoice.job_id,
      customer_name: invoice.job.full_name,
      invoice_number: invoice.invoice_number,
      outstanding: `£${outstanding.toFixed(2)}`,
      due_date: invoice.due_date || 'Immediately',
    },
  });

  if (invoice.due_date && new Date(invoice.due_date) < new Date()) {
    await prisma.invoice.update({
      where: { id: invoice_id },
      data: { status: 'overdue' },
    });
  }

  console.log(`[job] Payment reminder sent for invoice ${invoice.invoice_number}`);
};
