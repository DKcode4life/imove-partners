const express = require('express');
const prisma = require('../db/prisma');
const { authenticate, requireAdmin } = require('../middleware/auth');
const wrap = require('../lib/async-handler');

const router = express.Router();
router.use(authenticate, requireAdmin);

async function withCounts(customer) {
  const [jobs, storage, referrals] = await Promise.all([
    prisma.crmJob.count({ where: { customer_id: customer.id } }),
    prisma.crmJob.count({ where: { customer_id: customer.id, storage_required: true } }),
    prisma.crmJob.count({ where: { referred_by_customer_id: customer.id } }),
  ]);
  return { ...customer, jobs_count: jobs, storage_count: storage, referrals_count: referrals };
}

// GET /api/customers
router.get('/', wrap(async (req, res) => {
  const { search } = req.query;
  const where = {};

  if (search) {
    where.OR = [
      { full_name: { contains: search, mode: 'insensitive' } },
      { email: { contains: search, mode: 'insensitive' } },
      { phone: { contains: search, mode: 'insensitive' } },
      { address_line1: { contains: search, mode: 'insensitive' } },
      { postcode: { contains: search, mode: 'insensitive' } },
      { city: { contains: search, mode: 'insensitive' } },
    ];
  }

  const customers = await prisma.crmCustomer.findMany({ where, orderBy: { full_name: 'asc' } });
  const result = await Promise.all(customers.map(withCounts));
  res.json(result);
}));

// GET /api/customers/:id
router.get('/:id', wrap(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const customer = await prisma.crmCustomer.findUnique({ where: { id } });
  if (!customer) return res.status(404).json({ error: 'Customer not found' });

  const jobSelect = {
    id: true, full_name: true, status: true, confirmed_move_date: true, preferred_move_date: true,
    from_line1: true, from_postcode: true, to_line1: true, to_postcode: true,
    bedrooms: true, quote_amount: true, storage_required: true, created_at: true,
  };

  const [jobs, referrals] = await Promise.all([
    prisma.crmJob.findMany({ where: { customer_id: id }, select: jobSelect, orderBy: { created_at: 'desc' } }),
    prisma.crmJob.findMany({ where: { referred_by_customer_id: id }, select: jobSelect, orderBy: { created_at: 'desc' } }),
  ]);

  res.json({ ...(await withCounts(customer)), jobs, referrals });
}));

// POST /api/customers
router.post('/', wrap(async (req, res) => {
  const b = req.body;
  if (!b.full_name?.trim()) return res.status(400).json({ error: 'full_name is required' });

  const customer = await prisma.crmCustomer.create({
    data: {
      full_name: b.full_name.trim(),
      email: b.email || null, alt_email: b.alt_email || null,
      phone: b.phone || null, alt_phone: b.alt_phone || null,
      address_line1: b.address_line1 || null, address_line2: b.address_line2 || null,
      city: b.city || null, postcode: b.postcode || null, notes: b.notes || null,
    },
  });
  res.status(201).json(await withCounts(customer));
}));

// PUT /api/customers/:id
router.put('/:id', wrap(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const existing = await prisma.crmCustomer.findUnique({ where: { id } });
  if (!existing) return res.status(404).json({ error: 'Customer not found' });

  const b = req.body;
  const updated = await prisma.crmCustomer.update({
    where: { id },
    data: {
      full_name: b.full_name ?? existing.full_name,
      email: b.email ?? null, alt_email: b.alt_email ?? null,
      phone: b.phone ?? null, alt_phone: b.alt_phone ?? null,
      address_line1: b.address_line1 ?? null, address_line2: b.address_line2 ?? null,
      city: b.city ?? null, postcode: b.postcode ?? null, notes: b.notes ?? null,
    },
  });
  res.json(await withCounts(updated));
}));

// DELETE /api/customers/:id
router.delete('/:id', wrap(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const existing = await prisma.crmCustomer.findUnique({ where: { id } });
  if (!existing) return res.status(404).json({ error: 'Customer not found' });

  await prisma.crmJob.updateMany({ where: { customer_id: id }, data: { customer_id: null } });
  await prisma.crmJob.updateMany({ where: { referred_by_customer_id: id }, data: { referred_by_customer_id: null } });
  await prisma.crmCustomer.delete({ where: { id } });
  res.json({ message: 'Customer deleted' });
}));

// PATCH /api/customers/:id/link-job
router.patch('/:id/link-job', wrap(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const { job_id, type } = req.body;
  if (!job_id) return res.status(400).json({ error: 'job_id is required' });

  const customer = await prisma.crmCustomer.findUnique({ where: { id } });
  if (!customer) return res.status(404).json({ error: 'Customer not found' });

  const job = await prisma.crmJob.findUnique({ where: { id: parseInt(job_id, 10) } });
  if (!job) return res.status(404).json({ error: 'Job not found' });

  if (type === 'referral') {
    await prisma.crmJob.update({ where: { id: job.id }, data: { referred_by_customer_id: id } });
  } else {
    await prisma.crmJob.update({ where: { id: job.id }, data: { customer_id: id } });
  }

  const updated = await prisma.crmCustomer.findUnique({ where: { id } });
  res.json(await withCounts(updated));
}));

module.exports = router;
