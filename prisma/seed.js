const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');

const prisma = new PrismaClient();

async function main() {
  // ── Users & Partners ──────────────────────────────────────────────────────

  const admin = await prisma.user.upsert({
    where: { email: 'admin@imove.co.uk' },
    update: {},
    create: {
      email: 'admin@imove.co.uk',
      password_hash: bcrypt.hashSync('admin123', 10),
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
      lead_source: 'Estate Agent Referral', estate_agent_name: 'Premier Properties', status: 'Booked Move',
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
      lead_source: 'Word of Mouth', status: 'Completed',
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

  console.log('Seed complete.');
  console.log('  Admin:   admin@imove.co.uk / admin123');
  console.log('  Partner: john@premierproperties.co.uk / partner123');
  console.log('  Partner: sarah@elitehomes.co.uk / partner123');
}

main()
  .catch(e => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
