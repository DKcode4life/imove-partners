const express = require('express');
const prisma = require('../db/prisma');
const { authenticate, requireAdmin } = require('../middleware/auth');
const wrap = require('../lib/async-handler');
const { send: sendEmail } = require('../services/email');
const config = require('../config');

const router = express.Router();
router.use(authenticate);

const STATUSES = [
  'New Lead', 'Contacted', 'Survey Booked', 'Quoted',
  'Quote Declined', 'Quote Accepted', 'Job Confirmed', 'Job Completed', 'Commission Paid',
];

function enrichLead(lead) {
  return {
    ...lead,
    estimated_commission: lead.quote_value
      ? parseFloat(((lead.quote_value * lead.commission_rate) / 100).toFixed(2))
      : null,
  };
}

// GET /api/leads
router.get('/', wrap(async (req, res) => {
  const { status, partner_id, search } = req.query;

  if (req.user.role === 'admin') {
    const where = {};
    if (status) where.status = status;
    if (partner_id) where.partner_id = parseInt(partner_id, 10);
    if (search) {
      where.OR = [
        { client_name: { contains: search, mode: 'insensitive' } },
        { current_address: { contains: search, mode: 'insensitive' } },
        { email: { contains: search, mode: 'insensitive' } },
      ];
    }
    where.partner = { leads_visible: true };

    const leads = await prisma.lead.findMany({
      where,
      include: { partner: { select: { agency_name: true, user: { select: { name: true, email: true } } } } },
      orderBy: { created_at: 'desc' },
    });

    return res.json(leads.map(l => enrichLead({
      ...l,
      partner_name: l.partner.user.name,
      agency_name: l.partner.agency_name,
      partner_email: l.partner.user.email,
      partner: undefined,
    })));
  }

  // Partner view
  const where = { partner_id: req.user.partnerId };
  if (status) where.status = status;
  if (search) {
    where.OR = [
      { client_name: { contains: search, mode: 'insensitive' } },
      { current_address: { contains: search, mode: 'insensitive' } },
    ];
  }

  const leads = await prisma.lead.findMany({ where, orderBy: { created_at: 'desc' } });
  res.json(leads.map(enrichLead));
}));

// POST /api/leads
router.post('/', wrap(async (req, res) => {
  const {
    client_name, current_address, destination_address, contact_number,
    email, estimated_moving_date, moving_date_type, move_type,
    property_type, floor_number, has_lift,
    property_size, notes, move_stage,
    partner_id: bodyPartnerId,
  } = req.body;

  if (!client_name || !contact_number || !email) {
    return res.status(400).json({ error: 'Client name, contact number and email are required' });
  }

  let partnerId;
  if (req.user.role === 'admin') {
    if (!bodyPartnerId) return res.status(400).json({ error: 'partner_id is required when creating a lead as admin' });
    const partnerExists = await prisma.partner.findFirst({ where: { id: parseInt(bodyPartnerId, 10), active: true } });
    if (!partnerExists) return res.status(400).json({ error: 'Partner not found' });
    partnerId = parseInt(bodyPartnerId, 10);
  } else {
    partnerId = req.user.partnerId;
  }

  const partner = await prisma.partner.findUnique({
    where: { id: partnerId },
    select: { commission_rate: true, agency_name: true },
  });

  const lead = await prisma.lead.create({
    data: {
      partner_id: partnerId,
      client_name, current_address: current_address || '', destination_address: destination_address || null,
      contact_number, email, estimated_moving_date: estimated_moving_date || null,
      moving_date_type: moving_date_type || null, move_type: move_type || null,
      property_type: property_type || null, floor_number: floor_number || null,
      has_lift: has_lift != null ? !!has_lift : null,
      property_size: property_size || null, notes: notes || null, move_stage: move_stage || null,
      commission_rate: partner?.commission_rate ?? 10,
    },
  });

  // Auto-create linked CRM job + customer
  try {
    const parts = (lead.current_address || '').split(',').map(s => s.trim());
    const addrLine = parts[0] || null;
    const cityPart = parts.length > 2 ? parts[parts.length - 2] : (parts[1] || null);
    const destParts = (lead.destination_address || '').split(',').map(s => s.trim());
    const toLine1 = destParts[0] || null;
    const toCity = destParts.length > 2 ? destParts[destParts.length - 2] : (destParts[1] || null);
    const toPostcode = destParts.length > 1 ? destParts[destParts.length - 1] : null;

    let customerId = null;
    if (lead.email) {
      const existing = await prisma.crmCustomer.findFirst({
        where: { email: { equals: lead.email, mode: 'insensitive' } },
      });
      if (existing) customerId = existing.id;
    }
    if (!customerId) {
      const existing = await prisma.crmCustomer.findFirst({
        where: { full_name: { equals: lead.client_name, mode: 'insensitive' } },
      });
      if (existing) customerId = existing.id;
    }
    if (!customerId) {
      const c = await prisma.crmCustomer.create({
        data: {
          full_name: lead.client_name, email: lead.email || null,
          phone: lead.contact_number || null, address_line1: addrLine, city: cityPart,
        },
      });
      customerId = c.id;
    }

    const crmJob = await prisma.crmJob.create({
      data: {
        lead_id: lead.id, customer_id: customerId,
        full_name: lead.client_name, email: lead.email || null, phone: lead.contact_number || null,
        lead_source: 'Estate Agent Referral', estate_agent_name: partner?.agency_name || null,
        from_line1: addrLine, from_city: cityPart, to_line1: toLine1, to_city: toCity, to_postcode: toPostcode,
        bedrooms: lead.property_size || null, preferred_move_date: lead.estimated_moving_date || null,
        status: 'New Lead', partner_commission_rate: partner?.commission_rate || null,
      },
    });

    await prisma.crmActivity.create({
      data: {
        job_id: crmJob.id, type: 'created',
        note: `Imported from Partner Portal — referred by ${partner?.agency_name || 'estate agent'}`,
      },
    });
  } catch (err) { console.error('[leads] CrmJob auto-create failed for lead', lead.id, err); }

  // Email admin: new lead notification
  try {
    const setting = await prisma.companySetting.findUnique({ where: { key: 'company_email' } });
    const adminEmail = setting?.value?.trim();
    if (adminEmail) {
      const crmLink = `${config.crmUrl}/admin/crm`;
      const agencyName = partner?.agency_name || 'an estate agent';
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
            <h1 style="margin:0;color:#ffffff;font-size:22px;font-weight:700;letter-spacing:-0.5px;">New Lead Submitted</h1>
            <p style="margin:8px 0 0;color:#cffafe;font-size:14px;">Partner Portal Notification</p>
          </td>
        </tr>

        <tr>
          <td style="padding:32px 40px;">
            <p style="margin:0 0 20px;font-size:15px;">A new lead has been submitted by <strong>${agencyName}</strong>.</p>

            <table width="100%" cellpadding="0" cellspacing="0" style="background:#f0f9ff;border:1px solid #bae6fd;border-radius:10px;margin:0 0 24px;">
              <tr>
                <td style="padding:20px 24px;">
                  <p style="margin:0 0 6px;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;color:#0369a1;">Lead Details</p>
                  <table cellpadding="0" cellspacing="0" style="font-size:14px;color:#1e293b;width:100%;">
                    <tr><td style="padding:4px 0;color:#64748b;width:140px;">Client</td><td style="padding:4px 0;"><strong>${lead.client_name}</strong></td></tr>
                    <tr><td style="padding:4px 0;color:#64748b;">Email</td><td style="padding:4px 0;">${lead.email || '—'}</td></tr>
                    <tr><td style="padding:4px 0;color:#64748b;">Phone</td><td style="padding:4px 0;">${lead.contact_number || '—'}</td></tr>
                    <tr><td style="padding:4px 0;color:#64748b;">Moving from</td><td style="padding:4px 0;">${lead.current_address || '—'}</td></tr>
                    ${lead.destination_address ? `<tr><td style="padding:4px 0;color:#64748b;">Moving to</td><td style="padding:4px 0;">${lead.destination_address}</td></tr>` : ''}
                    ${lead.estimated_moving_date ? `<tr><td style="padding:4px 0;color:#64748b;">Preferred date</td><td style="padding:4px 0;">${lead.estimated_moving_date}</td></tr>` : ''}
                    <tr><td style="padding:4px 0;color:#64748b;">Estate agent</td><td style="padding:4px 0;">${agencyName}</td></tr>
                  </table>
                </td>
              </tr>
            </table>

            <table cellpadding="0" cellspacing="0" style="margin:0 auto;">
              <tr>
                <td style="background:#0891b2;border-radius:8px;">
                  <a href="${crmLink}" style="display:inline-block;padding:12px 28px;color:#ffffff;font-weight:700;font-size:14px;text-decoration:none;">Open CRM &amp; Import Lead →</a>
                </td>
              </tr>
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
        subject: `New lead from ${agencyName} — ${lead.client_name}`,
        html,
      });
    }
  } catch (err) { console.error('[leads] Admin notification email failed for lead', lead.id, err); }

  res.status(201).json(enrichLead(lead));
}));

// GET /api/leads/counts
router.get('/counts', requireAdmin, wrap(async (_req, res) => {
  const rows = await prisma.lead.groupBy({ by: ['status'], _count: true });
  const countMap = Object.fromEntries(rows.map(r => [r.status, r._count]));
  res.json(STATUSES.map(s => ({ status: s, count: countMap[s] || 0 })));
}));

// GET /api/leads/:id
router.get('/:id', wrap(async (req, res) => {
  const id = parseInt(req.params.id, 10);

  if (req.user.role === 'admin') {
    const lead = await prisma.lead.findUnique({
      where: { id },
      include: { partner: { select: { agency_name: true, phone: true, user: { select: { name: true, email: true } } } } },
    });
    if (!lead) return res.status(404).json({ error: 'Lead not found' });
    return res.json(enrichLead({
      ...lead,
      partner_name: lead.partner.user.name,
      agency_name: lead.partner.agency_name,
      partner_phone: lead.partner.phone,
      partner_email: lead.partner.user.email,
      partner: undefined,
    }));
  }

  const lead = await prisma.lead.findFirst({ where: { id, partner_id: req.user.partnerId } });
  if (!lead) return res.status(404).json({ error: 'Lead not found' });
  res.json(enrichLead(lead));
}));

// PUT /api/leads/:id
router.put('/:id', wrap(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const lead = await prisma.lead.findUnique({ where: { id } });
  if (!lead) return res.status(404).json({ error: 'Lead not found' });

  if (req.user.role === 'partner' && lead.partner_id !== req.user.partnerId) {
    return res.status(403).json({ error: 'Access denied' });
  }

  if (req.user.role === 'admin') {
    const {
      status, quote_value, commission_rate, commission_paid,
      client_name, current_address, destination_address,
      contact_number, email, estimated_moving_date, moving_date_type,
      move_type, property_type, floor_number, has_lift,
      property_size, notes, move_stage,
    } = req.body;

    if (status && !STATUSES.includes(status)) {
      return res.status(400).json({ error: 'Invalid status' });
    }

    await prisma.lead.update({
      where: { id },
      data: {
        status: status ?? undefined,
        quote_value: quote_value ?? undefined,
        commission_rate: commission_rate ?? undefined,
        commission_paid: commission_paid !== undefined ? !!commission_paid : undefined,
        client_name: client_name ?? undefined,
        current_address: current_address ?? undefined,
        destination_address: destination_address ?? undefined,
        contact_number: contact_number ?? undefined,
        email: email ?? undefined,
        estimated_moving_date: estimated_moving_date ?? undefined,
        moving_date_type: moving_date_type ?? undefined,
        move_type: move_type ?? undefined,
        property_type: property_type ?? undefined,
        floor_number: floor_number || null,
        has_lift: has_lift != null ? !!has_lift : undefined,
        property_size: property_size ?? undefined,
        notes: notes ?? undefined,
        move_stage: move_stage ?? undefined,
      },
    });
  } else {
    const { notes, move_stage } = req.body;
    await prisma.lead.update({
      where: { id },
      data: {
        notes: notes ?? undefined,
        move_stage: move_stage ?? undefined,
      },
    });
  }

  const updated = await prisma.lead.findUnique({ where: { id } });

  // Sync changes to the linked CrmJob (if one exists)
  try {
    const linkedJob = await prisma.crmJob.findFirst({ where: { lead_id: id } });
    if (linkedJob) {
      const parts = (updated.current_address || '').split(',').map(s => s.trim());
      const addrLine = parts[0] || null;
      const cityPart = parts.length > 2 ? parts[parts.length - 2] : (parts[1] || null);
      const destParts = (updated.destination_address || '').split(',').map(s => s.trim());
      await prisma.crmJob.update({
        where: { id: linkedJob.id },
        data: {
          full_name: updated.client_name,
          email: updated.email || null,
          phone: updated.contact_number || null,
          from_line1: addrLine,
          from_city: cityPart,
          to_line1: destParts[0] || null,
          to_city: destParts.length > 2 ? destParts[destParts.length - 2] : (destParts[1] || null),
          to_postcode: destParts.length > 1 ? destParts[destParts.length - 1] : null,
          bedrooms: updated.property_size || null,
          preferred_move_date: updated.estimated_moving_date || null,
          client_notes: updated.notes || null,
        },
      });
    }
  } catch (err) { console.error('[leads] CrmJob sync on update failed for lead', id, err); }

  res.json(enrichLead(updated));
}));

// POST /api/leads/pay
router.post('/pay', requireAdmin, wrap(async (req, res) => {
  const { lead_ids } = req.body;
  if (!Array.isArray(lead_ids) || lead_ids.length === 0) {
    return res.status(400).json({ error: 'lead_ids must be a non-empty array' });
  }

  const now = new Date().toISOString();

  await prisma.$transaction(
    lead_ids.map(id =>
      prisma.lead.update({
        where: { id },
        data: {
          commission_paid: true,
          commission_paid_at: now,
          status: 'Commission Paid',
        },
      })
    )
  );

  res.json({ message: 'Commissions marked as paid', paid_at: now, count: lead_ids.length });
}));

// DELETE /api/leads/:id
router.delete('/:id', requireAdmin, wrap(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const lead = await prisma.lead.findUnique({ where: { id } });
  if (!lead) return res.status(404).json({ error: 'Lead not found' });
  await prisma.lead.delete({ where: { id } });
  res.json({ message: 'Lead deleted' });
}));

module.exports = router;
