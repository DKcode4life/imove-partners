const express = require('express');
const router = express.Router();
const prisma = require('../db/prisma');
const { authenticate, requireAdmin } = require('../middleware/auth');
const wrap = require('../lib/async-handler');

router.use(authenticate, requireAdmin);

router.get('/', wrap(async (_req, res) => {
  const rows = await prisma.contract.findMany({ orderBy: { company_name: 'asc' } });
  res.json(rows);
}));

router.post('/', wrap(async (req, res) => {
  const { company_name, contact_name, email, office_number, direct_line, address, description, payment_terms } = req.body;
  if (!company_name?.trim()) return res.status(400).json({ error: 'Company name is required' });
  const row = await prisma.contract.create({
    data: {
      company_name: company_name.trim(),
      contact_name: contact_name?.trim() || null,
      email: email?.trim() || null,
      office_number: office_number?.trim() || null,
      direct_line: direct_line?.trim() || null,
      address: address?.trim() || null,
      description: description?.trim() || null,
      payment_terms: payment_terms?.trim() || null,
    },
  });
  res.status(201).json(row);
}));

router.put('/:id', wrap(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const { company_name, contact_name, email, office_number, direct_line, address, description, payment_terms } = req.body;
  if (!company_name?.trim()) return res.status(400).json({ error: 'Company name is required' });
  const updated = await prisma.contract.update({
    where: { id },
    data: {
      company_name: company_name.trim(),
      contact_name: contact_name?.trim() || null,
      email: email?.trim() || null,
      office_number: office_number?.trim() || null,
      direct_line: direct_line?.trim() || null,
      address: address?.trim() || null,
      description: description?.trim() || null,
      payment_terms: payment_terms?.trim() || null,
    },
  });
  res.json(updated);
}));

router.delete('/:id', wrap(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  await prisma.contract.delete({ where: { id } });
  res.json({ ok: true });
}));

module.exports = router;
