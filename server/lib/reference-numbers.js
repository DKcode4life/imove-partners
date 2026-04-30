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
  estimate: { prefix: 'EST', model: 'quote',   field: 'quote_number'   },
  fixed:    { prefix: 'iMQ', model: 'quote',   field: 'quote_number'   },
  deposit:  { prefix: 'DEP', model: 'invoice', field: 'invoice_number' },
  main:     { prefix: 'INV', model: 'invoice', field: 'invoice_number' },
};

/**
 * Compute the next reference number for the given type.
 *
 * Implementation:
 *   1. Pull every existing row whose number starts with `{PREFIX}-`.
 *   2. Parse the trailing digits (ignoring any rows we can't parse — e.g.
 *      legacy 6/8-digit timestamp-style numbers).
 *   3. Return `{PREFIX}-{max+1}` zero-padded to 5 digits.
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

  let max = 0;
  for (const r of rows) {
    const value = r[field];
    if (!value) continue;
    // Match trailing digits (handles both EST-00001 and legacy EST-882341)
    const m = value.match(/-(\d+)$/);
    if (!m) continue;
    const n = parseInt(m[1], 10);
    if (Number.isFinite(n) && n > max) max = n;
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
