const config = require('../config');
const { Resend } = require('resend');

// Only create Resend instance if API key is provided
let resend = null;
if (config.email.resendApiKey && config.email.resendApiKey.trim()) {
  resend = new Resend(config.email.resendApiKey);
}

async function send({ to, subject, html, from, attachments = [] }) {
  const provider = config.email.provider;

  if (provider === 'smtp') {
    return sendViaSMTP({ to, subject, html, from, attachments });
  }

  if (provider === 'resend') {
    return sendViaResend({ to, subject, html, from, attachments });
  }

  console.log(`[email] No provider configured. Would send to ${to}: "${subject}"`);
  return { provider: 'none', to, subject, status: 'skipped' };
}

async function sendViaSMTP({ to, subject, html, from, attachments }) {
  try {
    const nodemailer = require('nodemailer');
    const transport = nodemailer.createTransport({
      host: config.email.smtp.host,
      port: config.email.smtp.port,
      secure: config.email.smtp.secure,
      auth: { user: config.email.smtp.user, pass: config.email.smtp.pass },
    });
    
    const mailOptions = {
      from: from || config.email.from,
      to,
      subject,
      html,
    };

    if (attachments && attachments.length > 0) {
      mailOptions.attachments = attachments.map(att => ({
        filename: att.filename,
        content: att.content,
        contentType: att.contentType,
      }));
    }

    const info = await transport.sendMail(mailOptions);
    return { provider: 'smtp', to, subject, status: 'sent', messageId: info.messageId };
  } catch (error) {
    console.error('[email] SMTP error:', error.message);
    throw new Error(`SMTP failed: ${error.message}`);
  }
}

async function sendViaResend({ to, subject, html, from, attachments }) {
  try {
    if (!resend) {
      console.warn('[email] Resend not configured. Would send to:', to, 'subject:', subject);
      return { provider: 'resend', to, subject, status: 'skipped' };
    }

    const emailData = {
      from: from || config.email.from,
      to,
      subject,
      html,
    };

    if (attachments && attachments.length > 0) {
      emailData.attachments = attachments.map(att => ({
        filename: att.filename,
        content: att.content.toString('base64'),
      }));
    }

    const { data, error } = await resend.emails.send(emailData);

    if (error) {
      console.error('[email] Resend error:', error);
      throw new Error(`Resend failed: ${error.message}`);
    }

    return { provider: 'resend', to, subject, status: 'sent', messageId: data.id };
  } catch (error) {
    console.error('[email] Failed to send via Resend:', error);
    throw error;
  }
}

/**
 * Send an email using either a stored template OR a direct subject/body override.
 * If subjectOverride / bodyOverride are provided, they are used INSTEAD of the
 * template's stored content (after variable substitution). The template is still
 * looked up so we can log against template_id and use it as a fallback.
 *
 * @param {Object} opts
 * @param {string} opts.to               recipient
 * @param {string} opts.templateSlug     slug to load from EmailTemplate table
 * @param {Object} [opts.variables]      key/value map for {{placeholders}}
 * @param {string} [opts.subjectOverride] custom subject (skips template subject)
 * @param {string} [opts.bodyOverride]    custom body HTML (skips template body)
 * @param {Array}  [opts.attachments]
 */
async function sendTemplated({ to, templateSlug, variables, subjectOverride, bodyOverride, attachments = [] }) {
  const prisma = require('../db/prisma');
  const template = await prisma.emailTemplate.findUnique({ where: { slug: templateSlug } });
  if (!template && (!subjectOverride || !bodyOverride)) {
    throw new Error(`Email template "${templateSlug}" not found and no override provided`);
  }

  let subject = subjectOverride || template.subject;
  let html = bodyOverride || template.body_html;

  // Variable substitution {{placeholder}} → value
  for (const [key, value] of Object.entries(variables || {})) {
    const placeholder = new RegExp(`{{\\s*${key}\\s*}}`, 'g');
    subject = subject.replace(placeholder, String(value ?? ''));
    html = html.replace(placeholder, String(value ?? ''));
  }

  const result = await send({ to, subject, html, attachments });

  // Log to EmailLog (only fields that actually exist in the schema)
  try {
    await prisma.emailLog.create({
      data: {
        to_email: to,
        subject,
        template_id: template?.id || null,
        job_id: variables?.job_id || null,
        status: result.status === 'skipped' ? 'queued' : 'sent',
        sent_at: result.status === 'skipped' ? null : new Date(),
      },
    });
  } catch (logErr) {
    console.error('[email] Failed to write EmailLog:', logErr.message);
    // don't throw — the email itself was sent
  }

  return result;
}

module.exports = { send, sendTemplated };
