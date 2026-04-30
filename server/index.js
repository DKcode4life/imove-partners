const config = require('./config');
const path = require('path');
const fs = require('fs');
const express = require('express');

// Ensure the data directory exists (required in production before Prisma connects)
const dataDir = path.join(__dirname, '../data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}
const cors = require('cors');
const prisma = require('./db/prisma');
const jobRunner = require('./jobs/runner');
const syncLeadsToCrm = require('./lib/sync-leads');
const syncCustomers = require('./lib/sync-customers');

const app = express();

app.use(cors({
  origin: (origin, cb) => {
    // Allow same-origin / non-CORS requests (server-side, curl, native apps)
    if (!origin) return cb(null, true);
    if (config.corsOrigins.includes(origin)) return cb(null, true);
    return cb(new Error(`CORS: origin ${origin} not allowed`));
  },
  credentials: true,
}));
app.use(express.json({ limit: '5mb' }));

app.use('/api/auth',      require('./routes/auth'));
app.use('/api/leads',     require('./routes/leads'));
app.use('/api/partners',  require('./routes/partners'));
app.use('/api/dashboard', require('./routes/dashboard'));
app.use('/api/crm',       require('./routes/crm-ai'));   // AI routes first (API key only)
app.use('/api/crm',       require('./routes/crm'));      // Everything else (JWT protected)
app.use('/api/crm',       require('./routes/crm-quotes')); // Quote management
app.use('/api/customers', require('./routes/customers'));
app.use('/api/planner',   require('./routes/planner'));
app.use('/api/settings',  require('./routes/settings'));
app.use('/api/contracts', require('./routes/contracts'));

app.get('/api/health', async (_req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.json({ status: 'ok', database: 'connected' });
  } catch {
    res.status(500).json({ status: 'error', database: 'disconnected' });
  }
});

// Serve built React app in production (must come after all API routes)
if (config.env === 'production') {
  app.use(express.static(path.join(__dirname, '../client/dist')));
  app.get('*', (_req, res) => {
    res.sendFile(path.join(__dirname, '../client/dist', 'index.html'));
  });
}

// Global error handler for async route errors
app.use((err, _req, res, _next) => {
  console.error('[error]', err.message);
  if (config.env === 'development') console.error(err.stack);
  res.status(500).json({ error: 'Internal server error' });
});

// Verify database connection, then start
prisma.$connect()
  .then(async () => {
    console.log('✅ Database connected');

    const synced = await syncLeadsToCrm();
    if (synced > 0) console.log(`✅ Synced ${synced} partner lead(s) to CRM`);

    const customers = await syncCustomers();
    if (customers > 0) console.log(`✅ Created ${customers} customer profile(s) from jobs`);

    if (config.env !== 'test') {
      jobRunner.start({ intervalMs: 10000 });
    }

    app.listen(config.port, () => {
      console.log(`\n🚀 iMove Partner Portal API`);
      console.log(`   Running on http://localhost:${config.port}`);
      console.log(`   Environment: ${config.env}\n`);
    });
  })
  .catch(err => {
    console.error('Failed to connect to PostgreSQL:', err.message);
    console.error('\nMake sure PostgreSQL is running and DATABASE_URL in .env is correct.');
    process.exit(1);
  });
