/**
 * Access to the hosted Terms & Conditions PDF.
 *
 * The file is generated from server/lib/terms-content.js by
 * scripts/generate-terms-pdf.js and committed at server/assets/. This module is
 * the single source of truth for its path so the serve route (GET
 * /api/public/terms) and the fixed-quote email attachment stay in sync.
 */
const fs = require('fs');
const path = require('path');

const TERMS_PDF_PATH = path.join(__dirname, '..', 'assets', 'imove-terms-and-conditions.pdf');
const TERMS_FILENAME = 'iMove-Terms-and-Conditions.pdf';

/** Read the committed T&C PDF, or null if it hasn't been generated yet. */
function readTermsBuffer() {
  try {
    return fs.readFileSync(TERMS_PDF_PATH);
  } catch {
    return null;
  }
}

/** Email-attachment object for the T&C PDF, or null if the file is missing. */
function termsAttachment() {
  const content = readTermsBuffer();
  if (!content) return null;
  return { filename: TERMS_FILENAME, content, contentType: 'application/pdf' };
}

module.exports = { TERMS_PDF_PATH, TERMS_FILENAME, readTermsBuffer, termsAttachment };
