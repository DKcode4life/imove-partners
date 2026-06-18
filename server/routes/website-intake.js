const express = require('express');
const prisma = require('../db/prisma');
const { authenticateApiKey, requireScope } = require('../middleware/apiKey');
const wrap = require('../lib/async-handler');
const { send: sendEmail } = require('../services/email');
const { syncSurveyEvent } = require('../lib/survey-event-sync');
const config = require('../config');

const router = express.Router();

// All website intake is API-key authenticated (server-to-server from the site).
// Never call this from the browser — the key must stay on the website's server.
router.use(authenticateApiKey, requireScope('crm:write'));

// Maps the website form identifier → CrmJob.lead_source. Each form gets its own
// source so the CRM can filter/report by where the enquiry came from. Unknown or
// missing form values fall back to a generic website source.
const FORM_SOURCES = {
  quote: 'Website — Get a Quote',
  contact: 'Website — Contact Us',
  callback: 'Website — Callback Request',
  survey: 'Website — Survey / Booking',
};
const DEFAULT_SOURCE = 'Website Enquiry';

// Survey bookings are split by type: a survey_type matching /video|zoom/ is a
// video survey, otherwise physical. Mirrors the CRM's own rule (crm.js) so the
// website path behaves identically to a survey booked inside the CRM.
const VIDEO_RE = /video|zoom/i;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Split a single free-text address into { line1, city, postcode }. */
function parseAddress(raw) {
  const parts = String(raw || '').split(',').map(s => s.trim()).filter(Boolean);
  if (parts.length === 0) return { line1: null, city: null, postcode: null };
  return {
    line1: parts[0] || null,
    city: parts.length > 2 ? parts[parts.length - 2] : (parts[1] || null),
    postcode: parts.length > 1 ? parts[parts.length - 1] : null,
  };
}

/** Find an existing customer by email, then by name; create one if neither hits. */
async function resolveCustomer({ full_name, email, phone, from }) {
  // NOTE: production runs on SQLite, which does NOT support Prisma's
  // `mode: 'insensitive'`. Match on the exact (trimmed) value instead.
  if (email) {
    const byEmail = await prisma.crmCustomer.findFirst({
      where: { email },
    });
    if (byEmail) return byEmail.id;
  }
  const byName = await prisma.crmCustomer.findFirst({
    where: { full_name },
  });
  if (byName) return byName.id;

  const created = await prisma.crmCustomer.create({
    data: {
      full_name,
      email: email || null,
      phone: phone || null,
      address_line1: from.line1,
      city: from.city,
      postcode: from.postcode,
    },
  });
  return created.id;
}

/** Notify the configured company inbox that a new website enquiry landed. */
async function notifyAdmin({ job, sourceLabel }) {
  const setting = await prisma.companySetting.findUnique({ where: { key: 'company_email' } });
  const adminEmail = setting?.value?.trim();
  if (!adminEmail) return;

  const crmLink = `${config.crmUrl}/admin/crm`;
  const row = (label, value) =>
    value ? `<tr><td style="padding:4px 0;color:#64748b;width:140px;">${label}</td><td style="padding:4px 0;">${value}</td></tr>` : '';

  const surveyLine = job.survey_type
    ? `${job.survey_type} survey${job.survey_date ? ` — ${job.survey_date}${job.survey_time ? ` at ${job.survey_time}` : ''}` : ''}`
    : '';

  const html = `
<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f8fafc;font-family:Arial,Helvetica,sans-serif;color:#1e293b;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f8fafc;padding:32px 16px;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden;border:1px solid #e2e8f0;max-width:600px;width:100%;">
        <tr>
          <td style="background:linear-gradient(135deg,#0891b2 0%,#0e7490 100%);padding:28px 40px;text-align:center;">
            <h1 style="margin:0;color:#ffffff;font-size:22px;font-weight:700;letter-spacing:-0.5px;">New Website Enquiry</h1>
            <p style="margin:8px 0 0;color:#cffafe;font-size:14px;">${sourceLabel}</p>
          </td>
        </tr>
        <tr>
          <td style="padding:32px 40px;">
            <p style="margin:0 0 20px;font-size:15px;">A new enquiry came in from the website.</p>
            <table width="100%" cellpadding="0" cellspacing="0" style="background:#f0f9ff;border:1px solid #bae6fd;border-radius:10px;margin:0 0 24px;">
              <tr><td style="padding:20px 24px;">
                <p style="margin:0 0 6px;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;color:#0369a1;">Enquiry Details</p>
                <table cellpadding="0" cellspacing="0" style="font-size:14px;color:#1e293b;width:100%;">
                  <tr><td style="padding:4px 0;color:#64748b;width:140px;">Name</td><td style="padding:4px 0;"><strong>${job.full_name}</strong></td></tr>
                  ${row('Email', job.email)}
                  ${row('Phone', job.phone)}
                  ${row('Survey', surveyLine)}
                  ${row('Moving from', [job.from_line1, job.from_city, job.from_postcode].filter(Boolean).join(', '))}
                  ${row('Moving to', [job.to_line1, job.to_city, job.to_postcode].filter(Boolean).join(', '))}
                  ${row('Estimated date', job.preferred_move_date)}
                  ${row('Property', job.bedrooms)}
                  ${row('Message', job.client_notes)}
                </table>
              </td></tr>
            </table>
            <table cellpadding="0" cellspacing="0" style="margin:0 auto;">
              <tr><td style="background:#0891b2;border-radius:8px;">
                <a href="${crmLink}" style="display:inline-block;padding:12px 28px;color:#ffffff;font-weight:700;font-size:14px;text-decoration:none;">Open in CRM →</a>
              </td></tr>
            </table>
          </td>
        </tr>
        <tr>
          <td style="background:#f8fafc;border-top:1px solid #e2e8f0;padding:20px 40px;text-align:center;">
            <p style="margin:0;font-size:12px;color:#94a3b8;">iMove Relocations Ltd · <a href="mailto:info@myimove.co.uk" style="color:#0891b2;text-decoration:none;">info@myimove.co.uk</a></p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`.trim();

  await sendEmail({
    to: adminEmail,
    subject: `New website enquiry (${sourceLabel}) — ${job.full_name}`,
    html,
  });
}

// POST /api/intake
// Public website forms → CrmCustomer + CrmJob + CrmActivity, tagged by source.
router.post('/', wrap(async (req, res) => {
  const {
    form,
    submission_id,
    full_name,
    email,
    phone,
    from_address,
    to_address,
    preferred_move_date,
    property_size,
    message,
    survey_type,
    survey_date,
    survey_time,
  } = req.body || {};

  // ─── Validation ──────────────────────────────────────────────────────────
  const name = typeof full_name === 'string' ? full_name.trim() : '';
  const cleanEmail = typeof email === 'string' ? email.trim() : '';
  const cleanPhone = typeof phone === 'string' ? phone.trim() : '';

  if (!name) {
    return res.status(400).json({ error: 'full_name is required' });
  }
  if (!cleanEmail && !cleanPhone) {
    return res.status(400).json({ error: 'Either email or phone is required' });
  }
  if (cleanEmail && !EMAIL_RE.test(cleanEmail)) {
    return res.status(400).json({ error: 'Invalid email address' });
  }

  // ─── Survey bookings ───────────────────────────────────────────────────────
  // A `survey` form carrying a type creates a *scheduled* survey: the job is
  // tagged video/physical, dropped into the matching pipeline stage, and (when a
  // real date came through) a Survey event is auto-created on the planner below.
  const isSurvey = form === 'survey' && typeof survey_type === 'string' && !!survey_type.trim();
  const isVideoSurvey = isSurvey && VIDEO_RE.test(survey_type);
  const surveyTypeLabel = isSurvey ? (isVideoSurvey ? 'Video' : 'Physical') : null;
  const cleanSurveyDate = typeof survey_date === 'string' && survey_date.trim() ? survey_date.trim() : null;
  const cleanSurveyTime = typeof survey_time === 'string' && survey_time.trim() ? survey_time.trim() : null;
  const hasValidSurveyDate = !!cleanSurveyDate && !isNaN(new Date(cleanSurveyDate).getTime());

  const sourceLabel = isSurvey ? `Survey — ${surveyTypeLabel}` : (FORM_SOURCES[form] || DEFAULT_SOURCE);
  const status = isSurvey ? (isVideoSurvey ? 'Survey Video' : 'Survey Physical') : 'New Lead';
  const activityNote = isSurvey
    ? `Submitted via website — ${surveyTypeLabel} survey${hasValidSurveyDate ? ` booked for ${cleanSurveyDate}${cleanSurveyTime ? ` at ${cleanSurveyTime}` : ''}` : ' (date to be confirmed)'}`
    : `Submitted via website — ${sourceLabel}`;

  // ─── Idempotency ─────────────────────────────────────────────────────────
  // If the website retries with the same submission_id, return the job we
  // already created instead of duplicating it.
  if (submission_id) {
    const prior = await prisma.webhookEvent.findFirst({
      where: {
        provider: 'website',
        status: 'processed',
        payload: { contains: `"submission_id":"${submission_id}"` },
      },
      orderBy: { created_at: 'desc' },
    });
    if (prior) {
      let jobId = null;
      try { jobId = JSON.parse(prior.payload)?._job_id ?? null; } catch { /* ignore */ }
      return res.status(200).json({ status: 'duplicate', job_id: jobId });
    }
  }

  const from = parseAddress(from_address);
  const to = parseAddress(to_address);

  try {
    const customerId = await resolveCustomer({ full_name: name, email: cleanEmail, phone: cleanPhone, from });

    const job = await prisma.crmJob.create({
      data: {
        customer_id: customerId,
        full_name: name,
        email: cleanEmail || null,
        phone: cleanPhone || null,
        client_notes: typeof message === 'string' && message.trim() ? message.trim() : null,
        lead_source: sourceLabel,
        status,
        from_line1: from.line1,
        from_city: from.city,
        from_postcode: from.postcode,
        to_line1: to.line1,
        to_city: to.city,
        to_postcode: to.postcode,
        bedrooms: typeof property_size === 'string' && property_size.trim() ? property_size.trim() : null,
        preferred_move_date: typeof preferred_move_date === 'string' && preferred_move_date.trim()
          ? preferred_move_date.trim()
          : null,
        survey_required: isSurvey || undefined,
        survey_type: surveyTypeLabel || undefined,
        survey_date: isSurvey ? cleanSurveyDate : undefined,
        survey_time: isSurvey ? cleanSurveyTime : undefined,
      },
    });

    await prisma.crmActivity.create({
      data: { job_id: job.id, type: 'created', note: activityNote },
    });

    // Audit + idempotency record. We stash the created job id back into the
    // stored payload so a retry can echo it without creating a new job.
    await prisma.webhookEvent.create({
      data: {
        provider: 'website',
        event_type: form || 'unknown',
        payload: JSON.stringify({ ...req.body, _job_id: job.id }),
        status: 'processed',
        processed_at: new Date(),
      },
    });

    // Survey booking → drop the scheduled survey onto the planner/calendar so
    // crew can be assigned. Best-effort; only when a real date came through.
    if (isSurvey && hasValidSurveyDate) {
      try {
        await syncSurveyEvent(prisma, job.id);
      } catch (err) {
        console.error('[intake] Survey planner sync failed for job', job.id, err.message);
      }
    }

    // Admin notification — best-effort, never blocks the response contract.
    try {
      await notifyAdmin({ job, sourceLabel });
    } catch (err) {
      console.error('[intake] Admin notification email failed for job', job.id, err.message);
    }

    return res.status(201).json({ status: 'created', job_id: job.id, lead_source: sourceLabel });
  } catch (err) {
    console.error('[intake] Failed to create job from website submission:', err);
    // Record the failure for later inspection, then surface a generic 500.
    try {
      await prisma.webhookEvent.create({
        data: {
          provider: 'website',
          event_type: form || 'unknown',
          payload: JSON.stringify(req.body || {}),
          status: 'failed',
          error: err.message,
        },
      });
    } catch { /* swallow — already in the error path */ }
    return res.status(500).json({ error: 'Failed to record enquiry' });
  }
}));

module.exports = router;
