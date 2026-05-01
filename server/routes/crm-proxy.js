const express = require('express');
const wrap = require('../lib/async-handler');

const router = express.Router();

const RAILWAY_API_BASE = 'https://imove-partners.up.railway.app/api';
const API_KEY = process.env.RAILWAY_API_KEY || '';

/**
 * Proxy endpoint to fetch jobs from Railway API
 * Frontend calls this (same-origin) instead of directly calling Railway (cross-origin)
 * This avoids CORS issues entirely
 */
router.get('/jobs', wrap(async (req, res) => {
  if (!API_KEY) {
    return res.status(500).json({ error: 'API key not configured' });
  }

  try {
    const response = await fetch(`${RAILWAY_API_BASE}/crm/jobs`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${API_KEY}`,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      console.error(`[crm-proxy] Railway API error: ${response.status}`);
      return res.status(response.status).json({
        error: 'Failed to fetch jobs from Railway',
        status: response.status,
      });
    }

    const data = await response.json();
    res.json(data);
  } catch (err) {
    console.error('[crm-proxy] Error fetching jobs:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
}));

module.exports = router;
