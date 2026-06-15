/**
 * Online quote-acceptance helpers.
 *
 * When a customer opens the /accept/:token page they see the mandatory move
 * service (always included) plus any optional services as opt-in checkboxes,
 * declare the value of their items for insurance, agree to the terms, and
 * submit. These pure helpers handle the token, the recompute of the firm total
 * from the customer's selection, and validation of the submitted payload — all
 * without touching the database so they can be unit-tested in isolation.
 */
const crypto = require('crypto');

/** Largest sane declared item value we'll accept (£10m) — guards typos/abuse. */
const MAX_DECLARED_VALUE = 10_000_000;

/**
 * Mint an unguessable token for the customer-facing acceptance link.
 * 48 hex chars = 24 random bytes ≈ 192 bits of entropy.
 * @returns {string}
 */
function generateAcceptToken() {
  return crypto.randomBytes(24).toString('hex');
}

/**
 * Split a quote's line items into the mandatory set and the optional set.
 * @param {Array<{id:number, is_optional?:boolean}>} items
 * @returns {{ mandatory: Array, optional: Array }}
 */
function splitItems(items) {
  const list = Array.isArray(items) ? items : [];
  return {
    mandatory: list.filter((i) => !i.is_optional),
    optional: list.filter((i) => i.is_optional),
  };
}

/**
 * Recompute the firm totals for an acceptance from the customer's selection.
 *
 * The accepted set is every mandatory item plus the optional items whose ids
 * appear in `selectedOptionalIds`. VAT is re-derived from the original quote's
 * tax_rate only when the original quote actually charged VAT (tax_amount > 0),
 * matching how the quote was presented.
 *
 * @param {Object}  opts
 * @param {Array}   opts.items               all quote items
 * @param {number[]} opts.selectedOptionalIds optional item ids the customer ticked
 * @param {number}  [opts.taxRate=20]        VAT rate from the original quote
 * @param {boolean} [opts.vatApplied=false]  whether the original quote charged VAT
 * @returns {{ acceptedItems:Array, subtotal:number, taxRate:number, taxAmount:number, total:number }}
 */
function computeAcceptedTotals({ items, selectedOptionalIds = [], taxRate = 20, vatApplied = false }) {
  const selected = new Set((selectedOptionalIds || []).map(Number));
  const acceptedItems = (Array.isArray(items) ? items : []).filter(
    (i) => !i.is_optional || selected.has(Number(i.id)),
  );

  const subtotal = acceptedItems.reduce((sum, i) => sum + (Number(i.total) || 0), 0);
  const rate = vatApplied ? Number(taxRate) || 0 : 0;
  const taxAmount = vatApplied ? round2(subtotal * (rate / 100)) : 0;
  const total = round2(subtotal + taxAmount);

  return { acceptedItems, subtotal: round2(subtotal), taxRate: rate, taxAmount, total };
}

/** Round to 2dp, dodging binary-float drift (e.g. 1.005 → 1.01). */
function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

/**
 * Validate the JSON body posted from the acceptance form.
 *
 * @param {Object} body
 * @param {Array<{id:number, is_optional?:boolean}>} quoteItems  items belonging to the quote
 * @returns {{ ok:boolean, errors:string[], selectedOptionalIds:number[], declaredValue:number }}
 */
function validateAcceptancePayload(body, quoteItems) {
  const errors = [];
  const b = body || {};

  // Terms must be explicitly agreed.
  if (b.accept_terms !== true) {
    errors.push('You must agree to the terms and conditions to proceed.');
  }

  // Declared value: required positive number within bounds.
  const declaredValue = Number(b.declared_value);
  if (!Number.isFinite(declaredValue) || declaredValue <= 0) {
    errors.push('Please enter the value of your items for insurance cover.');
  } else if (declaredValue > MAX_DECLARED_VALUE) {
    errors.push('The declared value looks too high — please check and try again.');
  }

  // Selected optional ids must be a subset of this quote's optional items.
  const optionalIds = new Set(
    (Array.isArray(quoteItems) ? quoteItems : [])
      .filter((i) => i.is_optional)
      .map((i) => Number(i.id)),
  );
  const rawSelected = Array.isArray(b.selected_optional_ids) ? b.selected_optional_ids : [];
  const selectedOptionalIds = [];
  for (const raw of rawSelected) {
    const id = Number(raw);
    if (!optionalIds.has(id)) {
      errors.push('One or more selected services are no longer available.');
      break;
    }
    selectedOptionalIds.push(id);
  }

  return {
    ok: errors.length === 0,
    errors,
    selectedOptionalIds,
    declaredValue: Number.isFinite(declaredValue) ? round2(declaredValue) : 0,
  };
}

module.exports = {
  MAX_DECLARED_VALUE,
  generateAcceptToken,
  splitItems,
  computeAcceptedTotals,
  validateAcceptancePayload,
  round2,
};
