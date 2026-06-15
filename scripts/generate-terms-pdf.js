/**
 * Generate the hosted iMove Terms & Conditions PDF.
 *
 * Renders server/lib/terms-content.js via services/pdf.js → generateTermsPDF
 * and writes it to server/assets/imove-terms-and-conditions.pdf. The result is
 * committed so it can be served statically and attached to fixed-quote emails.
 *
 * Re-run after editing terms-content.js:
 *     node scripts/generate-terms-pdf.js
 */
const fs = require('fs');
const path = require('path');
const { generateTermsPDF } = require('../server/services/pdf');

const OUT_PATH = path.join(__dirname, '..', 'server', 'assets', 'imove-terms-and-conditions.pdf');

(async () => {
  const pdf = await generateTermsPDF();
  fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true });
  fs.writeFileSync(OUT_PATH, pdf.buffer);
  console.log(`✅ Wrote ${OUT_PATH} (${(pdf.buffer.length / 1024).toFixed(1)} KB)`);
})().catch((e) => {
  console.error('❌ Failed to generate terms PDF:', e);
  process.exit(1);
});
