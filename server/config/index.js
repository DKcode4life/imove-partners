require('dotenv').config();

const required = ['DATABASE_URL', 'JWT_SECRET'];
for (const key of required) {
  if (!process.env[key]) {
    console.error(`Missing required environment variable: ${key}`);
    console.error('Copy .env.example to .env and fill in the values.');
    process.exit(1);
  }
}

// Comma-separated list of allowed CORS origins in production.
// Defaults cover the two myimove.co.uk subdomains; override via CORS_ORIGINS to extend.
const PROD_DEFAULT_ORIGINS = [
  'https://partners.myimove.co.uk',
  'https://crm.myimove.co.uk',
];
const DEV_DEFAULT_ORIGINS = [
  'http://localhost:5173',
  'http://localhost:3000',
];

function parseOrigins(raw, fallback) {
  if (!raw) return fallback;
  return raw.split(',').map(s => s.trim()).filter(Boolean);
}

const env = process.env.NODE_ENV || 'development';

module.exports = {
  env,
  port: parseInt(process.env.PORT || '3001', 10),
  databaseUrl: process.env.DATABASE_URL,
  jwtSecret: process.env.JWT_SECRET,

  corsOrigins: parseOrigins(
    process.env.CORS_ORIGINS,
    env === 'production' ? PROD_DEFAULT_ORIGINS : DEV_DEFAULT_ORIGINS,
  ),

  crmUrl: process.env.CRM_URL || 'https://crm.myimove.co.uk',

  email: {
    provider: process.env.EMAIL_PROVIDER || '',
    from: process.env.EMAIL_FROM || 'iMove <noreply@imovepartners.co.uk>',
    smtp: {
      host: process.env.SMTP_HOST || '',
      port: parseInt(process.env.SMTP_PORT || '587', 10),
      user: process.env.SMTP_USER || '',
      pass: process.env.SMTP_PASS || '',
    },
    resendApiKey: process.env.RESEND_API_KEY || '',
  },

  stripe: {
    secretKey: process.env.STRIPE_SECRET_KEY || '',
    webhookSecret: process.env.STRIPE_WEBHOOK_SECRET || '',
  },

  google: {
    clientId: process.env.GOOGLE_CLIENT_ID || '',
    clientSecret: process.env.GOOGLE_CLIENT_SECRET || '',
    redirectUri: process.env.GOOGLE_REDIRECT_URI || '',
  },

  storage: {
    provider: process.env.STORAGE_PROVIDER || 'local',
    localDir: process.env.STORAGE_LOCAL_DIR || './uploads',
    s3: {
      bucket: process.env.S3_BUCKET || '',
      region: process.env.S3_REGION || '',
      accessKey: process.env.S3_ACCESS_KEY || '',
      secretKey: process.env.S3_SECRET_KEY || '',
    },
  },
};
