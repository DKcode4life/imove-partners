const express = require('express');
const prisma = require('../db/prisma');
const { authenticate } = require('../middleware/auth');
const wrap = require('../lib/async-handler');

const router = express.Router();
router.use(authenticate);

router.get('/', wrap(async (req, res) => {
  if (req.user.role === 'admin') {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    const [totalLeads, totalPartners, revenueAgg, owedAgg, newLeadsToday, leadsByStatus, recentLeadsRaw] = await Promise.all([
      prisma.lead.count(),
      prisma.partner.count({ where: { active: true } }),
      prisma.lead.aggregate({
        _sum: { quote_value: true },
        where: { status: { in: ['Job Completed', 'Commission Paid'] } },
      }),
      prisma.$queryRawUnsafe(
        `SELECT COALESCE(SUM(quote_value * commission_rate / 100.0), 0) AS n
         FROM leads
         WHERE commission_paid = 0 AND status IN ('Job Completed', 'Commission Paid')`
      ),
      prisma.lead.count({ where: { created_at: { gte: today, lt: tomorrow } } }),
      prisma.lead.groupBy({ by: ['status'], _count: true }),
      prisma.lead.findMany({
        include: { partner: { select: { agency_name: true, user: { select: { name: true } } } } },
        orderBy: { created_at: 'desc' },
        take: 8,
      }),
    ]);

    const totalRevenue = revenueAgg._sum.quote_value || 0;
    const commissionsOwed = owedAgg[0]?.n || 0;

    const recentLeads = recentLeadsRaw.map(l => ({
      ...l,
      partner_name: l.partner.user.name,
      agency_name: l.partner.agency_name,
      partner: undefined,
      estimated_commission: l.quote_value
        ? parseFloat(((l.quote_value * l.commission_rate) / 100).toFixed(2))
        : null,
    }));

    const partnerStats = await prisma.$queryRawUnsafe(
      `SELECT p.agency_name, u.name AS user_name,
        COUNT(l.id) AS total_leads,
        SUM(CASE WHEN l.status IN ('Job Completed','Commission Paid') THEN 1 ELSE 0 END) AS confirmed_jobs,
        COALESCE(SUM(CASE WHEN l.commission_paid = 0 AND l.status IN ('Job Completed','Commission Paid')
          THEN l.quote_value * l.commission_rate / 100.0 ELSE 0 END), 0) AS owed
      FROM partners p
      JOIN users u ON u.id = p.user_id
      LEFT JOIN leads l ON l.partner_id = p.id
      GROUP BY p.id, p.agency_name, u.name ORDER BY owed DESC LIMIT 5`
    );

    return res.json({
      role: 'admin',
      totalLeads,
      totalPartners,
      totalRevenue: parseFloat(totalRevenue.toFixed(2)),
      commissionsOwed: parseFloat(Number(commissionsOwed).toFixed(2)),
      newLeadsToday,
      recentLeads,
      leadsByStatus: leadsByStatus.map(r => ({ status: r.status, count: r._count })),
      partnerStats: partnerStats.map(r => ({
        ...r,
        total_leads: Number(r.total_leads),
        confirmed_jobs: Number(r.confirmed_jobs),
        owed: Number(r.owed),
      })),
    });
  }

  // Partner dashboard
  const pid = req.user.partnerId;

  const [totalLeads, confirmedJobs, earnedAgg, pendingAgg, pipelineAgg, leadsByStatus, recentLeads] = await Promise.all([
    prisma.lead.count({ where: { partner_id: pid } }),
    prisma.lead.count({ where: { partner_id: pid, status: { in: ['Job Completed', 'Commission Paid'] } } }),
    prisma.$queryRawUnsafe(
      `SELECT COALESCE(SUM(quote_value * commission_rate / 100.0), 0) AS n
       FROM leads WHERE partner_id = ? AND commission_paid = 1`, pid
    ),
    prisma.$queryRawUnsafe(
      `SELECT COALESCE(SUM(quote_value * commission_rate / 100.0), 0) AS n
       FROM leads WHERE partner_id = ? AND commission_paid = 0 AND status IN ('Job Completed','Commission Paid')`, pid
    ),
    prisma.$queryRawUnsafe(
      `SELECT COALESCE(SUM(quote_value * commission_rate / 100.0), 0) AS n
       FROM leads WHERE partner_id = ? AND commission_paid = 0 AND status IN ('Quoted','Quote Accepted')`, pid
    ),
    prisma.lead.groupBy({ by: ['status'], _count: true, where: { partner_id: pid } }),
    prisma.lead.findMany({
      where: { partner_id: pid },
      orderBy: { created_at: 'desc' },
      take: 6,
    }),
  ]);

  res.json({
    role: 'partner',
    totalLeads,
    confirmedJobs,
    totalEarned: parseFloat(Number(earnedAgg[0]?.n || 0).toFixed(2)),
    pendingCommission: parseFloat(Number(pendingAgg[0]?.n || 0).toFixed(2)),
    estimatedInPipeline: parseFloat(Number(pipelineAgg[0]?.n || 0).toFixed(2)),
    recentLeads: recentLeads.map(l => ({
      ...l,
      estimated_commission: l.quote_value
        ? parseFloat(((l.quote_value * l.commission_rate) / 100).toFixed(2))
        : null,
    })),
    leadsByStatus: leadsByStatus.map(r => ({ status: r.status, count: r._count })),
  });
}));

module.exports = router;
