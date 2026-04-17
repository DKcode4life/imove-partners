const prisma = require('../db/prisma');

module.exports = async function syncLeadsToCrm() {
  const importedIds = (await prisma.crmJob.findMany({
    where: { lead_id: { not: null } },
    select: { lead_id: true },
  })).map(j => j.lead_id);

  const pending = await prisma.lead.findMany({
    where: importedIds.length > 0 ? { id: { notIn: importedIds } } : undefined,
    include: { partner: { select: { agency_name: true, commission_rate: true } } },
  });

  let synced = 0;
  for (const lead of pending) {
    try {
      const parts = (lead.current_address || '').split(',').map(s => s.trim());
      const job = await prisma.crmJob.create({
        data: {
          lead_id: lead.id,
          full_name: lead.client_name,
          email: lead.email || null,
          phone: lead.contact_number || null,
          lead_source: 'Estate Agent Referral',
          estate_agent_name: lead.partner?.agency_name || null,
          from_line1: parts[0] || null,
          to_postcode: lead.destination_postcode || null,
          bedrooms: lead.property_size || null,
          preferred_move_date: lead.estimated_moving_date || null,
          status: 'New Lead',
          partner_commission_rate: lead.partner?.commission_rate || null,
        },
      });
      await prisma.crmActivity.create({
        data: {
          job_id: job.id,
          type: 'created',
          note: `Auto-synced from Partner Portal — ${lead.partner?.agency_name || 'estate agent'}`,
        },
      });
      synced++;
    } catch (_) { /* skip individual errors */ }
  }

  return synced;
};
