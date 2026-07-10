/**
 * Standalone re-seed script for the 6 transactional email templates.
 *
 * Safe to run against production — it upserts (insert-or-update) by slug and
 * does NOT touch users, jobs, leads, partners, or any other data.
 *
 * Usage:
 *     node prisma/seed-templates.js
 *     npm run seed:templates
 */

const fs = require('fs');
const path = require('path');
const { PrismaClient } = require('@prisma/client');
const { DEFAULT_CATALOG } = require('../server/data/default-catalog');
const prisma = new PrismaClient();

// ── Shared blocks ─────────────────────────────────────────────────────────────

// Public logo URL — must be an absolute production URL so the image loads
// inside recipients' email clients (a relative or localhost URL would not).
// logo-email.png is the transparent logo with a soft white glow baked into
// the pixels (generated from logo.png): email clients strip CSS shadows, so
// the glow that lifts it off the coloured header must live in the image.
const LOGO_URL = 'https://crm.myimove.co.uk/logo-email.png';

const SIGNATURE = `
            <table width="100%" cellpadding="0" cellspacing="0" style="border-top:2px solid #16a34a;margin-top:28px;padding-top:20px;">
              <tr>
                <td style="width:50%;vertical-align:top;padding-right:20px;">
                  <p style="margin:0;font-size:15px;font-weight:700;color:#1e293b;">Daniel Koulke</p>
                  <p style="margin:4px 0 0;font-size:12px;color:#64748b;line-height:1.6;">iMove Relocations Ltd<br><span style="font-size:11px;color:#94a3b8;">Company No: 16291851</span></p>
                </td>
                <td style="width:50%;vertical-align:top;">
                  <p style="margin:0 0 4px;font-size:12px;color:#475569;">📞 <a href="tel:01638255255" style="color:#16a34a;text-decoration:none;font-weight:600;">01638 255 255</a></p>
                  <p style="margin:0 0 4px;font-size:12px;color:#475569;">✉️ <a href="mailto:info@myimove.co.uk" style="color:#16a34a;text-decoration:none;">info@myimove.co.uk</a></p>
                  <p style="margin:0 0 4px;font-size:12px;color:#475569;">🌐 <a href="https://www.myimove.co.uk" style="color:#16a34a;text-decoration:none;">www.myimove.co.uk</a></p>
                  <p style="margin:0;font-size:12px;color:#475569;">📍 94C Hampstead Ave, Mildenhall, Suffolk, IP28 7AS</p>
                </td>
              </tr>
            </table>
            <table width="100%" cellpadding="0" cellspacing="0" style="margin-top:16px;">
              <tr>
                <td align="center">
                  <a href="https://wa.me/441638255255" style="display:inline-block;background:#25d366;color:#ffffff;font-weight:700;font-size:13px;padding:12px 28px;border-radius:8px;text-decoration:none;">💬 Chat NOW on WhatsApp for quick help</a>
                </td>
              </tr>
            </table>`;

const PAGE_FOOTER = `
        <tr>
          <td style="background:#f8fafc;border-top:1px solid #e2e8f0;padding:20px 40px;text-align:center;">
            <p style="margin:0;font-size:11px;color:#94a3b8;">© iMove Relocations Ltd · 94C Hampstead Avenue, Mildenhall, Suffolk, IP28 7AS</p>
          </td>
        </tr>`;

const BANK_CARD = `
            <table width="100%" cellpadding="0" cellspacing="0" style="background:#f0fdf4;border:1px solid #86efac;border-radius:10px;margin:20px 0;">
              <tr>
                <td style="padding:20px 24px;">
                  <p style="margin:0 0 10px;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;color:#16a34a;">Bank Transfer Details</p>
                  <p style="margin:0;font-size:14px;line-height:2;color:#166534;">
                    Account name: <strong>iMove Relocations Ltd</strong><br>
                    Sort code: <strong>04-00-03</strong><br>
                    Account number: <strong>66057796</strong><br>
                    Reference: <strong>{{invoice_number}}</strong>
                  </p>
                </td>
              </tr>
            </table>`;

function buildEmail({ headerGradient, headerTitle, headerSubtitle, body }) {
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f8fafc;font-family:Arial,Helvetica,sans-serif;color:#1e293b;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f8fafc;padding:32px 16px;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden;border:1px solid #e2e8f0;max-width:600px;width:100%;">

        <tr>
          <td style="background:${headerGradient};padding:24px 28px;">
            <table width="100%" cellpadding="0" cellspacing="0">
              <tr>
                <td style="width:112px;vertical-align:middle;">
                  <img src="${LOGO_URL}" alt="iMove Removals &amp; Storage" width="104" style="display:block;width:104px;height:auto;border:0;">
                </td>
                <td style="text-align:center;vertical-align:middle;padding:0 8px;">
                  <h1 style="margin:0;color:#ffffff;font-size:22px;font-weight:700;letter-spacing:-0.5px;">${headerTitle}</h1>
                  <p style="margin:6px 0 0;color:rgba(255,255,255,0.85);font-size:13px;">${headerSubtitle}</p>
                </td>
                <td style="width:112px;">&nbsp;</td>
              </tr>
            </table>
          </td>
        </tr>

        <tr>
          <td style="padding:36px 40px;">
            ${body}
            ${SIGNATURE}
          </td>
        </tr>
        ${PAGE_FOOTER}

      </table>
    </td></tr>
  </table>
</body>
</html>`.trim();
}

// ── Templates ─────────────────────────────────────────────────────────────────

async function main() {
  const templates = [

    // ── 1. Estimate Quote ───────────────────────────────────────────────────
    {
      slug: 'estimate-quote',
      name: 'Estimate Quote',
      subject: 'Your moving estimate from iMove Relocations — Quote {{quote_number}}',
      variables: '["customer_name","quote_number","from_address","to_address","amount","valid_until"]',
      body_html: buildEmail({
        headerGradient: 'linear-gradient(135deg,#f59e0b 0%,#d97706 100%)',
        headerTitle: 'Your Moving Estimate',
        headerSubtitle: 'iMove Removals & Storage',
        body: `
            <p style="margin:0 0 20px;font-size:16px;">Dear <strong>{{customer_name}}</strong>,</p>
            <p style="margin:0 0 20px;">Thank you for getting in touch with <strong>iMove Relocations</strong>. Please find attached your estimate quote for your proposed move.</p>

            <table width="100%" cellpadding="0" cellspacing="0" style="background:#fffbeb;border:1px solid #fde68a;border-radius:10px;margin:0 0 24px;">
              <tr>
                <td style="padding:24px 28px;">
                  <p style="margin:0 0 10px;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;color:#d97706;">Estimate Summary</p>
                  <table width="100%" cellpadding="0" cellspacing="0">
                    <tr>
                      <td style="font-size:13px;color:#92400e;padding:4px 0;width:40%;">Quote Reference</td>
                      <td style="font-size:13px;font-weight:700;color:#78350f;padding:4px 0;">{{quote_number}}</td>
                    </tr>
                    <tr>
                      <td style="font-size:13px;color:#92400e;padding:4px 0;">Moving From</td>
                      <td style="font-size:13px;font-weight:700;color:#78350f;padding:4px 0;">{{from_address}}</td>
                    </tr>
                    <tr>
                      <td style="font-size:13px;color:#92400e;padding:4px 0;">Moving To</td>
                      <td style="font-size:13px;font-weight:700;color:#78350f;padding:4px 0;">{{to_address}}</td>
                    </tr>
                    <tr>
                      <td style="font-size:13px;color:#92400e;padding:4px 0;">Indicative Total</td>
                      <td style="font-size:16px;font-weight:700;color:#d97706;padding:4px 0;">£{{amount}}</td>
                    </tr>
                    <tr>
                      <td style="font-size:13px;color:#92400e;padding:4px 0;">Valid Until</td>
                      <td style="font-size:13px;font-weight:700;color:#78350f;padding:4px 0;">{{valid_until}}</td>
                    </tr>
                  </table>
                </td>
              </tr>
            </table>

            <p style="margin:0 0 16px;">This estimate is based on the information provided to date and is subject to a final survey. Once a survey has been completed, we will issue a fixed price guarantee.</p>
            <p style="margin:0 0 24px;">If you would like to proceed or have any questions, please don't hesitate to reply to this email — we're always happy to help.</p>
            <p style="margin:0;font-size:14px;color:#475569;">Kind regards,<br><strong>The iMove Team</strong></p>`,
      }),
    },

    // ── 2. Fixed Quote ──────────────────────────────────────────────────────
    {
      slug: 'fixed-quote',
      name: 'Fixed Quote',
      subject: 'Your fixed quote from iMove Relocations — Quote {{quote_number}}',
      variables: '["customer_name","quote_number","move_date","amount","deposit","valid_until","accept_url"]',
      body_html: buildEmail({
        headerGradient: 'linear-gradient(135deg,#3b82f6 0%,#1d4ed8 100%)',
        headerTitle: 'Your Fixed Quote',
        headerSubtitle: 'iMove Removals & Storage',
        body: `
            <p style="margin:0 0 20px;font-size:16px;">Dear <strong>{{customer_name}}</strong>,</p>
            <p style="margin:0 0 20px;">Further to our recent survey, please find attached your <strong>fixed price quote</strong> for your upcoming move.</p>

            <table width="100%" cellpadding="0" cellspacing="0" style="background:#eff6ff;border:1px solid #bfdbfe;border-radius:10px;margin:0 0 24px;">
              <tr>
                <td style="padding:24px 28px;">
                  <p style="margin:0 0 10px;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;color:#1d4ed8;">Quote Summary</p>
                  <table width="100%" cellpadding="0" cellspacing="0">
                    <tr>
                      <td style="font-size:13px;color:#1e40af;padding:4px 0;width:40%;">Quote Reference</td>
                      <td style="font-size:13px;font-weight:700;color:#1e3a8a;padding:4px 0;">{{quote_number}}</td>
                    </tr>
                    <tr>
                      <td style="font-size:13px;color:#1e40af;padding:4px 0;">Move Date</td>
                      <td style="font-size:13px;font-weight:700;color:#1e3a8a;padding:4px 0;">{{move_date}}</td>
                    </tr>
                    <tr>
                      <td style="font-size:13px;color:#1e40af;padding:4px 0;">Total Price</td>
                      <td style="font-size:16px;font-weight:700;color:#1d4ed8;padding:4px 0;">£{{amount}}</td>
                    </tr>
                    <tr>
                      <td style="font-size:13px;color:#1e40af;padding:4px 0;">Deposit to Confirm</td>
                      <td style="font-size:13px;font-weight:700;color:#1e3a8a;padding:4px 0;">£{{deposit}}</td>
                    </tr>
                    <tr>
                      <td style="font-size:13px;color:#1e40af;padding:4px 0;">Quote Valid Until</td>
                      <td style="font-size:13px;font-weight:700;color:#1e3a8a;padding:4px 0;">{{valid_until}}</td>
                    </tr>
                  </table>
                </td>
              </tr>
            </table>

            <p style="margin:0 0 16px;">This price is <strong>guaranteed and fixed</strong> — it will not change provided the inventory and access details remain as discussed during the survey.</p>
            <p style="margin:0 0 16px;">To go ahead, tap the button below to review your quote, add any optional extras (such as packing), confirm the value of your items for insurance, and accept online — it only takes a minute. Once accepted, we'll send your deposit invoice with our bank details.</p>
            <p style="margin:0 0 24px;font-size:13px;color:#64748b;">Our full <strong>terms &amp; conditions</strong> are attached to this email for your review before accepting.</p>

            <table width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 28px;">
              <tr>
                <td align="center">
                  <a href="{{accept_url}}" style="display:inline-block;background:#16a34a;color:#ffffff;font-weight:700;font-size:16px;padding:16px 44px;border-radius:10px;text-decoration:none;">✓ Accept Your Quote</a>
                  <p style="margin:14px 0 0;font-size:12px;color:#94a3b8;">Or paste this link into your browser:<br><span style="color:#475569;word-break:break-all;">{{accept_url}}</span></p>
                </td>
              </tr>
            </table>

            <p style="margin:0;font-size:14px;color:#475569;">Kind regards,<br><strong>The iMove Team</strong></p>`,
      }),
    },

    // ── 2b. Quote Accepted (customer confirmation) ──────────────────────────
    {
      slug: 'quote-accepted',
      name: 'Quote Accepted Confirmation',
      subject: 'Quote {{quote_number}} accepted — thank you! ✓',
      variables: '["customer_name","quote_number","amount","declared_value","move_date"]',
      body_html: buildEmail({
        headerGradient: 'linear-gradient(135deg,#16a34a 0%,#15803d 100%)',
        headerTitle: 'Quote Accepted — Thank You!',
        headerSubtitle: 'iMove Removals & Storage',
        body: `
            <p style="margin:0 0 20px;font-size:16px;">Dear <strong>{{customer_name}}</strong>,</p>
            <p style="margin:0 0 20px;">Thank you for accepting your quote with <strong>iMove Relocations</strong>. Your signed acceptance form is attached for your records — please keep it safe.</p>

            <table width="100%" cellpadding="0" cellspacing="0" style="background:#f0fdf4;border:1px solid #86efac;border-radius:10px;margin:0 0 24px;">
              <tr>
                <td style="padding:24px 28px;">
                  <p style="margin:0 0 10px;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;color:#16a34a;">Acceptance Summary</p>
                  <table width="100%" cellpadding="0" cellspacing="0">
                    <tr>
                      <td style="font-size:13px;color:#166534;padding:4px 0;width:50%;">Quote Reference</td>
                      <td style="font-size:13px;font-weight:700;color:#14532d;padding:4px 0;">{{quote_number}}</td>
                    </tr>
                    <tr>
                      <td style="font-size:13px;color:#166534;padding:4px 0;">Move Date</td>
                      <td style="font-size:13px;font-weight:700;color:#14532d;padding:4px 0;">{{move_date}}</td>
                    </tr>
                    <tr>
                      <td style="font-size:13px;color:#166534;padding:4px 0;">Agreed Total</td>
                      <td style="font-size:16px;font-weight:700;color:#16a34a;padding:4px 0;">£{{amount}}</td>
                    </tr>
                    <tr>
                      <td style="font-size:13px;color:#166534;padding:4px 0;">Declared Value (Insurance)</td>
                      <td style="font-size:13px;font-weight:700;color:#14532d;padding:4px 0;">£{{declared_value}}</td>
                    </tr>
                  </table>
                </td>
              </tr>
            </table>

            <p style="margin:0 0 16px;">To secure your moving date, we'll shortly send your <strong>deposit invoice</strong> by email with our bank details. Once your deposit is received, your booking is confirmed.</p>
            <p style="margin:0 0 24px;">If anything changes or you have any questions, just reply to this email — we're always happy to help.</p>
            <p style="margin:0;font-size:14px;color:#475569;">Kind regards,<br><strong>The iMove Team</strong></p>`,
      }),
    },

    // ── 3. Deposit Invoice ──────────────────────────────────────────────────
    {
      slug: 'deposit-invoice',
      name: 'Deposit Invoice',
      subject: 'Deposit invoice for your move — Invoice {{invoice_number}}',
      variables: '["customer_name","invoice_number","amount","due_date","move_date"]',
      body_html: buildEmail({
        headerGradient: 'linear-gradient(135deg,#7c3aed 0%,#6d28d9 100%)',
        headerTitle: 'Deposit Invoice',
        headerSubtitle: 'iMove Removals & Storage',
        body: `
            <p style="margin:0 0 20px;font-size:16px;">Dear <strong>{{customer_name}}</strong>,</p>
            <p style="margin:0 0 20px;">Thank you for choosing <strong>iMove Relocations</strong>. Please find attached your deposit invoice to secure your confirmed moving date.</p>

            <table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f3ff;border:1px solid #c4b5fd;border-radius:10px;margin:0 0 20px;">
              <tr>
                <td style="padding:24px 28px;">
                  <p style="margin:0 0 10px;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;color:#7c3aed;">Invoice Details</p>
                  <table width="100%" cellpadding="0" cellspacing="0">
                    <tr>
                      <td style="font-size:13px;color:#5b21b6;padding:4px 0;width:40%;">Invoice Number</td>
                      <td style="font-size:13px;font-weight:700;color:#4c1d95;padding:4px 0;">{{invoice_number}}</td>
                    </tr>
                    <tr>
                      <td style="font-size:13px;color:#5b21b6;padding:4px 0;">Move Date</td>
                      <td style="font-size:13px;font-weight:700;color:#4c1d95;padding:4px 0;">{{move_date}}</td>
                    </tr>
                    <tr>
                      <td style="font-size:13px;color:#5b21b6;padding:4px 0;">Deposit Due</td>
                      <td style="font-size:18px;font-weight:700;color:#7c3aed;padding:4px 0;">£{{amount}}</td>
                    </tr>
                    <tr>
                      <td style="font-size:13px;color:#5b21b6;padding:4px 0;">Payment Due By</td>
                      <td style="font-size:13px;font-weight:700;color:#4c1d95;padding:4px 0;">{{due_date}}</td>
                    </tr>
                  </table>
                </td>
              </tr>
            </table>

            ${BANK_CARD}

            <p style="margin:0 0 16px;">Once your deposit has been received, your booking will be confirmed and a receipt will follow by email for your records.</p>
            <p style="margin:0 0 24px;">If you have any questions regarding this invoice, please don't hesitate to get in touch.</p>
            <p style="margin:0;font-size:14px;color:#475569;">Kind regards,<br><strong>The iMove Team</strong></p>`,
      }),
    },

    // ── 4. Deposit Receipt ──────────────────────────────────────────────────
    {
      slug: 'deposit-receipt',
      name: 'Deposit Receipt',
      subject: 'Deposit received — your move is confirmed ✓',
      variables: '["customer_name","amount","balance","move_date"]',
      body_html: buildEmail({
        headerGradient: 'linear-gradient(135deg,#10b981 0%,#059669 100%)',
        headerTitle: 'Deposit Received',
        headerSubtitle: 'Your move is now confirmed',
        body: `
            <p style="margin:0 0 20px;font-size:16px;">Dear <strong>{{customer_name}}</strong>,</p>
            <p style="margin:0 0 20px;">Great news — your deposit has been received and your move date is now <strong>confirmed</strong>. Please find attached your official deposit receipt for your records.</p>

            <table width="100%" cellpadding="0" cellspacing="0" style="background:#f0fdf4;border:1px solid #86efac;border-radius:10px;margin:0 0 24px;">
              <tr>
                <td style="padding:24px 28px;">
                  <p style="margin:0 0 10px;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;color:#16a34a;">Booking Confirmation</p>
                  <table width="100%" cellpadding="0" cellspacing="0">
                    <tr>
                      <td style="font-size:13px;color:#166534;padding:4px 0;width:40%;">Move Date</td>
                      <td style="font-size:13px;font-weight:700;color:#14532d;padding:4px 0;">{{move_date}}</td>
                    </tr>
                    <tr>
                      <td style="font-size:13px;color:#166534;padding:4px 0;">Deposit Received</td>
                      <td style="font-size:18px;font-weight:700;color:#16a34a;padding:4px 0;">£{{amount}}</td>
                    </tr>
                    <tr>
                      <td style="font-size:13px;color:#166534;padding:4px 0;">Remaining Balance</td>
                      <td style="font-size:13px;font-weight:700;color:#14532d;padding:4px 0;">£{{balance}}</td>
                    </tr>
                    <tr>
                      <td style="font-size:13px;color:#166534;padding:4px 0;">Status</td>
                      <td style="padding:4px 0;"><span style="background:#dcfce7;color:#166534;font-size:12px;font-weight:700;padding:3px 10px;border-radius:20px;">✓ Confirmed</span></td>
                    </tr>
                  </table>
                </td>
              </tr>
            </table>

            <p style="margin:0 0 16px;">The remaining balance of <strong>£{{balance}}</strong> will be due closer to the move date — a final invoice will be issued nearer the time.</p>
            <p style="margin:0 0 24px;">Should anything change between now and your move date, please do let us know at your earliest convenience. We look forward to making your move a great experience!</p>
            <p style="margin:0;font-size:14px;color:#475569;">Kind regards,<br><strong>The iMove Team</strong></p>`,
      }),
    },

    // ── 5. Main / Final Invoice ─────────────────────────────────────────────
    {
      slug: 'main-invoice',
      name: 'Final Invoice',
      subject: 'Final invoice for your move — Invoice {{invoice_number}}',
      variables: '["customer_name","invoice_number","total","deposit_paid","balance","due_date","move_date"]',
      body_html: buildEmail({
        headerGradient: 'linear-gradient(135deg,#475569 0%,#334155 100%)',
        headerTitle: 'Final Invoice',
        headerSubtitle: 'iMove Removals & Storage',
        body: `
            <p style="margin:0 0 20px;font-size:16px;">Dear <strong>{{customer_name}}</strong>,</p>
            <p style="margin:0 0 20px;">Please find attached the <strong>final invoice</strong> for your upcoming move. Thank you for your continued trust in iMove Relocations.</p>

            <table width="100%" cellpadding="0" cellspacing="0" style="background:#f8fafc;border:1px solid #cbd5e1;border-radius:10px;margin:0 0 20px;">
              <tr>
                <td style="padding:24px 28px;">
                  <p style="margin:0 0 10px;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;color:#475569;">Invoice Summary</p>
                  <table width="100%" cellpadding="0" cellspacing="0">
                    <tr>
                      <td style="font-size:13px;color:#64748b;padding:4px 0;width:40%;">Invoice Number</td>
                      <td style="font-size:13px;font-weight:700;color:#334155;padding:4px 0;">{{invoice_number}}</td>
                    </tr>
                    <tr>
                      <td style="font-size:13px;color:#64748b;padding:4px 0;">Move Date</td>
                      <td style="font-size:13px;font-weight:700;color:#334155;padding:4px 0;">{{move_date}}</td>
                    </tr>
                    <tr>
                      <td style="font-size:13px;color:#64748b;padding:4px 0;border-top:1px solid #e2e8f0;">Total</td>
                      <td style="font-size:13px;color:#334155;padding:4px 0;border-top:1px solid #e2e8f0;">£{{total}}</td>
                    </tr>
                    <tr>
                      <td style="font-size:13px;color:#64748b;padding:4px 0;">Less Deposit Paid</td>
                      <td style="font-size:13px;color:#16a34a;font-weight:700;padding:4px 0;">−£{{deposit_paid}}</td>
                    </tr>
                    <tr>
                      <td style="font-size:13px;color:#64748b;padding:4px 0;">Balance Due</td>
                      <td style="font-size:18px;font-weight:700;color:#334155;padding:4px 0;">£{{balance}}</td>
                    </tr>
                    <tr>
                      <td style="font-size:13px;color:#64748b;padding:4px 0;">Payment Due By</td>
                      <td style="font-size:13px;font-weight:700;color:#334155;padding:4px 0;">{{due_date}}</td>
                    </tr>
                  </table>
                </td>
              </tr>
            </table>

            ${BANK_CARD}

            <p style="margin:0 0 16px;">Please ensure the invoice reference is included with your payment. If you have any questions, please don't hesitate to contact us.</p>
            <p style="margin:0 0 24px;">We look forward to making your move day as smooth and stress-free as possible!</p>
            <p style="margin:0;font-size:14px;color:#475569;">Kind regards,<br><strong>The iMove Team</strong></p>`,
      }),
    },

    // ── 6. Move Receipt (Paid in Full) ──────────────────────────────────────
    {
      slug: 'move-receipt',
      name: 'Move Receipt (Paid in Full)',
      subject: 'Payment received in full — thank you from iMove Relocations 🎉',
      variables: '["customer_name","amount","total"]',
      body_html: buildEmail({
        headerGradient: 'linear-gradient(135deg,#14b8a6 0%,#0f766e 100%)',
        headerTitle: 'Paid in Full — Thank You!',
        headerSubtitle: 'We hope you love your new home',
        body: `
            <p style="margin:0 0 20px;font-size:16px;">Dear <strong>{{customer_name}}</strong>,</p>
            <p style="margin:0 0 20px;">Thank you — your final balance has been received and your move is now <strong>paid in full</strong>. Please find attached your official receipt for your records.</p>

            <table width="100%" cellpadding="0" cellspacing="0" style="background:#f0fdfa;border:1px solid #5eead4;border-radius:10px;margin:0 0 24px;">
              <tr>
                <td style="padding:24px 28px;">
                  <p style="margin:0 0 10px;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;color:#0f766e;">Payment Confirmation</p>
                  <table width="100%" cellpadding="0" cellspacing="0">
                    <tr>
                      <td style="font-size:13px;color:#115e59;padding:4px 0;width:40%;">Amount Received</td>
                      <td style="font-size:18px;font-weight:700;color:#14b8a6;padding:4px 0;">£{{amount}}</td>
                    </tr>
                    <tr>
                      <td style="font-size:13px;color:#115e59;padding:4px 0;">Status</td>
                      <td style="padding:4px 0;"><span style="background:#ccfbf1;color:#0f766e;font-size:12px;font-weight:700;padding:3px 10px;border-radius:20px;">✓ Paid in Full</span></td>
                    </tr>
                  </table>
                </td>
              </tr>
            </table>

            <p style="margin:0 0 16px;">We truly appreciate your business and we hope you are settling comfortably into your new home.</p>
            <p style="margin:0 0 16px;">If you have a moment to spare, we would be very grateful for a short review on Google — it makes a meaningful difference for a small, family-run business like ours.</p>
            <p style="margin:0 0 24px;">And if you ever know someone planning a move, we offer a <strong>referral reward for both parties</strong> — simply reply to this email and we'll share the details.</p>
            <p style="margin:0;font-size:14px;color:#475569;">Kind regards,<br><strong>The iMove Team</strong></p>`,
      }),
    },
  ];

  for (const tpl of templates) {
    await prisma.emailTemplate.upsert({
      where: { slug: tpl.slug },
      update: {
        name: tpl.name,
        subject: tpl.subject,
        body_html: tpl.body_html,
        variables: tpl.variables,
      },
      create: tpl,
    });
    console.log(`  ✓ ${tpl.slug.padEnd(22)} → "${tpl.name}"`);
  }

  console.log(`\n✅ Re-seeded ${templates.length} email templates.\n`);

  // ── Inventory catalog ─────────────────────────────────────────────────────
  // Three-tier behaviour:
  //   1. If prisma/catalog-snapshot.json exists AND we haven't restored it yet,
  //      overwrite the DB catalog from the snapshot (one-time recovery path
  //      for prod after the bad seed wiped admin customizations). A marker row
  //      is written so this only runs once per snapshot version.
  //   2. Else if no catalog row exists, seed from the built-in DEFAULT_CATALOG.
  //   3. Else leave the existing catalog alone so admin edits persist.
  const SNAPSHOT_PATH   = path.join(__dirname, 'catalog-snapshot.json');
  const RESTORE_MARKER  = 'catalog-snapshot-restored-v1';
  const existingCatalog = await prisma.companySetting.findUnique({ where: { key: 'inventory-catalog' } });
  const restoreMarker   = await prisma.companySetting.findUnique({ where: { key: RESTORE_MARKER } });

  if (fs.existsSync(SNAPSHOT_PATH) && !restoreMarker) {
    const snapshot = fs.readFileSync(SNAPSHOT_PATH, 'utf8');
    await prisma.companySetting.upsert({
      where:  { key: 'inventory-catalog' },
      update: { value: snapshot },
      create: { key: 'inventory-catalog', value: snapshot },
    });
    await prisma.companySetting.create({
      data: { key: RESTORE_MARKER, value: new Date().toISOString() },
    });
    console.log(`✅ Inventory catalog restored from snapshot (${(snapshot.length / 1024).toFixed(1)} KB).\n`);
  } else if (!existingCatalog) {
    await prisma.companySetting.create({
      data: { key: 'inventory-catalog', value: JSON.stringify(DEFAULT_CATALOG) },
    });
    console.log('✅ Inventory catalog seeded (first install).\n');
  } else {
    console.log('ℹ️  Inventory catalog preserved — admin customizations intact.\n');
  }
}

main()
  .catch((e) => { console.error('❌ Template re-seed failed:', e); process.exit(1); })
  .finally(() => prisma.$disconnect());
