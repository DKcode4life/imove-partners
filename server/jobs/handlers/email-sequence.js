const prisma = require('../../db/prisma');
const emailService = require('../../services/email');

module.exports = async function emailSequence({ sequence_id, job_id, current_step = 0 }) {
  const sequence = await prisma.emailSequence.findUnique({
    where: { id: sequence_id },
    include: { steps: { orderBy: { step_order: 'asc' }, include: { template: true } } },
  });

  if (!sequence || !sequence.active) return;
  if (current_step >= sequence.steps.length) return;

  const step = sequence.steps[current_step];
  const job = await prisma.crmJob.findUnique({ where: { id: job_id } });
  if (!job || !job.email) return;

  const subject = step.subject_override || step.template?.subject || 'Update from iMove';
  const html = step.body_override || step.template?.body_html || '';

  const variables = {
    customer_name: job.full_name,
    job_id: job.id,
    status: job.status,
  };

  let renderedSubject = subject;
  let renderedHtml = html;
  for (const [key, value] of Object.entries(variables)) {
    const re = new RegExp(`{{\\s*${key}\\s*}}`, 'g');
    renderedSubject = renderedSubject.replace(re, String(value));
    renderedHtml = renderedHtml.replace(re, String(value));
  }

  await emailService.send({ to: job.email, subject: renderedSubject, html: renderedHtml });

  await prisma.emailLog.create({
    data: {
      job_id,
      to_email: job.email,
      subject: renderedSubject,
      template_id: step.template_id,
      status: 'sent',
      sent_at: new Date(),
    },
  });

  const nextStep = current_step + 1;
  if (nextStep < sequence.steps.length) {
    const nextDelay = sequence.steps[nextStep].delay_hours || 0;
    const { enqueue } = require('../runner');
    await enqueue('email-sequence', {
      sequence_id,
      job_id,
      current_step: nextStep,
    }, {
      scheduledFor: new Date(Date.now() + nextDelay * 3600000),
    });
  }

  console.log(`[job] Email sequence ${sequence.name} step ${current_step + 1} sent for job ${job_id}`);
};
