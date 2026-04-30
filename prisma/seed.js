const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');

const prisma = new PrismaClient();

async function main() {
  // ── Users & Partners ──────────────────────────────────────────────────────

  // Migrate old admin email if it exists
  await prisma.user.updateMany({
    where: { email: 'admin@imove.co.uk' },
    data: { email: 'info@myimove.co.uk', password_hash: bcrypt.hashSync('Marceot1', 10) },
  });

  const admin = await prisma.user.upsert({
    where: { email: 'info@myimove.co.uk' },
    update: { password_hash: bcrypt.hashSync('Marceot1', 10) },
    create: {
      email: 'info@myimove.co.uk',
      password_hash: bcrypt.hashSync('Marceot1', 10),
      name: 'iMove Admin',
      role: 'admin',
    },
  });

  const john = await prisma.user.upsert({
    where: { email: 'john@premierproperties.co.uk' },
    update: {},
    create: {
      email: 'john@premierproperties.co.uk',
      password_hash: bcrypt.hashSync('partner123', 10),
      name: 'John Smith',
      role: 'partner',
    },
  });

  const sarah = await prisma.user.upsert({
    where: { email: 'sarah@elitehomes.co.uk' },
    update: {},
    create: {
      email: 'sarah@elitehomes.co.uk',
      password_hash: bcrypt.hashSync('partner123', 10),
      name: 'Sarah Johnson',
      role: 'partner',
    },
  });

  const p1 = await prisma.partner.upsert({
    where: { user_id: john.id },
    update: {},
    create: { user_id: john.id, agency_name: 'Premier Properties', phone: '020 7123 4567' },
  });

  const p2 = await prisma.partner.upsert({
    where: { user_id: sarah.id },
    update: {},
    create: { user_id: sarah.id, agency_name: 'Elite Homes', phone: '020 7234 5678' },
  });

  // ── Portal Leads ──────────────────────────────────────────────────────────

  const leadData = [
    { partner_id: p1.id, client_name: 'Michael & Emma Thompson', current_address: '45 Oak Avenue, London, SW12 8TH', destination_postcode: 'KT2 6QH', contact_number: '07700 900123', email: 'thompson@email.com', estimated_moving_date: '2024-05-15', property_size: '3-bed', notes: 'Large family move, some garden furniture', move_stage: 'Exchanged', status: 'Survey Booked', commission_rate: 10, quote_value: 1850 },
    { partner_id: p1.id, client_name: 'David Harris', current_address: '12 Rose Street, London, SE5 9BG', destination_postcode: 'RH1 1AA', contact_number: '07700 900456', email: 'david.harris@email.com', estimated_moving_date: '2024-06-01', property_size: '1-bed', notes: 'Studio flat contents only', move_stage: 'Offer accepted', status: 'Contacted', commission_rate: 10 },
    { partner_id: p1.id, client_name: 'The Patel Family', current_address: '78 Elm Road, London, N4 2HQ', destination_postcode: 'HA2 7NW', contact_number: '07700 900789', email: 'patel.family@email.com', estimated_moving_date: '2024-04-20', property_size: '4-bed', notes: 'Piano included – needs specialist handling', move_stage: 'Ready to move', status: 'Job Completed', commission_rate: 10, quote_value: 2800 },
    { partner_id: p1.id, client_name: 'Sophie Williams', current_address: '23 Maple Close, London, E3 4QP', destination_postcode: 'CM1 1BE', contact_number: '07700 900321', email: 'sophie.w@email.com', estimated_moving_date: '2024-04-10', property_size: '2-bed', move_stage: 'Ready to move', status: 'Commission Paid', commission_rate: 10, quote_value: 1200, commission_paid: true },
    { partner_id: p1.id, client_name: 'Robert & Lisa Clarke', current_address: '99 Cedar Street, London, N16 7XP', destination_postcode: 'GU1 4AQ', contact_number: '07700 900654', email: 'clarkes@email.com', estimated_moving_date: '2024-07-20', property_size: '5-bed', notes: 'High-value property, fragile antiques', move_stage: 'Exchanged', status: 'Quoted', commission_rate: 10, quote_value: 4200 },
    { partner_id: p2.id, client_name: 'James Carter', current_address: '99 Birch Lane, London, W3 8RT', destination_postcode: 'OX1 1BP', contact_number: '07700 901234', email: 'james.carter@email.com', estimated_moving_date: '2024-07-01', property_size: '3-bed', notes: 'Has a storage unit too', move_stage: 'Offer accepted', status: 'New Lead', commission_rate: 10 },
    { partner_id: p2.id, client_name: 'Amanda Foster', current_address: '14 Willow Way, London, SE22 9LN', destination_postcode: 'BN1 1JH', contact_number: '07700 901567', email: 'amanda.foster@email.com', estimated_moving_date: '2024-06-15', property_size: '2-bed', move_stage: 'Just listed', status: 'Contacted', commission_rate: 10 },
    { partner_id: p2.id, client_name: 'George & Helen Marsh', current_address: '7 Acacia Drive, London, SW4 7GH', destination_postcode: 'BS1 4ST', contact_number: '07700 901890', email: 'marsh.family@email.com', estimated_moving_date: '2024-05-28', property_size: '4-bed', notes: 'Antique furniture, needs extra care', move_stage: 'Ready to move', status: 'Quote Accepted', commission_rate: 12, quote_value: 3100 },
  ];

  for (const d of leadData) {
    const exists = await prisma.lead.findFirst({
      where: { partner_id: d.partner_id, client_name: d.client_name },
    });
    if (!exists) await prisma.lead.create({ data: d });
  }

  // ── CRM Jobs ──────────────────────────────────────────────────────────────

  const crmSeedJobs = [
    {
      full_name: 'Tom & Jessica Wheeler', email: 'tom.wheeler@email.com', phone: '07711 001122',
      lead_source: 'Estate Agent Referral', estate_agent_name: 'Premier Properties', status: 'In Progress',
      from_line1: '14 Chestnut Avenue', from_city: 'London', from_postcode: 'SW12 9PQ',
      to_line1: '82 Maple Drive', to_city: 'Guildford', to_postcode: 'GU2 7AB',
      bedrooms: '3-bed', survey_date: '2024-05-02', confirmed_move_date: '2024-05-22',
      quote_amount: 1650, quote_sent_date: '2024-04-28', quote_accepted: true,
      internal_notes: 'Fragile antiques — handle with extra care',
    },
    {
      full_name: 'Priya Kapoor', email: 'priya.kapoor@email.com', phone: '07722 334455',
      lead_source: 'Website', status: 'Awaiting Quote',
      from_line1: '5 Victoria Street', from_city: 'London', from_postcode: 'E1 8AJ',
      to_line1: '19 Station Road', to_city: 'Brighton', to_postcode: 'BN1 4GH',
      bedrooms: '2-bed', survey_date: '2024-05-08', packing_required: true,
    },
    {
      full_name: 'Oliver & Sophie Baines', email: 'oliver.baines@email.com', phone: '07733 445566',
      lead_source: 'Estate Agent Referral', estate_agent_name: 'Elite Homes', status: 'Quote Sent',
      from_line1: '33 Birch Grove', from_city: 'London', from_postcode: 'N4 3RT',
      to_line1: '7 Cedar Lane', to_city: 'Oxford', to_postcode: 'OX1 2PL',
      bedrooms: '4-bed', confirmed_move_date: '2024-06-10', quote_amount: 3200, quote_sent_date: '2024-05-01',
      internal_notes: 'Piano in living room — needs specialist handling',
    },
    {
      full_name: 'Fatima Al-Hassan', email: 'fatima.h@email.com', phone: '07744 556677',
      lead_source: 'Word of Mouth', status: 'Job Completed',
      from_line1: '102 Elm Road', from_city: 'London', from_postcode: 'SE22 0TG',
      to_line1: '44 Oak Street', to_city: 'Bristol', to_postcode: 'BS1 3BN',
      bedrooms: '1-bed', confirmed_move_date: '2024-04-12', quote_amount: 780, quote_sent_date: '2024-03-28', quote_accepted: true,
    },
    {
      full_name: 'Marcus & Diana Collins', email: 'collins.family@email.com', phone: '07755 667788',
      lead_source: 'Estate Agent Referral', estate_agent_name: 'Premier Properties', status: 'New Lead',
      from_line1: '77 Poplar Close', from_city: 'London', from_postcode: 'N16 8WX',
      to_line1: '31 Lime Street', to_city: 'Manchester', to_postcode: 'M1 2FJ',
      bedrooms: '5-bed+',
    },
  ];

  for (const d of crmSeedJobs) {
    const exists = await prisma.crmJob.findFirst({ where: { full_name: d.full_name } });
    if (!exists) {
      const job = await prisma.crmJob.create({ data: d });
      await prisma.crmActivity.create({
        data: { job_id: job.id, type: 'created', note: `CRM record created for ${d.full_name}` },
      });
    }
  }

  // ── Planner Assets ────────────────────────────────────────────────────────

  const assetData = [
    { type: 'staff', name: 'Mark', role: 'driver', phone: '07700 900001', sort_order: 1 },
    { type: 'staff', name: 'Dan', role: 'porter', phone: '07700 900002', sort_order: 2 },
    { type: 'vehicle', name: 'Renault Master', make_model: 'Renault Master', registration: 'AB12 CDE', sort_order: 3 },
  ];

  for (const d of assetData) {
    const exists = await prisma.plannerAsset.findFirst({ where: { name: d.name, type: d.type } });
    if (!exists) await prisma.plannerAsset.create({ data: d });
  }

  // ── Company Settings ──────────────────────────────────────────────────────

  const companyDefaults = [
    { key: 'company_name',         value: 'iMove' },
    { key: 'company_email',        value: 'info@myimove.co.uk' },
    { key: 'company_phone',        value: '' },
    { key: 'company_website',      value: '' },
    { key: 'company_address',      value: '' },
    { key: 'company_registration', value: '' },
  ];

  for (const d of companyDefaults) {
    await prisma.companySetting.upsert({ where: { key: d.key }, update: {}, create: d });
  }

  // ── Job Statuses ──────────────────────────────────────────────────────────

  const statusDefaults = [
    { name: 'New Lead',               color: '#3b82f6', sort_order: 0 },
    { name: 'Called V/M',             color: '#8b5cf6', sort_order: 1 },
    { name: 'Contacted',              color: '#7c3aed', sort_order: 2 },
    { name: 'Survey Physical',        color: '#06b6d4', sort_order: 3 },
    { name: 'Survey Video',           color: '#0d9488', sort_order: 4 },
    { name: 'Quote Sent',             color: '#f59e0b', sort_order: 5 },
    { name: 'Quote Chased',           color: '#f97316', sort_order: 6 },
    { name: 'Most Likely',            color: '#eab308', sort_order: 7 },
    { name: 'Quote Accepted',         color: '#10b981', sort_order: 8 },
    { name: 'Confirmed No Date',      color: '#059669', sort_order: 9 },
    { name: 'Confirmed Deposit',      color: '#65a30d', sort_order: 10 },
    { name: 'Confirmed Paid',         color: '#15803d', sort_order: 11 },
    { name: 'Completed',              color: '#94a3b8', sort_order: 12 },
    { name: 'Archived / Review Done', color: '#6b7280', sort_order: 13 },
    { name: 'Lost / Cancelled',       color: '#ef4444', sort_order: 14 },
  ];

  for (const d of statusDefaults) {
    await prisma.jobStatus.upsert({ where: { name: d.name }, update: {}, create: d });
  }

  // ── Lead Sources ──────────────────────────────────────────────────────────

  const leadSourceDefaults = [
    'Direct Enquiry', 'Estate Agent Referral', 'Website',
    'Social Media', 'Word of Mouth', 'Google', 'Repeat Customer', 'Other',
  ];

  for (let i = 0; i < leadSourceDefaults.length; i++) {
    const name = leadSourceDefaults[i];
    await prisma.leadSource.upsert({ where: { name }, update: {}, create: { name, sort_order: i } });
  }

  // ── Move Types ────────────────────────────────────────────────────────────

  const moveTypeDefaults = [
    'Rental to Rental', 'Rental to Purchase', 'Sale to Purchase', 'Sale to Rental',
    'Storage to Property', 'Partial Move',
  ];

  for (let i = 0; i < moveTypeDefaults.length; i++) {
    const name = moveTypeDefaults[i];
    await prisma.moveType.upsert({ where: { name }, update: {}, create: { name, sort_order: i } });
  }

  // ─── Email templates (6 transactional) ───────────────────────────────────
  // Formal "Dear [Name]" voice, signed by Daniel · iMove Relocations Ltd.
  // Email footer stays consistent across all 6: company contact + company number + review links.
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

  const emailTemplates = [
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

  for (const tpl of emailTemplates) {
    await prisma.emailTemplate.upsert({
      where: { slug: tpl.slug },
      update: { name: tpl.name, subject: tpl.subject, body_html: tpl.body_html, variables: tpl.variables },
      create: tpl,
    });
  }
  console.log(`✅ Seeded ${emailTemplates.length} email templates`);

  console.log('Seed complete.');
  console.log('  Admin:   info@myimove.co.uk / Marceot1');
  console.log('  Partner: john@premierproperties.co.uk / partner123');
  console.log('  Partner: sarah@elitehomes.co.uk / partner123');
}

main()
  .catch(e => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
