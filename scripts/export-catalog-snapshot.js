#!/usr/bin/env node
/**
 * Exports the local inventory catalog (with custom icons) to a JSON snapshot
 * file. The seed script picks this snapshot up on first deploy and restores
 * it to the production DB.
 *
 * Usage: node scripts/export-catalog-snapshot.js
 */

const fs = require('fs');
const path = require('path');
const { PrismaClient } = require('@prisma/client');

async function main() {
  const prisma = new PrismaClient();
  const row = await prisma.companySetting.findUnique({ where: { key: 'inventory-catalog' } });
  if (!row?.value) {
    console.error('No catalog row found in local DB. Open the admin Inventory page first to populate it.');
    process.exit(1);
  }

  const catalog = JSON.parse(row.value);
  const itemCount = catalog.reduce((sum, c) => sum + (c.items?.length || 0), 0);
  const customIconCount = catalog.reduce(
    (sum, c) => sum + (c.items || []).filter(i => typeof i.icon === 'string' && i.icon.startsWith('data:image')).length,
    0,
  );

  const outPath = path.join(__dirname, '..', 'prisma', 'catalog-snapshot.json');
  fs.writeFileSync(outPath, row.value);

  console.log('\nCatalog snapshot exported.');
  console.log(`  Categories      : ${catalog.length}`);
  console.log(`  Items           : ${itemCount}`);
  console.log(`  Custom icons    : ${customIconCount}`);
  console.log(`  Snapshot size   : ${(row.value.length / 1024).toFixed(1)} KB`);
  console.log(`  Written to      : ${path.relative(process.cwd(), outPath)}\n`);

  await prisma.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
