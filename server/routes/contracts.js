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

function cleanColor(v) {
  if (typeof v !== 'string') return null;
  return /^#[0-9a-fA-F]{6}$/.test(v) ? v.toUpperCase() : null;
}

// Non-negative number or null (for the overtime fee).
function cleanMoney(v) {
  const n = parseFloat(v);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

// Overtime threshold hours: positive number, default 10.
function cleanThreshold(v) {
  const n = parseFloat(v);
  return Number.isFinite(n) && n > 0 ? n : 10;
}

router.post('/', wrap(async (req, res) => {
  const { company_name, contact_name, email, office_number, direct_line, address, description, payment_terms, is_lux, color, overtime_applicable, overtime_fee, overtime_threshold_hours } = req.body;
  if (!company_name?.trim()) return res.status(400).json({ error: 'Company name is required' });
  const otOn = !!overtime_applicable;
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
      is_lux: !!is_lux,
      overtime_applicable: otOn,
      overtime_fee: otOn ? cleanMoney(overtime_fee) : null,
      overtime_threshold_hours: cleanThreshold(overtime_threshold_hours),
      color: cleanColor(color),
    },
  });
  res.status(201).json(row);
}));

router.put('/:id', wrap(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const { company_name, contact_name, email, office_number, direct_line, address, description, payment_terms, is_lux, color, overtime_applicable, overtime_fee, overtime_threshold_hours } = req.body;
  if (!company_name?.trim()) return res.status(400).json({ error: 'Company name is required' });
  const existing = await prisma.contract.findUnique({ where: { id } });
  if (!existing) return res.status(404).json({ error: 'Contract not found' });
  const otOn = overtime_applicable === undefined ? existing.overtime_applicable : !!overtime_applicable;
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
      is_lux: is_lux === undefined ? existing.is_lux : !!is_lux,
      overtime_applicable: otOn,
      // When overtime is off, null the fee so stale amounts can't bill later.
      overtime_fee: !otOn ? null : (overtime_fee === undefined ? existing.overtime_fee : cleanMoney(overtime_fee)),
      overtime_threshold_hours: overtime_threshold_hours === undefined ? existing.overtime_threshold_hours : cleanThreshold(overtime_threshold_hours),
      color: color === undefined ? existing.color : cleanColor(color),
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
