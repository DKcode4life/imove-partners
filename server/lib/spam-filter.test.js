const { test } = require('node:test');
const assert = require('node:assert');
const { evaluateSubmission, looksGibberish, honeypotTripped } = require('./spam-filter');

// ─── Real submissions must always pass ──────────────────────────────────────
test('genuine names and emails are not gibberish', () => {
  for (const s of ['John Smith', 'Mohammed Al-Rashid', "O'Brien", 'Wright', 'Lynch', 'Brown', 'McDonald', 'Nguyen', 'Krishnan']) {
    assert.strictEqual(looksGibberish(s), false, `"${s}" should pass`);
  }
  assert.strictEqual(looksGibberish('john.smith'), false);
  assert.strictEqual(looksGibberish('A normal message asking for a quote on a 3 bedroom move'), false);
});

test('a real enquiry is not blocked', () => {
  const r = evaluateSubmission({
    full_name: 'John Smith',
    email: 'john.smith@gmail.com',
    message: 'Hi, please can I get a quote for a move next month?',
    body: {},
  });
  assert.strictEqual(r.blocked, false);
});

test('an odd-but-real email alone does not block (needs two signals)', () => {
  // Gibberish-ish email local, but a real name and message → only 1 signal.
  const r = evaluateSubmission({
    full_name: 'Sarah Jones',
    email: 'xkcdfvbnmqp@gmail.com',
    message: 'Could you call me about a house move please',
    body: {},
  });
  assert.strictEqual(r.blocked, false);
});

// ─── Gibberish detection ────────────────────────────────────────────────────
test('random-letter strings read as gibberish', () => {
  for (const s of ['Xqwkzpjr', 'asdfghjkl', 'bvdfghn', 'Zxcvbnmlk']) {
    assert.strictEqual(looksGibberish(s), true, `"${s}" should be gibberish`);
  }
});

test('alternating-case noise is gibberish', () => {
  assert.strictEqual(looksGibberish('aBcDeFgH'), true);
});

// ─── Whole-submission blocking ──────────────────────────────────────────────
test('two gibberish fields are blocked', () => {
  const r = evaluateSubmission({
    full_name: 'Xqwkzpjr Bvdfghn',
    email: 'qwxzkjpt@mailinator.com',
    message: '',
    body: {},
  });
  assert.strictEqual(r.blocked, true);
  assert.match(r.reason, /gibberish/);
});

test('gibberish name + gibberish message is blocked', () => {
  const r = evaluateSubmission({
    full_name: 'Zxcvbnmlk',
    email: 'real.person@gmail.com',
    message: 'asdfghjkl qwertyuiop zxcvbnmlk plkjhgfdsa',
    body: {},
  });
  assert.strictEqual(r.blocked, true);
});

// ─── Honeypot ───────────────────────────────────────────────────────────────
test('a filled honeypot field is blocked outright', () => {
  assert.strictEqual(honeypotTripped({ website: 'http://spam.example' }), true);
  assert.strictEqual(honeypotTripped({ website: '' }), false);
  assert.strictEqual(honeypotTripped({}), false);

  const r = evaluateSubmission({
    full_name: 'John Smith',
    email: 'john@gmail.com',
    body: { website: 'http://spam.example' },
  });
  assert.strictEqual(r.blocked, true);
  assert.strictEqual(r.reason, 'honeypot');
});
