const express = require('express');
const prisma = require('../db/prisma');
const { authenticate, requireAdmin } = require('../middleware/auth');
const wrap = require('../lib/async-handler');

const router = express.Router();

// ── Tracking endpoint (called by partner portal frontend) ────────────────────
// Authenticated only; intentionally accepts both admin and partner so admins
// browsing the partner portal during testing don't pollute logs (we skip
// admins below).
router.post('/track', authenticate, wrap(async (req, res) => {
  if (req.user.role !== 'partner') return res.json({ ok: true, skipped: true });

  const { event_type, path } = req.body || {};
  if (!event_type) return res.status(400).json({ error: 'event_type required' });

  await prisma.partnerActivityLog.create({
    data: {
      user_id:    req.user.id,
      partner_id: req.user.partnerId || null,
      event_type: String(event_type).slice(0, 32),
      path:       path ? String(path).slice(0, 500) : null,
      ip_address: req.headers['x-forwarded-for']?.toString().split(',')[0].trim() || req.ip || null,
      user_agent: req.headers['user-agent'] || null,
    },
  });

  res.json({ ok: true });
}));

// ─────────────────────────────────────────────────────────────────────────────
// Admin-only analytics endpoints below
// ─────────────────────────────────────────────────────────────────────────────
router.use(authenticate, requireAdmin);

// GET /api/analytics/overview
// Top-line stats for the analytics dashboard.
router.get('/overview', wrap(async (_req, res) => {
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const weekStart  = new Date(todayStart.getTime() - 6 * 24 * 60 * 60 * 1000);
  const monthStart = new Date(todayStart.getTime() - 29 * 24 * 60 * 60 * 1000);

  const [
    totalPartners,
    activePartners,
    loginsToday,
    loginsThisWeek,
    pageViewsToday,
    pageViewsThisWeek,
    uniqueActiveToday,
    uniqueActiveThisWeek,
  ] = await Promise.all([
    prisma.partner.count(),
    prisma.partner.count({ where: { active: true } }),
    prisma.partnerActivityLog.count({ where: { event_type: 'login', created_at: { gte: todayStart } } }),
    prisma.partnerActivityLog.count({ where: { event_type: 'login', created_at: { gte: weekStart } } }),
    prisma.partnerActivityLog.count({ where: { event_type: 'page_view', created_at: { gte: todayStart } } }),
    prisma.partnerActivityLog.count({ where: { event_type: 'page_view', created_at: { gte: weekStart } } }),
    prisma.partnerActivityLog.findMany({
      where: { event_type: 'login', created_at: { gte: todayStart }, partner_id: { not: null } },
      distinct: ['partner_id'],
      select: { partner_id: true },
    }),
    prisma.partnerActivityLog.findMany({
      where: { event_type: 'login', created_at: { gte: weekStart }, partner_id: { not: null } },
      distinct: ['partner_id'],
      select: { partner_id: true },
    }),
  ]);

  // Logins per day for last 30 days (build sparse map then fill)
  const last30 = await prisma.partnerActivityLog.findMany({
    where: { event_type: 'login', created_at: { gte: monthStart } },
    select: { created_at: true },
  });

  const dailyMap = new Map();
  for (let i = 0; i < 30; i++) {
    const d = new Date(monthStart.getTime() + i * 24 * 60 * 60 * 1000);
    const key = d.toISOString().slice(0, 10);
    dailyMap.set(key, 0);
  }
  for (const row of last30) {
    const key = row.created_at.toISOString().slice(0, 10);
    if (dailyMap.has(key)) dailyMap.set(key, dailyMap.get(key) + 1);
  }
  const dailyLogins = Array.from(dailyMap.entries()).map(([date, count]) => ({ date, count }));

  res.json({
    totalPartners,
    activePartners,
    loginsToday,
    loginsThisWeek,
    pageViewsToday,
    pageViewsThisWeek,
    uniqueActiveToday: uniqueActiveToday.length,
    uniqueActiveThisWeek: uniqueActiveThisWeek.length,
    dailyLogins,
  });
}));

// GET /api/analytics/partners
// One row per partner with usage summary.
router.get('/partners', wrap(async (_req, res) => {
  const partners = await prisma.partner.findMany({
    include: {
      user: { select: { id: true, email: true, name: true, avatar: true, created_at: true } },
    },
    orderBy: { created_at: 'desc' },
  });

  const partnerIds = partners.map(p => p.id);
  if (partnerIds.length === 0) return res.json([]);

  // Pull aggregate counts in one shot
  const allLogs = await prisma.partnerActivityLog.findMany({
    where: { partner_id: { in: partnerIds } },
    select: { partner_id: true, event_type: true, created_at: true },
    orderBy: { created_at: 'desc' },
  });

  const summary = new Map();
  for (const p of partners) {
    summary.set(p.id, { logins: 0, pageViews: 0, lastSeen: null });
  }
  for (const log of allLogs) {
    const s = summary.get(log.partner_id);
    if (!s) continue;
    if (log.event_type === 'login') s.logins++;
    else if (log.event_type === 'page_view') s.pageViews++;
    if (!s.lastSeen || log.created_at > s.lastSeen) s.lastSeen = log.created_at;
  }

  const result = partners.map(p => {
    const s = summary.get(p.id);
    return {
      id:              p.id,
      agency_name:     p.agency_name,
      active:          p.active,
      phone:           p.phone,
      created_at:      p.created_at,
      user: {
        id:         p.user.id,
        name:       p.user.name,
        email:      p.user.email,
        avatar:     p.user.avatar,
        created_at: p.user.created_at,
      },
      total_logins:    s.logins,
      total_page_views: s.pageViews,
      last_seen:       s.lastSeen,
    };
  });

  res.json(result);
}));

// GET /api/analytics/partners/:id
// Detailed activity for a single partner.
router.get('/partners/:id', wrap(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const partner = await prisma.partner.findUnique({
    where: { id },
    include: { user: { select: { id: true, email: true, name: true, avatar: true, created_at: true } } },
  });
  if (!partner) return res.status(404).json({ error: 'Partner not found' });

  const days = parseInt(req.query.days, 10) || 30;
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  const logs = await prisma.partnerActivityLog.findMany({
    where: { partner_id: id, created_at: { gte: since } },
    orderBy: { created_at: 'desc' },
    take: 500,
  });

  // Daily login counts
  const dailyMap = new Map();
  for (let i = 0; i < days; i++) {
    const d = new Date(since.getTime() + i * 24 * 60 * 60 * 1000);
    dailyMap.set(d.toISOString().slice(0, 10), { logins: 0, pageViews: 0 });
  }
  for (const l of logs) {
    const key = l.created_at.toISOString().slice(0, 10);
    if (!dailyMap.has(key)) continue;
    const bucket = dailyMap.get(key);
    if (l.event_type === 'login') bucket.logins++;
    else if (l.event_type === 'page_view') bucket.pageViews++;
  }
  const daily = Array.from(dailyMap.entries()).map(([date, v]) => ({ date, ...v }));

  // Top pages
  const pageCounts = new Map();
  for (const l of logs) {
    if (l.event_type !== 'page_view' || !l.path) continue;
    pageCounts.set(l.path, (pageCounts.get(l.path) || 0) + 1);
  }
  const topPages = Array.from(pageCounts.entries())
    .map(([path, count]) => ({ path, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 20);

  const totalLogins = logs.filter(l => l.event_type === 'login').length;
  const totalPageViews = logs.filter(l => l.event_type === 'page_view').length;
  const lastSeen = logs[0]?.created_at || null;

  res.json({
    partner: {
      id:          partner.id,
      agency_name: partner.agency_name,
      active:      partner.active,
      phone:       partner.phone,
      created_at:  partner.created_at,
      user: partner.user,
    },
    range_days:      days,
    total_logins:    totalLogins,
    total_page_views: totalPageViews,
    last_seen:       lastSeen,
    daily,
    top_pages:       topPages,
    recent_events:   logs.slice(0, 50).map(l => ({
      id:         l.id,
      event_type: l.event_type,
      path:       l.path,
      created_at: l.created_at,
      ip_address: l.ip_address,
    })),
  });
}));

module.exports = router;
