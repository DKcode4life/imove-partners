/**
 * Lightweight spam heuristics for public website intake.
 *
 * The /api/intake endpoint is the single chokepoint every website enquiry passes
 * through, so it's the right place to drop obvious bot submissions before they
 * reach the CRM pipeline or fire an admin email. Two signals, both pure and
 * unit-testable:
 *
 *   1. Honeypot — the website renders a hidden field a real user never sees.
 *      Bots that auto-fill every field populate it; humans leave it empty.
 *   2. Gibberish — random-letter names / emails / messages (no vowels, long
 *      consonant runs, or alternating case) that real enquiries don't produce.
 *
 * Deliberately conservative: gibberish blocks require TWO of the three text
 * fields to look fake, so a real customer with an odd email is never dropped.
 * Honeypot is definitive (zero false positives) on its own.
 */

// Hidden fields the website can include. They are NOT real intake fields, so a
// non-empty value can only come from a bot. `website` is the recommended one.
const HONEYPOT_FIELDS = ['website', 'url', 'company_website', 'email_confirm', 'nickname'];

// y counts as a vowel so consonant-cluster names like "Lynch" aren't flagged.
const VOWELS = new Set(['a', 'e', 'i', 'o', 'u', 'y']);

// Tokens shorter than this carry too little signal to judge (real short names
// like "Ng", "Li", "Jo" must always pass).
const MIN_TOKEN_LEN = 5;
const MAX_CONSONANT_RUN = 5;   // "Strength" peaks at 4; 5+ is random-string territory
const MAX_CASE_SWITCHES = 4;   // CamelCase names ("McDonald") peak at 3

/** Letter-only tokens, original case preserved. */
function splitTokens(str) {
  return String(str || '').match(/[A-Za-z]+/g) || [];
}

/** Longest run of consecutive consonants in a lowercased token. */
function maxConsonantRun(lower) {
  let max = 0;
  let cur = 0;
  for (const ch of lower) {
    if (VOWELS.has(ch)) {
      cur = 0;
    } else {
      cur += 1;
      if (cur > max) max = cur;
    }
  }
  return max;
}

/** Count upper↔lower transitions ("aBcD" → 3). Random case noise spikes this. */
function caseSwitches(token) {
  let switches = 0;
  for (let i = 1; i < token.length; i += 1) {
    const prevUpper = token[i - 1] >= 'A' && token[i - 1] <= 'Z';
    const curUpper = token[i] >= 'A' && token[i] <= 'Z';
    if (prevUpper !== curUpper) switches += 1;
  }
  return switches;
}

/** Does a single word look like random letters? */
function tokenLooksGibberish(token) {
  if (token.length < MIN_TOKEN_LEN) return false;
  const lower = token.toLowerCase();
  let vowelCount = 0;
  for (const ch of lower) if (VOWELS.has(ch)) vowelCount += 1;
  if (vowelCount === 0) return true;                       // no vowel in a long word
  if (maxConsonantRun(lower) >= MAX_CONSONANT_RUN) return true;
  if (caseSwitches(token) >= MAX_CASE_SWITCHES) return true;
  return false;
}

/**
 * Does a string (name, email local part, or message) read as gibberish?
 * True when at least half of its long-enough tokens look random. Short strings
 * with no long tokens are never gibberish.
 */
function looksGibberish(str) {
  const tokens = splitTokens(str).filter(t => t.length >= MIN_TOKEN_LEN);
  if (tokens.length === 0) return false;
  const bad = tokens.filter(tokenLooksGibberish).length;
  return bad / tokens.length >= 0.5;
}

/** True when any honeypot field arrived non-empty. */
function honeypotTripped(body) {
  if (!body || typeof body !== 'object') return false;
  return HONEYPOT_FIELDS.some(f => typeof body[f] === 'string' && body[f].trim() !== '');
}

/**
 * Decide whether a website submission should be blocked as spam.
 * @param {{ full_name?:string, email?:string, message?:string, body?:object }} input
 * @returns {{ blocked:boolean, reason:string|null }}
 */
function evaluateSubmission({ full_name = '', email = '', message = '', body = {} } = {}) {
  if (honeypotTripped(body)) return { blocked: true, reason: 'honeypot' };

  const signals = [];
  if (looksGibberish(full_name)) signals.push('name');
  const emailLocal = String(email || '').split('@')[0];
  if (looksGibberish(emailLocal)) signals.push('email');
  if (message && looksGibberish(message)) signals.push('message');

  if (signals.length >= 2) {
    return { blocked: true, reason: `gibberish:${signals.join('+')}` };
  }
  return { blocked: false, reason: null };
}

module.exports = {
  evaluateSubmission,
  honeypotTripped,
  looksGibberish,
  HONEYPOT_FIELDS,
};
