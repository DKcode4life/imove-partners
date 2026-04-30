/**
 * Standalone re-seed script for the 6 transactional email templates only.
 *
 * Safe to run against production — it upserts (insert-or-update) by slug and
 * does NOT touch users, jobs, leads, partners, or any other data.
 *
 * Usage (locally or via Railway shell):
 *     node prisma/seed-templates.js
 *     npm run seed:templates
 */

const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const EMAIL_FOOTER = `<p style="margin-top:28px;padding-top:16px;border-top:1px solid #dfe4ea;color:#666;font-size:13px;line-height:1.5">
Kind regards,<br/>
<strong style="color:#1a1a1a">Daniel</strong><br/>
iMove Relocations Ltd<br/>
📞 01638 255 255 &nbsp;|&nbsp; ✉️ info@myimove.co.uk &nbsp;|&nbsp; 🌐 www.myimove.co.uk<br/>
94C Hampstead Avenue, Mildenhall, Suffolk, IP28 7AS<br/>
<span style="color:#999;font-size:11px">Company number: 16291851</span>
</p>`;

  const BANK_BLOCK = `<p style="background:#f7f9fb;border-left:3px solid #a5d535;padding:12px 16px;margin:16px 0">
<strong>Payment — Bank Transfer</strong><br/>
Account name: <strong>iMove Relocations Ltd</strong><br/>
Sort code: <strong>04-00-03</strong><br/>
Account number: <strong>66057796</strong><br/>
Reference: <strong>{{invoice_number}}</strong>
</p>`;

  const templates = [
    {
      slug: 'estimate-quote',
      name: 'Estimate Quote',
      subject: 'Your moving estimate from iMove Relocations — Quote {{quote_number}}',
      body_html: `<p>Dear {{customer_name}},</p>
<p>Thank you for getting in touch with <strong>iMove Relocations</strong>. Please find attached your <strong>estimate quote</strong> for the proposed move from {{from_address}} to {{to_address}}.</p>
<p>This estimate is based on the information provided to date and is subject to a final survey. The indicative total for the services outlined is <strong>£{{amount}}</strong>.</p>
<p>If you would like to proceed, please simply reply to this email and we will arrange a survey to confirm a fixed price. This estimate is valid until <strong>{{valid_until}}</strong>.</p>
<p>Should you have any questions or require further clarification, please don't hesitate to reach out — your satisfaction is our priority.</p>
${EMAIL_FOOTER}`,
      variables: '["customer_name","quote_number","from_address","to_address","amount","valid_until"]',
    },
    {
      slug: 'fixed-quote',
      name: 'Fixed Quote',
      subject: 'Your fixed quote from iMove Relocations — Quote {{quote_number}}',
      body_html: `<p>Dear {{customer_name}},</p>
<p>Further to our recent conversation, please find attached your <strong>fixed quote</strong> for your upcoming move on <strong>{{move_date}}</strong>.</p>
<p>The total for the services outlined is <strong>£{{amount}}</strong>. This price is guaranteed and will not change, provided the inventory and access details remain as discussed.</p>
<p>To confirm your booking, kindly reply to this email or settle the deposit of <strong>£{{deposit}}</strong>. This quote is valid until <strong>{{valid_until}}</strong>.</p>
<p>We look forward to the opportunity to deliver a smooth and professional move for you.</p>
${EMAIL_FOOTER}`,
      variables: '["customer_name","quote_number","move_date","amount","deposit","valid_until"]',
    },
    {
      slug: 'deposit-invoice',
      name: 'Deposit Invoice',
      subject: 'Deposit invoice for your move — Invoice {{invoice_number}}',
      body_html: `<p>Dear {{customer_name}},</p>
<p>Thank you for choosing <strong>iMove Relocations</strong>. Please find attached your <strong>deposit invoice</strong> to secure your confirmed moving date of <strong>{{move_date}}</strong>.</p>
<p><strong>Amount due:</strong> £{{amount}}<br/>
<strong>Payment due by:</strong> {{due_date}}</p>
${BANK_BLOCK}
<p>Once your deposit has been received, your booking will be confirmed and a receipt will follow by email for your records. If you have any questions regarding this invoice, please feel free to contact us.</p>
${EMAIL_FOOTER}`,
      variables: '["customer_name","invoice_number","amount","due_date","move_date"]',
    },
    {
      slug: 'deposit-receipt',
      name: 'Deposit Receipt',
      subject: 'Deposit received — your move is confirmed',
      body_html: `<p>Dear {{customer_name}},</p>
<p>Thank you — we can confirm that your deposit of <strong>£{{amount}}</strong> has been received. Your move on <strong>{{move_date}}</strong> is now <strong>confirmed</strong>.</p>
<p>Please find attached your official deposit receipt for your records.</p>
<p>The remaining balance of <strong>£{{balance}}</strong> will be due closer to the move date — a final invoice will be issued nearer the time.</p>
<p>Should anything change between now and your move date, please do let us know at your earliest convenience.</p>
${EMAIL_FOOTER}`,
      variables: '["customer_name","amount","balance","move_date"]',
    },
    {
      slug: 'main-invoice',
      name: 'Final Invoice',
      subject: 'Final invoice for your move — Invoice {{invoice_number}}',
      body_html: `<p>Dear {{customer_name}},</p>
<p>Please find attached the <strong>final invoice</strong> for your move on <strong>{{move_date}}</strong>.</p>
<p><strong>Total:</strong> £{{total}}<br/>
<strong>Less deposit paid:</strong> −£{{deposit_paid}}<br/>
<strong>Balance due:</strong> £{{balance}}<br/>
<strong>Payment due by:</strong> {{due_date}}</p>
${BANK_BLOCK}
<p>Thank you once again for choosing iMove Relocations. Please ensure the reference number is included with your payment. If you have any questions regarding this invoice, please don't hesitate to contact us.</p>
${EMAIL_FOOTER}`,
      variables: '["customer_name","invoice_number","total","deposit_paid","balance","due_date","move_date"]',
    },
    {
      slug: 'move-receipt',
      name: 'Move Receipt (Paid in Full)',
      subject: 'Payment received in full — thank you from iMove Relocations',
      body_html: `<p>Dear {{customer_name}},</p>
<p>Thank you — we can confirm that your final balance of <strong>£{{amount}}</strong> has been received. Your move is now <strong>paid in full</strong>.</p>
<p>Please find attached your official receipt for your records. We truly appreciate your business and trust you are settling comfortably into your new home.</p>
<p>If you have a moment to spare, we would be grateful for a short review on Google — it makes a meaningful difference for a small, family-run business such as ours. And should you ever know someone planning a move, we offer a referral reward for both parties — please simply reply and we'll share the details.</p>
${EMAIL_FOOTER}`,
      variables: '["customer_name","amount","total"]',
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

  console.log(`\n✅ Re-seeded ${templates.length} email templates with iMove Relocations voice.\n`);
}

main()
  .catch((e) => { console.error('❌ Template re-seed failed:', e); process.exit(1); })
  .finally(() => prisma.$disconnect());
