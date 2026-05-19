/**
 * Shared sequential reference-number generator for quotes and invoices.
 *
 * All reference numbers are GLOBAL per type (not per-job) — the same way
 * accountants number invoices: EST-00001 is the very first estimate ever
 * issued; the next estimate (even on a different job) is EST-00002, etc.
 *
 * Format:   {PREFIX}-{5 zero-padded digits}
 * Examples: EST-00001, iMQ-00042, DEP-00007, INV-00118
 *
 * The prefix → model+field mapping is centralised here so both the quotes
 * and invoices routes stay consistent.
 */

const REFERENCE_TYPES = {
  estimate:   { prefix: 'EST', model: 'quote',           field: 'quote_number'   },
  fixed:      { prefix: 'iMQ', model: 'quote',           field: 'quote_number'   },
  deposit:    { prefix: 'DEP', model: 'invoice',         field: 'invoice_number' },
  main:       { prefix: 'INV', model: 'invoice',         field: 'invoice_number' },
  additional: { prefix: 'ADC', model: 'invoice',         field: 'invoice_number' },
  contract:   { prefix: 'CIN', model: 'contractInvoice', field: 'invoice_number' },
};

/**
 * The first issued number for any new prefix is 100 — i.e. the very first
 * estimate ever sent is EST-00100, the first fixed quote is iMQ-00100, etc.
 * From there each new document increments by 1 (00101, 00102, …).
 */
const START_AT = 100;

/**
 * Upper bound for "canonical" reference numbers we'll respect when computing
 * the next one. Any row whose trailing digits exceed this is treated as
 * legacy garbage (e.g. timestamp-based numbers like EST-896956 from the old
 * generator) and ignored — otherwise a single bad row would push the entire
 * sequence into the millions.
 *
 * Set to 99_999 — the canonical 5-digit format. Anything bigger is treated
 * as legacy junk and ignored. If we ever organically reach 100k documents
 * of any single type we can bump this up; until then 5-digit refs are the
 * source of truth.
 */
const MAX_CANONICAL = 99999;

/**
 * Compute the next reference number for the given type.
 *
 * Implementation:
 *   1. Pull every existing row whose number starts with `{PREFIX}-`.
 *   2. Parse the trailing digits (ignoring any rows we can't parse — e.g.
 *      legacy junk).
 *   3. Return `{PREFIX}-{max+1}` zero-padded to 5 digits, where `max` is
 *      seeded at `START_AT - 1` so the first issued number is always 100.
 *
 * Note: a true race between two simultaneous requests is still possible —
 * the unique constraint on the column will reject the loser, which is why
 * `nextReferenceNumberWithRetry` exists below.
 *
 * @param {import('@prisma/client').PrismaClient} prisma
 * @param {'estimate'|'fixed'|'deposit'|'main'} type
 * @returns {Promise<string>}
 */
async function nextReferenceNumber(prisma, type) {
  const cfg = REFERENCE_TYPES[type];
  if (!cfg) {
    throw new Error(`Unknown reference number type: "${type}"`);
  }

  const { prefix, model, field } = cfg;

  // Prisma model accessor on the client is camelCase ('quote', 'invoice').
  const rows = await prisma[model].findMany({
    where: { [field]: { startsWith: `${prefix}-` } },
    select: { [field]: true },
  });

  // Seed at (START_AT - 1) so the very first issued number is START_AT (100).
  let max = START_AT - 1;
  for (const r of rows) {
    const value = r[field];
    if (!value) continue;
    const m = value.match(/-(\d+)$/);
    if (!m) continue;
    const n = parseInt(m[1], 10);
    // Skip non-canonical rows whose trailing digits are absurdly large
    // (e.g. timestamp-based legacy numbers like EST-896956) so they don't
    // poison the sequence and push every new ref into the millions.
    if (!Number.isFinite(n) || n > MAX_CANONICAL) continue;
    if (n > max) max = n;
  }

  const next = String(max + 1).padStart(5, '0');
  return `${prefix}-${next}`;
}

/**
 * Convenience wrapper that retries reference-number generation if the
 * resulting INSERT collides with the column's unique constraint (rare but
 * possible under concurrent requests).
 *
 * @param {import('@prisma/client').PrismaClient} prisma
 * @param {'estimate'|'fixed'|'deposit'|'main'} type
 * @param {(number: string) => Promise<any>} createFn  Receives the candidate
 *        reference number, performs the create, and returns the created row.
 * @param {number} [maxAttempts=5]
 * @returns {Promise<any>}  The result of `createFn`.
 */
async function nextReferenceNumberWithRetry(prisma, type, createFn, maxAttempts = 5) {
  let lastErr;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const candidate = await nextReferenceNumber(prisma, type);
    try {
      return await createFn(candidate);
    } catch (err) {
      // Prisma unique-constraint violation is P2002.
      if (err && (err.code === 'P2002' || /unique/i.test(err?.message || ''))) {
        lastErr = err;
        // Loop again to compute a fresh candidate.
        continue;
      }
      throw err;
    }
  }
  throw lastErr || new Error('Failed to generate unique reference number after retries');
}

module.exports = {
  REFERENCE_TYPES,
  nextReferenceNumber,
  nextReferenceNumberWithRetry,
};
