'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const {
  OFFSET_PRESETS,
  MAX_OFFSET_DAYS,
  MAX_DAYS,
  offsetLabel,
  addDaysIso,
  scheduleAnchor,
  normalizeSchedule,
  expandSchedule,
  jobValidDates,
  scheduleDayForDate,
} = require('./move-schedule');

test('offsetLabel: singular/plural and direction', () => {
  assert.equal(offsetLabel(-1), '1 day before');
  assert.equal(offsetLabel(-2), '2 days before');
  assert.equal(offsetLabel(1), '1 day after');
  assert.equal(offsetLabel(4), '4 days after');
  assert.equal(offsetLabel(0), 'Move day');
});

test('addDaysIso: basic, month and year boundaries, leap day', () => {
  assert.equal(addDaysIso('2026-06-15', 1), '2026-06-16');
  assert.equal(addDaysIso('2026-06-15', -1), '2026-06-14');
  assert.equal(addDaysIso('2026-06-30', 1), '2026-07-01');
  assert.equal(addDaysIso('2026-01-01', -1), '2025-12-31');
  assert.equal(addDaysIso('2024-02-28', 1), '2024-02-29'); // 2024 is a leap year
  assert.equal(addDaysIso('2026-06-15T00:00:00', 0), '2026-06-15'); // tolerates time suffix
});

test('addDaysIso: bad input returns null', () => {
  assert.equal(addDaysIso(null, 1), null);
  assert.equal(addDaysIso('', 1), null);
  assert.equal(addDaysIso('not-a-date', 1), null);
});

test('scheduleAnchor: confirmed beats preferred, falls back, then null', () => {
  assert.equal(
    scheduleAnchor({ confirmed_move_date: '2026-06-20', preferred_move_date: '2026-06-10' }),
    '2026-06-20',
  );
  assert.equal(
    scheduleAnchor({ confirmed_move_date: null, preferred_move_date: '2026-06-10' }),
    '2026-06-10',
  );
  assert.equal(scheduleAnchor({ confirmed_move_date: null, preferred_move_date: null }), null);
  assert.equal(scheduleAnchor(null), null);
});

test('normalizeSchedule: keeps valid entries and trims labels', () => {
  const out = normalizeSchedule([
    { id: 'a', label: '  Packing  ', offset: -1 },
    { id: 'b', label: 'Delivery', offset: 4 },
  ]);
  assert.deepEqual(out, [
    { id: 'a', label: 'Packing', offset: -1 },
    { id: 'b', label: 'Delivery', offset: 4 },
  ]);
});

test('normalizeSchedule: drops invalid offsets and empty labels', () => {
  const out = normalizeSchedule([
    { id: 'a', label: 'Move itself', offset: 0 },               // 0 not allowed
    { id: 'b', label: 'Too far', offset: MAX_OFFSET_DAYS + 1 }, // out of range
    { id: 'c', label: '', offset: -1 },                          // empty label
    { id: 'd', label: 'Frac', offset: 1.5 },                     // non-integer
    { id: 'e', label: 'Good', offset: -2 },
  ]);
  assert.deepEqual(out, [{ id: 'e', label: 'Good', offset: -2 }]);
});

test('normalizeSchedule: dedupes ids and backfills missing ones', () => {
  const out = normalizeSchedule([
    { id: 'dup', label: 'One', offset: -1 },
    { id: 'dup', label: 'Two', offset: 2 },
    { label: 'Three', offset: 3 },
  ]);
  const ids = out.map(d => d.id);
  assert.equal(new Set(ids).size, 3, 'all ids unique');
  assert.equal(out.length, 3);
});

test('normalizeSchedule: parses JSON string and rejects junk', () => {
  assert.deepEqual(
    normalizeSchedule('[{"id":"a","label":"Packing","offset":-1}]'),
    [{ id: 'a', label: 'Packing', offset: -1 }],
  );
  assert.deepEqual(normalizeSchedule('not json'), []);
  assert.deepEqual(normalizeSchedule(null), []);
  assert.deepEqual(normalizeSchedule({ not: 'an array' }), []);
});

test('normalizeSchedule: caps the number of days', () => {
  const many = Array.from({ length: MAX_DAYS + 5 }, (_, i) => ({ label: `Day ${i}`, offset: 1 }));
  assert.equal(normalizeSchedule(many).length, MAX_DAYS);
});

test('expandSchedule: computes dates relative to anchor, sorted by offset', () => {
  const job = {
    confirmed_move_date: '2026-06-15',
    preferred_move_date: null,
    move_schedule: [
      { id: 'deliver', label: 'Delivery', offset: 4 },
      { id: 'pack', label: 'Packing', offset: -1 },
    ],
  };
  const out = expandSchedule(job);
  assert.deepEqual(out, [
    { id: 'pack', label: 'Packing', offset: -1, date: '2026-06-14' },
    { id: 'deliver', label: 'Delivery', offset: 4, date: '2026-06-19' },
  ]);
});

test('expandSchedule: dates auto-shift when the anchor moves', () => {
  const base = { confirmed_move_date: '2026-06-15', preferred_move_date: null,
    move_schedule: [{ id: 'pack', label: 'Packing', offset: -1 }] };
  const moved = { ...base, confirmed_move_date: '2026-06-22' };
  assert.equal(expandSchedule(base)[0].date, '2026-06-14');
  assert.equal(expandSchedule(moved)[0].date, '2026-06-21');
});

test('expandSchedule: null dates when the job has no anchor', () => {
  const job = { confirmed_move_date: null, preferred_move_date: null,
    move_schedule: [{ id: 'pack', label: 'Packing', offset: -1 }] };
  assert.equal(expandSchedule(job)[0].date, null);
});

test('OFFSET_PRESETS never includes the move day (0)', () => {
  assert.ok(!OFFSET_PRESETS.includes(0));
  assert.ok(OFFSET_PRESETS.every(Number.isInteger));
});

test('jobValidDates: move date plus every additional day', () => {
  const job = {
    confirmed_move_date: '2026-06-15',
    preferred_move_date: null,
    move_schedule: [
      { id: 'pack', label: 'Packing', offset: -1 },
      { id: 'deliver', label: 'Delivery', offset: 4 },
    ],
  };
  const set = jobValidDates(job);
  assert.equal(set.size, 3);
  assert.ok(set.has('2026-06-15')); // move
  assert.ok(set.has('2026-06-14')); // packing
  assert.ok(set.has('2026-06-19')); // delivery
  assert.ok(!set.has('2026-06-16'));
});

test('jobValidDates: empty when the job has no anchor date', () => {
  const job = { confirmed_move_date: null, preferred_move_date: null,
    move_schedule: [{ id: 'pack', label: 'Packing', offset: -1 }] };
  assert.equal(jobValidDates(job).size, 0);
});

test('scheduleDayForDate: returns the matching day, null for move day or miss', () => {
  const job = {
    confirmed_move_date: '2026-06-15',
    preferred_move_date: null,
    move_schedule: [{ id: 'pack', label: 'Packing', offset: -1 }],
  };
  assert.equal(scheduleDayForDate(job, '2026-06-15'), null); // move day
  assert.equal(scheduleDayForDate(job, '2026-06-20'), null); // no match
  const sd = scheduleDayForDate(job, '2026-06-14');
  assert.equal(sd?.id, 'pack');
  assert.equal(sd?.label, 'Packing');
});
