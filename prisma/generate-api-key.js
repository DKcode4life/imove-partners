#!/usr/bin/env node

/**
 * Generate a new API key for external integrations (AI assistants, third-party systems)
 * 
 * Usage: node prisma/generate-api-key.js "Key Name" [--expires YYYY-MM-DD]
 * 
 * Example: node prisma/generate-api-key.js "Claude AI Assistant" --expires 2026-12-31
 */

const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function main() {
  const args = process.argv.slice(2);
  
  if (args.length === 0 || args[0] === '--help') {
    console.log(`
Usage: node prisma/generate-api-key.js "Key Name" [--expires YYYY-MM-DD]

Options:
  --expires YYYY-MM-DD  Optional expiration date (default: never expires)
  --help                Show this help message

Examples:
  node prisma/generate-api-key.js "Claude AI Assistant"
  node prisma/generate-api-key.js "Zapier Integration" --expires 2026-12-31
    `);
    process.exit(0);
  }

  const name = args[0];
  let expiresAt = null;

  // Parse optional --expires argument
  for (let i = 1; i < args.length; i++) {
    if (args[i] === '--expires' && args[i + 1]) {
      const dateStr = args[i + 1];
      const date = new Date(dateStr);
      if (isNaN(date.getTime())) {
        console.error(`❌ Invalid date format: ${dateStr}. Use YYYY-MM-DD format.`);
        process.exit(1);
      }
      expiresAt = date;
      i++; // Skip the date value
    }
  }

  // Generate a secure random key (48 hex chars = 192 bits)
  const fullKey = `imv_${crypto.randomBytes(24).toString('hex')}`;
  const keyPrefix = fullKey.substring(0, 11); // "imv_" + 7 chars = 11 chars total

  // Hash the full key with bcrypt
  const saltRounds = 12;
  const keyHash = await bcrypt.hash(fullKey, saltRounds);

  try {
    // Insert into database
    const apiKey = await prisma.apiKey.create({
      data: {
        name,
        key_prefix: keyPrefix,
        key_hash: keyHash,
        scopes: 'crm:read,crm:write',
        is_active: true,
        expires_at: expiresAt,
      },
    });

    console.log(`
✅ API key created: "${name}"
   ID: ${apiKey.id}
   Prefix: ${keyPrefix}
   Scopes: ${apiKey.scopes}
   Active: ${apiKey.is_active}
   Created: ${apiKey.created_at.toISOString()}
   ${expiresAt ? `Expires: ${expiresAt.toISOString().split('T')[0]}` : 'Expires: Never'}

⚠️  SAVE THIS KEY NOW — it will NOT be shown again:

   ${fullKey}

📋 Use it as: Authorization: Bearer ${fullKey}

🔒 Security notes:
   • Store this key securely (e.g., password manager, environment variable)
   • The key is hashed in the database and cannot be retrieved
   • To revoke: UPDATE api_keys SET is_active = false WHERE id = ${apiKey.id}
   • To delete: DELETE FROM api_keys WHERE id = ${apiKey.id}
    `);

  } catch (error) {
    console.error('❌ Failed to create API key:', error.message);
    if (error.code === 'P2002') {
      console.error('   Key prefix already exists. Try running again.');
    }
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch(error => {
  console.error('❌ Unexpected error:', error);
  process.exit(1);
});