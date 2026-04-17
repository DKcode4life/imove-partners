const config = require('../config');

// TODO: Install a provider package when ready:
//   SMTP    → npm install nodemailer
//   Resend  → npm install resend

async function send({ to, subject, html, from }) {
  const provider = config.email.provider;

  if (provider === 'smtp') {
    return sendViaSMTP({ to, subject, html, from });
  }

  if (provider === 'resend') {
    return sendViaResend({ to, subject, html, from });
  }

  console.log(`[email] No provider configured. Would send to ${to}: "${subject}"`);
  return { provider: 'none', to, subject, status: 'skipped' };
}

async function sendViaSMTP({ to, subject, html, from }) {
  // const nodemailer = require('nodemailer');
  // const transport = nodemailer.createTransport({
  //   host: config.email.smtp.host,
  //   port: config.email.smtp.port,
  //   auth: { user: config.email.smtp.user, pass: config.email.smtp.pass },
  // });
  // return transport.sendMail({
  //   from: from || config.email.from,
  //   to,
  //   subject,
  //   html,
  // });
  throw new Error('SMTP provider not yet implemented — install nodemailer and uncomment');
}

async function sendViaResend({ to, subject, html, from }) {
  // const { Resend } = require('resend');
  // const resend = new Resend(config.email.resendApiKey);
  // return resend.emails.send({
  //   from: from || config.email.from,
  //   to,
  //   subject,
  //   html,
  // });
  throw new Error('Resend provider not yet implemented — install resend and uncomment');
}

async function sendTemplated({ to, templateSlug, variables }) {
  const prisma = require('../db/prisma');
  const template = await prisma.emailTemplate.findUnique({ where: { slug: templateSlug } });
  if (!template) throw new Error(`Email template "${templateSlug}" not found`);

  let subject = template.subject;
  let html = template.body_html;

  for (const [key, value] of Object.entries(variables || {})) {
    const placeholder = new RegExp(`{{\\s*${key}\\s*}}`, 'g');
    subject = subject.replace(placeholder, String(value));
    html = html.replace(placeholder, String(value));
  }

  const result = await send({ to, subject, html });

  await prisma.emailLog.create({
    data: {
      to_email: to,
      subject,
      template_id: template.id,
      job_id: variables?.job_id || null,
      status: result.status === 'skipped' ? 'queued' : 'sent',
      sent_at: result.status === 'skipped' ? null : new Date(),
    },
  });

  return result;
}

module.exports = { send, sendTemplated };
