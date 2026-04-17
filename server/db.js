const initSqlJs = require('sql.js');
const bcrypt = require('bcryptjs');
const path = require('path');
const fs = require('fs');

const dataDir = path.join(__dirname, '../data');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

const DB_PATH = path.join(dataDir, 'imove.db');

// ── sql.js → better-sqlite3 compatibility wrapper ────────────────────────────
// Routes use the better-sqlite3 synchronous API (db.prepare().get/all/run).
// This wrapper makes sql.js behave identically so no routes need changing.

function makeWrapper(sqlDb) {
  let inTx = false;

  function saveToDisk() {
    if (!inTx) {
      const data = sqlDb.export();
      fs.writeFileSync(DB_PATH, Buffer.from(data));
    }
  }

  function normalizeParams(args) {
    // .run(a, b, c)  → [a, b, c]
    // .run([a, b, c]) → [a, b, c]
    if (args.length === 1 && Array.isArray(args[0])) return args[0];
    return Array.from(args);
  }

  function lastInsertRowid() {
    const res = sqlDb.exec('SELECT last_insert_rowid()');
    return res.length ? res[0].values[0][0] : null;
  }

  return {
    prepare(sql) {
      return {
        /** Returns first matching row as plain object, or undefined */
        get(...args) {
          const p = normalizeParams(args);
          const stmt = sqlDb.prepare(sql);
          if (p.length) stmt.bind(p);
          const hasRow = stmt.step();
          const row = hasRow ? stmt.getAsObject() : undefined;
          stmt.free();
          return row;
        },

        /** Returns all matching rows as an array of plain objects */
        all(...args) {
          const p = normalizeParams(args);
          const stmt = sqlDb.prepare(sql);
          if (p.length) stmt.bind(p);
          const rows = [];
          while (stmt.step()) rows.push({ ...stmt.getAsObject() });
          stmt.free();
          return rows;
        },

        /** Executes a write statement, returns { lastInsertRowid, changes } */
        run(...args) {
          const p = normalizeParams(args);
          const stmt = sqlDb.prepare(sql);
          stmt.run(p.length ? p : undefined);
          stmt.free();
          const rowid = lastInsertRowid();
          saveToDisk();
          return { lastInsertRowid: rowid };
        },
      };
    },

    /** Run one or more SQL statements (used for schema creation) */
    exec(sql) {
      sqlDb.run(sql);
      saveToDisk();
    },

    /** Enable SQLite pragmas */
    pragma(p) {
      try { sqlDb.run(`PRAGMA ${p}`); } catch (_) {}
    },

    /** Wrap a function in a BEGIN/COMMIT transaction */
    transaction(fn) {
      return (...args) => {
        inTx = true;
        sqlDb.run('BEGIN TRANSACTION');
        try {
          const result = fn(...args);
          sqlDb.run('COMMIT');
          inTx = false;
          saveToDisk();
          return result;
        } catch (e) {
          sqlDb.run('ROLLBACK');
          inTx = false;
          throw e;
        }
      };
    },
  };
}

// ── Lazy proxy – routes import `db` at module load time before init ───────────
let _db = null;

const db = new Proxy(
  {},
  {
    get(_, prop) {
      if (prop === 'init') return initDatabase;
      if (!_db) throw new Error('Database not yet initialized. Await db.init() first.');
      const val = _db[prop];
      return typeof val === 'function' ? val.bind(_db) : val;
    },
  },
);

// ── Schema ────────────────────────────────────────────────────────────────────
const SCHEMA = `
  CREATE TABLE IF NOT EXISTS users (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    email         TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    name          TEXT NOT NULL,
    role          TEXT NOT NULL CHECK(role IN ('admin','partner')),
    avatar        TEXT,
    created_at    DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS partners (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id         INTEGER UNIQUE NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    agency_name     TEXT NOT NULL,
    phone           TEXT,
    commission_rate REAL DEFAULT 10.0,
    payment_method  TEXT,
    bank_account    TEXT,
    bank_sort_code  TEXT,
    gift_card_email TEXT,
    active          INTEGER DEFAULT 1,
    created_at      DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS crm_jobs (
    id                    INTEGER PRIMARY KEY AUTOINCREMENT,
    lead_id               INTEGER REFERENCES leads(id) ON DELETE SET NULL,
    -- Contact
    full_name             TEXT NOT NULL,
    email                 TEXT,
    alt_email             TEXT,
    phone                 TEXT,
    alt_phone             TEXT,
    client_notes          TEXT,
    -- Lead / Referral
    lead_source           TEXT DEFAULT 'Direct Enquiry',
    estate_agent_name     TEXT,
    internal_ref          TEXT,
    status                TEXT NOT NULL DEFAULT 'New Lead',
    -- Move Details
    from_line1            TEXT,
    from_line2            TEXT,
    from_city             TEXT,
    from_postcode         TEXT,
    to_line1              TEXT,
    to_line2              TEXT,
    to_city               TEXT,
    to_postcode           TEXT,
    property_type_from    TEXT,
    property_type_to      TEXT,
    bedrooms              TEXT,
    parking_notes         TEXT,
    bedrooms_to           TEXT,
    parking_notes_to      TEXT,
    preferred_move_date   TEXT,
    confirmed_move_date   TEXT,
    flexibility_notes     TEXT,
    -- Survey / Quote
    survey_required       INTEGER DEFAULT 0,
    survey_type           TEXT,
    survey_date           TEXT,
    quote_amount          REAL,
    quote_sent_date       TEXT,
    quote_accepted        INTEGER DEFAULT 0,
    deposit_required      INTEGER DEFAULT 0,
    deposit_paid          INTEGER DEFAULT 0,
    -- Operations
    internal_notes        TEXT,
    special_handling      TEXT,
    access_restrictions   TEXT,
    inventory_notes       TEXT,
    packing_required      INTEGER DEFAULT 0,
    dismantling_required  INTEGER DEFAULT 0,
    storage_required      INTEGER DEFAULT 0,
    -- Property extras (floor / lift / other)
    floor_from            TEXT,
    has_lift_from         INTEGER DEFAULT 0,
    prop_type_from_other  TEXT,
    floor_to              TEXT,
    has_lift_to           INTEGER DEFAULT 0,
    prop_type_to_other    TEXT,
    -- Move type / key worker
    move_type             TEXT,
    is_key_worker         INTEGER DEFAULT 0,
    -- Staff placeholders
    assigned_surveyor     TEXT,
    assigned_mover        TEXT,
    assigned_driver       TEXT,
    assigned_vehicle      TEXT,
    -- Partner portal sync
    partner_commission_rate REAL,
    -- Timestamps
    created_at            DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at            DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS crm_activities (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    job_id     INTEGER NOT NULL REFERENCES crm_jobs(id) ON DELETE CASCADE,
    type       TEXT NOT NULL,
    note       TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS crm_customers (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    full_name     TEXT NOT NULL,
    email         TEXT,
    alt_email     TEXT,
    phone         TEXT,
    alt_phone     TEXT,
    address_line1 TEXT,
    address_line2 TEXT,
    city          TEXT,
    postcode      TEXT,
    notes         TEXT,
    created_at    DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at    DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS leads (
    id                    INTEGER PRIMARY KEY AUTOINCREMENT,
    partner_id            INTEGER NOT NULL REFERENCES partners(id) ON DELETE CASCADE,
    client_name           TEXT NOT NULL,
    current_address       TEXT NOT NULL,
    destination_postcode  TEXT,
    contact_number        TEXT NOT NULL,
    email                 TEXT NOT NULL,
    estimated_moving_date TEXT,
    moving_date_type      TEXT,
    move_type             TEXT,
    property_type         TEXT,
    floor_number          TEXT,
    has_lift              INTEGER,
    property_size         TEXT,
    notes                 TEXT,
    move_stage            TEXT,
    status                TEXT NOT NULL DEFAULT 'New Lead',
    quote_value           REAL,
    commission_rate       REAL DEFAULT 10.0,
    commission_paid       INTEGER DEFAULT 0,
    commission_paid_at    TEXT,
    created_at            DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at            DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS planner_assets (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    type           TEXT NOT NULL CHECK(type IN ('staff','vehicle')),
    name           TEXT NOT NULL,
    role           TEXT,
    phone          TEXT,
    make_model     TEXT,
    registration   TEXT,
    capacity_notes TEXT,
    availability   TEXT DEFAULT 'available',
    notes          TEXT,
    created_at     DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS planner_events (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    title          TEXT NOT NULL,
    category       TEXT NOT NULL DEFAULT 'Quick Job',
    customer_name  TEXT,
    contact_number TEXT,
    address        TEXT,
    event_date     TEXT NOT NULL,
    event_time     TEXT,
    notes          TEXT,
    created_at     DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at     DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS planner_assignments (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    asset_id      INTEGER NOT NULL REFERENCES planner_assets(id) ON DELETE CASCADE,
    job_id        INTEGER REFERENCES crm_jobs(id) ON DELETE CASCADE,
    event_id      INTEGER REFERENCES planner_events(id) ON DELETE CASCADE,
    assigned_date TEXT NOT NULL,
    notes         TEXT,
    created_at    DATETIME DEFAULT CURRENT_TIMESTAMP
  );

`;

// ── Seed ──────────────────────────────────────────────────────────────────────
function seed() {
  if (_db.prepare('SELECT id FROM users WHERE role = ?').get('admin')) return;

  _db.prepare('INSERT INTO users (email, password_hash, name, role) VALUES (?, ?, ?, ?)')
    .run('admin@imove.co.uk', bcrypt.hashSync('admin123', 10), 'iMove Admin', 'admin');

  const u1 = _db.prepare('INSERT INTO users (email, password_hash, name, role) VALUES (?, ?, ?, ?)')
    .run('john@premierproperties.co.uk', bcrypt.hashSync('partner123', 10), 'John Smith', 'partner');
  const p1 = _db.prepare('INSERT INTO partners (user_id, agency_name, phone) VALUES (?, ?, ?)')
    .run(u1.lastInsertRowid, 'Premier Properties', '020 7123 4567');

  const u2 = _db.prepare('INSERT INTO users (email, password_hash, name, role) VALUES (?, ?, ?, ?)')
    .run('sarah@elitehomes.co.uk', bcrypt.hashSync('partner123', 10), 'Sarah Johnson', 'partner');
  const p2 = _db.prepare('INSERT INTO partners (user_id, agency_name, phone) VALUES (?, ?, ?)')
    .run(u2.lastInsertRowid, 'Elite Homes', '020 7234 5678');

  const ins = _db.prepare(`
    INSERT INTO leads
      (partner_id, client_name, current_address, destination_postcode,
       contact_number, email, estimated_moving_date, property_size,
       notes, move_stage, status, quote_value, commission_rate, commission_paid)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const p1id = p1.lastInsertRowid;
  const p2id = p2.lastInsertRowid;

  ins.run(p1id,'Michael & Emma Thompson','45 Oak Avenue, London, SW12 8TH','KT2 6QH','07700 900123','thompson@email.com','2024-05-15','3-bed','Large family move, some garden furniture','Exchanged','Survey Booked',1850,10,0);
  ins.run(p1id,'David Harris','12 Rose Street, London, SE5 9BG','RH1 1AA','07700 900456','david.harris@email.com','2024-06-01','1-bed','Studio flat contents only','Offer accepted','Contacted',null,10,0);
  ins.run(p1id,'The Patel Family','78 Elm Road, London, N4 2HQ','HA2 7NW','07700 900789','patel.family@email.com','2024-04-20','4-bed','Piano included – needs specialist handling','Ready to move','Job Completed',2800,10,0);
  ins.run(p1id,'Sophie Williams','23 Maple Close, London, E3 4QP','CM1 1BE','07700 900321','sophie.w@email.com','2024-04-10','2-bed','','Ready to move','Commission Paid',1200,10,1);
  ins.run(p1id,'Robert & Lisa Clarke','99 Cedar Street, London, N16 7XP','GU1 4AQ','07700 900654','clarkes@email.com','2024-07-20','5-bed','High-value property, fragile antiques','Exchanged','Quoted',4200,10,0);
  ins.run(p2id,'James Carter','99 Birch Lane, London, W3 8RT','OX1 1BP','07700 901234','james.carter@email.com','2024-07-01','3-bed','Has a storage unit too','Offer accepted','New Lead',null,10,0);
  ins.run(p2id,'Amanda Foster','14 Willow Way, London, SE22 9LN','BN1 1JH','07700 901567','amanda.foster@email.com','2024-06-15','2-bed','','Just listed','Contacted',null,10,0);
  ins.run(p2id,'George & Helen Marsh','7 Acacia Drive, London, SW4 7GH','BS1 4ST','07700 901890','marsh.family@email.com','2024-05-28','4-bed','Antique furniture, needs extra care','Ready to move','Quote Accepted',3100,12,0);

  console.log('✅ Database seeded');
  console.log('   Admin:   admin@imove.co.uk / admin123');
  console.log('   Partner: john@premierproperties.co.uk / partner123');
  console.log('   Partner: sarah@elitehomes.co.uk / partner123\n');
}

// ── CRM seed (runs independently so existing DBs get sample data too) ────────
function seedCRM() {
  if (_db.prepare('SELECT id FROM crm_jobs LIMIT 1').get()) return;

  const ins = _db.prepare(`
    INSERT INTO crm_jobs (
      full_name, email, phone, lead_source, estate_agent_name, status,
      from_line1, from_city, from_postcode,
      to_line1, to_city, to_postcode,
      bedrooms, survey_date, confirmed_move_date,
      quote_amount, quote_sent_date, quote_accepted,
      packing_required, internal_notes
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const act = _db.prepare(
    'INSERT INTO crm_activities (job_id, type, note, created_at) VALUES (?, ?, ?, ?)',
  );

  const j1 = ins.run('Tom & Jessica Wheeler', 'tom.wheeler@email.com', '07711 001122',
    'Estate Agent Referral', 'Premier Properties', 'Booked Move',
    '14 Chestnut Avenue', 'London', 'SW12 9PQ', '82 Maple Drive', 'Guildford', 'GU2 7AB',
    '3-bed', '2024-05-02', '2024-05-22', 1650, '2024-04-28', 1, 0,
    'Fragile antiques — handle with extra care');
  act.run(j1.lastInsertRowid, 'created',       'Lead imported from Premier Properties estate agent', '2024-04-20 09:00:00');
  act.run(j1.lastInsertRowid, 'status_change', 'Status changed from "New Lead" to "Survey Booked"',  '2024-04-21 11:00:00');
  act.run(j1.lastInsertRowid, 'status_change', 'Status changed from "Survey Booked" to "Quote Sent"','2024-04-28 14:30:00');
  act.run(j1.lastInsertRowid, 'status_change', 'Status changed from "Quote Sent" to "Booked Move"',  '2024-04-30 10:00:00');

  const j2 = ins.run('Priya Kapoor', 'priya.kapoor@email.com', '07722 334455',
    'Website', null, 'Awaiting Quote',
    '5 Victoria Street', 'London', 'E1 8AJ', '19 Station Road', 'Brighton', 'BN1 4GH',
    '2-bed', '2024-05-08', null, null, null, 0, 1, null);
  act.run(j2.lastInsertRowid, 'created',       'New enquiry via website contact form', '2024-04-25 14:00:00');
  act.run(j2.lastInsertRowid, 'status_change', 'Status changed from "New Lead" to "Survey Booked"',    '2024-04-26 09:00:00');
  act.run(j2.lastInsertRowid, 'status_change', 'Status changed from "Survey Booked" to "Awaiting Quote"', '2024-05-08 17:00:00');

  const j3 = ins.run('Oliver & Sophie Baines', 'oliver.baines@email.com', '07733 445566',
    'Estate Agent Referral', 'Elite Homes', 'Quote Sent',
    '33 Birch Grove', 'London', 'N4 3RT', '7 Cedar Lane', 'Oxford', 'OX1 2PL',
    '4-bed', null, '2024-06-10', 3200, '2024-05-01', 0, 0,
    'Piano in living room — needs specialist handling');
  act.run(j3.lastInsertRowid, 'created',       'Referred by Elite Homes estate agent',                '2024-04-22 10:00:00');
  act.run(j3.lastInsertRowid, 'status_change', 'Status changed from "New Lead" to "Quote Sent"',      '2024-05-01 09:00:00');
  act.run(j3.lastInsertRowid, 'note',          'Client confirmed they have a grand piano — booked specialist piano removals sub-contractor', '2024-05-01 09:30:00');

  const j4 = ins.run('Fatima Al-Hassan', 'fatima.h@email.com', '07744 556677',
    'Word of Mouth', null, 'Completed',
    '102 Elm Road', 'London', 'SE22 0TG', '44 Oak Street', 'Bristol', 'BS1 3BN',
    '1-bed', null, '2024-04-12', 780, '2024-03-28', 1, 0, null);
  act.run(j4.lastInsertRowid, 'created',       'New lead — word of mouth referral',                   '2024-03-20 11:00:00');
  act.run(j4.lastInsertRowid, 'status_change', 'Status changed from "New Lead" to "Quote Sent"',      '2024-03-28 13:00:00');
  act.run(j4.lastInsertRowid, 'status_change', 'Status changed from "Quote Sent" to "Booked Move"',   '2024-04-01 10:00:00');
  act.run(j4.lastInsertRowid, 'status_change', 'Status changed from "Booked Move" to "Completed"',    '2024-04-12 18:00:00');

  const j5 = ins.run('Marcus & Diana Collins', 'collins.family@email.com', '07755 667788',
    'Estate Agent Referral', 'Premier Properties', 'New Lead',
    '77 Poplar Close', 'London', 'N16 8WX', '31 Lime Street', 'Manchester', 'M1 2FJ',
    '5-bed+', null, null, null, null, 0, 0, null);
  act.run(j5.lastInsertRowid, 'created', 'Large family move enquiry — referred by Premier Properties', '2024-05-03 08:30:00');

  console.log('✅ CRM seed data added');
}

// ── Customer migration — create CRM jobs + customers from portal leads ───────
function migrateCustomers() {
  let customersCreated = 0;
  let jobsCreated      = 0;

  // Portal lead status → CRM status
  const PORTAL_TO_CRM = {
    'New Lead':        'New Lead',
    'Contacted':       'Contacted',
    'Survey Booked':   'Survey Booked',
    'Quoted':          'Quote Sent',
    'Quote Declined':  'Lost / Cancelled',
    'Quote Accepted':  'Quote Accepted',
    'Job Confirmed':   'In Progress',
    'Job Completed':   'Job Completed',
    'Commission Paid': 'Job Completed',
  };

  // ── Step 1: create CRM jobs for portal leads that don't have one ────────────
  const unlinkedLeads = _db.prepare(`
    SELECT l.*, p.agency_name, p.commission_rate
    FROM leads l
    JOIN partners p ON p.id = l.partner_id
    WHERE l.id NOT IN (SELECT lead_id FROM crm_jobs WHERE lead_id IS NOT NULL)
  `).all();

  for (const lead of unlinkedLeads) {
    const parts    = (lead.current_address || '').split(',').map(s => s.trim());
    const addrLine = parts[0] || null;
    const cityPart = parts.length > 2 ? parts[parts.length - 2] : (parts[1] || null);
    const crmStatus = PORTAL_TO_CRM[lead.status] || 'New Lead';

    const r = _db.prepare(`
      INSERT INTO crm_jobs (
        lead_id, full_name, email, phone,
        lead_source, estate_agent_name,
        from_line1, from_city, to_postcode,
        bedrooms, preferred_move_date,
        status, partner_commission_rate
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      lead.id, lead.client_name, lead.email || null, lead.contact_number || null,
      'Estate Agent Referral', lead.agency_name || null,
      addrLine, cityPart, lead.destination_postcode || null,
      lead.property_size || null, lead.estimated_moving_date || null,
      crmStatus, lead.commission_rate || null,
    );

    _db.prepare('INSERT INTO crm_activities (job_id, type, note) VALUES (?, ?, ?)')
      .run(r.lastInsertRowid, 'created',
        `Imported from Partner Portal — referred by ${lead.agency_name || 'estate agent'}`);
    jobsCreated++;
  }

  // ── Step 2: upsert customers for all crm_jobs that have no customer_id ──────
  function upsertCustomer(full_name, email, phone, address, city, postcode) {
    let cid = null;
    if (email) {
      const row = _db.prepare('SELECT id FROM crm_customers WHERE LOWER(email) = LOWER(?)').get(email);
      if (row) cid = row.id;
    }
    if (!cid && full_name) {
      const row = _db.prepare('SELECT id FROM crm_customers WHERE LOWER(full_name) = LOWER(?)').get(full_name);
      if (row) cid = row.id;
    }
    if (!cid) {
      const ins = _db.prepare(`
        INSERT INTO crm_customers (full_name, email, phone, address_line1, city, postcode)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(full_name, email || null, phone || null, address || null, city || null, postcode || null);
      cid = ins.lastInsertRowid;
      customersCreated++;
    }
    return cid;
  }

  const jobs = _db.prepare('SELECT * FROM crm_jobs WHERE customer_id IS NULL').all();
  for (const job of jobs) {
    const cid = upsertCustomer(
      job.full_name, job.email, job.phone,
      job.from_line1, job.from_city, job.from_postcode,
    );
    _db.prepare('UPDATE crm_jobs SET customer_id = ? WHERE id = ?').run(cid, job.id);
  }

  if (jobsCreated || customersCreated) {
    console.log(`✅ Migration: ${jobsCreated} CRM job(s) created from portal leads, ${customersCreated} customer(s) added`);
  }
}

// ── Planner asset seed ────────────────────────────────────────────────────────
function seedPlannerAssets() {
  if (_db.prepare('SELECT id FROM planner_assets LIMIT 1').get()) return;
  const ins = _db.prepare(`
    INSERT INTO planner_assets (type, name, role, phone, make_model, registration, availability)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  ins.run('staff',   'Mark',            'driver',  '07700 900001', null,              null,        'available');
  ins.run('staff',   'Dan',             'porter',  '07700 900002', null,              null,        'available');
  ins.run('vehicle', 'Renault Master',  null,       null,           'Renault Master',  'AB12 CDE',  'available');
  console.log('✅ Planner assets seeded (Mark, Dan, Renault Master)');
}

// ── Init (async, called once at server startup) ───────────────────────────────
async function initDatabase() {
  const SQL = await initSqlJs({
    locateFile: file => path.join(__dirname, '../node_modules/sql.js/dist/', file),
  });

  let sqlDb;
  if (fs.existsSync(DB_PATH)) {
    const buffer = fs.readFileSync(DB_PATH);
    sqlDb = new SQL.Database(buffer);
  } else {
    sqlDb = new SQL.Database();
  }

  // Enable foreign keys
  sqlDb.run('PRAGMA foreign_keys = ON');

  _db = makeWrapper(sqlDb);

  // Run schema (each statement individually to avoid multi-statement parse issues)
  for (const stmt of SCHEMA.split(';').map(s => s.trim()).filter(Boolean)) {
    sqlDb.run(stmt);
  }

  // Idempotent migrations for existing databases (ALTER TABLE ignores IF NOT EXISTS)
  const migrations = [
    `ALTER TABLE users ADD COLUMN avatar TEXT`,
    `ALTER TABLE partners ADD COLUMN payment_method TEXT`,
    `ALTER TABLE partners ADD COLUMN bank_account TEXT`,
    `ALTER TABLE partners ADD COLUMN bank_sort_code TEXT`,
    `ALTER TABLE partners ADD COLUMN gift_card_email TEXT`,
    `ALTER TABLE leads ADD COLUMN moving_date_type TEXT`,
    `ALTER TABLE leads ADD COLUMN move_type TEXT`,
    `ALTER TABLE leads ADD COLUMN property_type TEXT`,
    `ALTER TABLE leads ADD COLUMN floor_number TEXT`,
    `ALTER TABLE leads ADD COLUMN has_lift INTEGER`,
    `ALTER TABLE leads ADD COLUMN commission_paid_at TEXT`,
    `ALTER TABLE crm_jobs ADD COLUMN customer_id INTEGER REFERENCES crm_customers(id) ON DELETE SET NULL`,
    `ALTER TABLE crm_jobs ADD COLUMN referred_by_customer_id INTEGER REFERENCES crm_customers(id) ON DELETE SET NULL`,
    `ALTER TABLE crm_jobs ADD COLUMN partner_commission_rate REAL`,
    `ALTER TABLE crm_customers ADD COLUMN alt_email TEXT`,
    `ALTER TABLE crm_jobs ADD COLUMN floor_from TEXT`,
    `ALTER TABLE crm_jobs ADD COLUMN has_lift_from INTEGER DEFAULT 0`,
    `ALTER TABLE crm_jobs ADD COLUMN prop_type_from_other TEXT`,
    `ALTER TABLE crm_jobs ADD COLUMN floor_to TEXT`,
    `ALTER TABLE crm_jobs ADD COLUMN has_lift_to INTEGER DEFAULT 0`,
    `ALTER TABLE crm_jobs ADD COLUMN prop_type_to_other TEXT`,
    `ALTER TABLE crm_jobs ADD COLUMN move_type TEXT`,
    `ALTER TABLE crm_jobs ADD COLUMN is_key_worker INTEGER DEFAULT 0`,
    `ALTER TABLE crm_jobs ADD COLUMN bedrooms_to TEXT`,
    `ALTER TABLE crm_jobs ADD COLUMN parking_notes_to TEXT`,
    `ALTER TABLE crm_jobs ADD COLUMN alt_email TEXT`,
    `ALTER TABLE planner_assets ADD COLUMN sort_order INTEGER DEFAULT 0`,
  ];
  for (const m of migrations) {
    try { sqlDb.run(m); } catch (_) { /* column already exists — safe to ignore */ }
  }

  seed();
  seedCRM();
  seedPlannerAssets();
  migrateCustomers();
  // Backfill sort_order for any assets that have 0/null so ordering is stable
  try {
    const unordered = _db.prepare('SELECT id FROM planner_assets WHERE sort_order = 0 OR sort_order IS NULL ORDER BY id').all();
    if (unordered.length > 0) {
      const upd = _db.prepare('UPDATE planner_assets SET sort_order = ? WHERE id = ?');
      unordered.forEach((row, i) => upd.run(i + 1, row.id));
    }
  } catch (_) {}
}

module.exports = db;
