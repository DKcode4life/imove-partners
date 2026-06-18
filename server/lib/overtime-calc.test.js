const { test } = require('node:test');
const assert = require('node:assert');
const {
  overtimeConfig,
  overtimeHoursForDay,
  attributeOvertimeToEvents,
} = require('./overtime-calc');

test('overtimeConfig returns null when overtime does not apply', () => {
  assert.strictEqual(overtimeConfig(null), null);
  assert.strictEqual(overtimeConfig({ overtime_applicable: false, overtime_fee: 10 }), null);
  assert.strictEqual(overtimeConfig({ overtime_applicable: true, overtime_fee: 0 }), null);
  assert.strictEqual(overtimeConfig({ overtime_applicable: true, overtime_fee: -5 }), null);
  assert.strictEqual(overtimeConfig({ overtime_applicable: true, overtime_fee: null }), null);
});

test('overtimeConfig parses fee and defaults the threshold to 10', () => {
  assert.deepStrictEqual(
    overtimeConfig({ overtime_applicable: true, overtime_fee: 12.5 }),
    { fee: 12.5, threshold: 10 }
  );
  assert.deepStrictEqual(
    overtimeConfig({ overtime_applicable: true, overtime_fee: 12.5, overtime_threshold_hours: 8 }),
    { fee: 12.5, threshold: 8 }
  );
  assert.deepStrictEqual(
    overtimeConfig({ overtime_applicable: true, overtime_fee: 12.5, overtime_threshold_hours: 0 }),
    { fee: 12.5, threshold: 0 }
  );
});

test('overtimeHoursForDay sums each person beyond the threshold', () => {
  // p1: 12h → 2 OT, p2: 9h → 0 OT, p3: 11.5h → 1.5 OT
  const byPerson = new Map([[1, 12], [2, 9], [3, 11.5]]);
  assert.strictEqual(overtimeHoursForDay(byPerson, 10), 3.5);
  assert.strictEqual(overtimeHoursForDay(new Map([[1, 10]]), 10), 0); // exactly at threshold
  assert.strictEqual(overtimeHoursForDay(new Map(), 10), 0);
});

// Helper: a contract job with one assignment working start→finish.
function job(id, date, eventId, assignments) {
  return {
    id,
    job_date: date,
    planner_event: { id: eventId, event_time: '08:00', assignments },
  };
}
const cfg = { fee: 20, threshold: 10 };

test('attributeOvertimeToEvents bills hours past the daily threshold to the event', () => {
  // One person 08:00→20:00 = 12h → 2h OT × £20 = £40
  const jobs = [job(1, '2026-06-15', 101, [{ asset_id: 1, start_time: '08:00', finish_time: '20:00' }])];
  const m = attributeOvertimeToEvents(jobs, cfg);
  assert.strictEqual(m.get(101), 40);
});

test('attributeOvertimeToEvents returns nothing when under the threshold', () => {
  const jobs = [job(1, '2026-06-15', 101, [{ asset_id: 1, start_time: '08:00', finish_time: '17:00' }])]; // 9h
  assert.strictEqual(attributeOvertimeToEvents(jobs, cfg).size, 0);
});

test('attributeOvertimeToEvents sums a person across the contract\'s jobs that day, billing one event', () => {
  // Same person works two jobs the same day: 6h + 6h = 12h → 2h OT × £20 = £40.
  // Neither job alone exceeds the threshold; the day-level sum does. The whole
  // £40 lands on the representative event (lowest job id = 1 → event 101).
  const jobs = [
    job(1, '2026-06-15', 101, [{ asset_id: 7, start_time: '08:00', finish_time: '14:00' }]),
    job(2, '2026-06-15', 102, [{ asset_id: 7, start_time: '14:00', finish_time: '20:00' }]),
  ];
  const m = attributeOvertimeToEvents(jobs, cfg);
  assert.strictEqual(m.get(101), 40);
  assert.strictEqual(m.has(102), false);
  // Per-event figures sum to the invoice's day total.
  assert.strictEqual([...m.values()].reduce((s, v) => s + v, 0), 40);
});

test('attributeOvertimeToEvents keeps separate days on their own representative events', () => {
  const jobs = [
    job(1, '2026-06-15', 101, [{ asset_id: 1, start_time: '08:00', finish_time: '20:00' }]), // 2h OT
    job(2, '2026-06-16', 102, [{ asset_id: 1, start_time: '08:00', finish_time: '21:00' }]), // 3h OT
  ];
  const m = attributeOvertimeToEvents(jobs, cfg);
  assert.strictEqual(m.get(101), 40);
  assert.strictEqual(m.get(102), 60);
});
