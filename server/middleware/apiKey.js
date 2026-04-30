const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const prisma = require('../db/prisma');
const config = require('../config');

/**
 * Authenticate using an API key (Bearer token)
 * 
 * Supports two authentication methods:
 * 1. Environment variable (API_KEY) - simple exact match, no DB required
 * 2. Database lookup - full bcrypt verification with scopes, expiry, audit trail
 * 
 * Expects: Authorization: Bearer <key>
 * 
 * On success:
 * - Sets req.apiKey = { id, name, scopes, ... }
 * - Sets req.user = { role: 'api', apiKeyId, name: apiKey.name } for compatibility with existing auth
 * - Updates last_used_at and last_used_ip (fire-and-forget, database keys only)
 * 
 * On failure: Returns 401/403 with error message
 */
async function authenticateApiKey(req, res, next) {
  const authHeader = req.headers.authorization;
  
  // Check for Bearer token
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    console.warn('[apiKey] No Bearer token in Authorization header');
    return res.status(401).json({ error: 'No API key provided. Use Authorization: Bearer <key>' });
  }

  const fullKey = authHeader.slice(7).trim();
  
  // Validate key format - must start with imv_ but length can vary for env keys
  if (!fullKey.startsWith('imv_')) {
    console.warn('[apiKey] Key does not start with imv_:', fullKey.substring(0, 10) + '...');
    return res.status(401).json({ error: 'Invalid API key format. Expected: imv_<key>' });
  }

  // ─── TIER 1: Environment variable authentication ─────────────────────────────
  // Check if API_KEY environment variable is set and matches
  if (process.env.API_KEY) {
    // Use constant-time comparison to prevent timing attacks
    const envKey = process.env.API_KEY.trim();
    const isEnvMatch = crypto.timingSafeEqual(
      Buffer.from(fullKey, 'utf8'),
      Buffer.from(envKey, 'utf8')
    );
    
    if (isEnvMatch) {
      console.log('[apiKey] Authenticated via environment variable');
      
      // Attach API key info to request
      req.apiKey = {
        id: 0, // Special ID for env keys
        name: 'Environment Key',
        scopes: ['crm:read', 'crm:write'],
        keyPrefix: fullKey.substring(0, Math.min(11, fullKey.length)),
        source: 'env',
      };

      // For compatibility with existing auth middleware and audit logging
      req.user = {
        role: 'api',
        apiKeyId: 0,
        name: 'Environment Key',
        id: 0, // Zero ID for env keys
      };

      return next();
    } else {
      console.warn('[apiKey] Environment variable mismatch');
    }
  }

  // ─── TIER 2: Database authentication ───────────────────────────────────────
  // For database keys, we expect the standard format: imv_ + 48 hex chars
  if (fullKey.length !== 52) { // "imv_" + 48 hex chars
    console.warn('[apiKey] Database key length mismatch:', fullKey.length, 'expected 52');
    return res.status(401).json({ error: 'Invalid API key format. Expected: imv_<48-hex-chars>' });
  }

  const keyPrefix = fullKey.substring(0, 11); // "imv_" + 7 chars

  try {
    // Look up API key by prefix
    const apiKey = await prisma.apiKey.findUnique({
      where: { key_prefix: keyPrefix },
    });

    if (!apiKey) {
      console.warn('[apiKey] No database entry for prefix:', keyPrefix);
      return res.status(401).json({ error: 'Invalid API key' });
    }

    // Check if key is active
    if (!apiKey.is_active) {
      console.warn('[apiKey] Key inactive:', apiKey.name);
      return res.status(403).json({ error: 'API key is inactive' });
    }

    // Check expiration
    if (apiKey.expires_at && new Date() > apiKey.expires_at) {
      console.warn('[apiKey] Key expired:', apiKey.name, 'expired at', apiKey.expires_at);
      return res.status(403).json({ error: 'API key has expired' });
    }

    // Verify the key hash
    const isValid = await bcrypt.compare(fullKey, apiKey.key_hash);
    if (!isValid) {
      console.warn('[apiKey] bcrypt verification failed for:', apiKey.name);
      return res.status(401).json({ error: 'Invalid API key' });
    }

    // Update last used timestamp and IP (fire-and-forget, don't block response)
    updateLastUsed(apiKey.id, req.ip);

    // Attach API key info to request
    req.apiKey = {
      id: apiKey.id,
      name: apiKey.name,
      scopes: apiKey.scopes.split(','),
      keyPrefix: apiKey.key_prefix,
      source: 'db',
    };

    // For compatibility with existing auth middleware and audit logging
    req.user = {
      role: 'api',
      apiKeyId: apiKey.id,
      name: apiKey.name,
      id: -apiKey.id, // Negative ID to distinguish from real users
    };

    console.log('[apiKey] Authenticated via database:', apiKey.name);
    next();
  } catch (error) {
    console.error('[apiKey] Authentication error:', error);
    return res.status(500).json({ error: 'Internal server error during authentication' });
  }
}

/**
 * Update last_used_at and last_used_ip for an API key
 * Runs in background, doesn't block the request
 */
async function updateLastUsed(apiKeyId, ip) {
  try {
    await prisma.apiKey.update({
      where: { id: apiKeyId },
      data: {
        last_used_at: new Date(),
        last_used_ip: ip || null,
      },
    });
  } catch (error) {
    // Log but don't fail the request
    console.error('[apiKey] Failed to update last used:', error.message);
  }
}

/**
 * Middleware to check if API key has required scopes
 * 
 * Usage: requireScope('crm:read')
 *        requireScope(['crm:read', 'crm:write'])
 */
function requireScope(requiredScopes) {
  return (req, res, next) => {
    if (!req.apiKey) {
      return res.status(401).json({ error: 'API key authentication required' });
    }

    const scopes = Array.isArray(requiredScopes) ? requiredScopes : [requiredScopes];
    const hasScope = scopes.every(scope => req.apiKey.scopes.includes(scope));

    if (!hasScope) {
      return res.status(403).json({ 
        error: `Insufficient permissions. Required scope(s): ${scopes.join(', ')}`,
        available_scopes: req.apiKey.scopes,
      });
    }

    next();
  };
}

/**
 * Combined authentication that accepts either JWT or API key
 * Useful for routes that should work for both web users and API integrations
 */
async function authenticateAny(req, res, next) {
  const authHeader = req.headers.authorization;
  
  if (!authHeader) {
    return res.status(401).json({ error: 'No authentication provided' });
  }

  // Try API key first (Bearer token starting with imv_)
  if (authHeader.startsWith('Bearer ') && authHeader.slice(7).trim().startsWith('imv_')) {
    return authenticateApiKey(req, res, next);
  }

  // Otherwise try JWT (delegate to existing authenticate middleware)
  // We'll require the user to import and use both middlewares in their route
  // This is just a convenience wrapper
  next(new Error('Use authenticateApiKey or authenticate middleware directly'));
}

module.exports = {
  authenticateApiKey,
  requireScope,
  authenticateAny,
};