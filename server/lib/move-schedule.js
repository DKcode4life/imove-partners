'use strict';

/**
 * Additional move days (packing, pre-load, delivery, unpacking, …).
 *
 * Each day is stored on CrmJob.move_schedule as { id, label, offset } where
 * `offset` is a signed integer number of days relative to the anchor move date
 * (confirmed_move_date || preferred_move_date). Negative = before the move,
 * positive = after. The main move day is offset 0 and is never stored here.
 *
 * Storing offsets instead of fixed dates means every extra day auto-shifts when
 * the confirmed move date changes — the real dates are derived on read.
 */

// Preset offsets surfaced in the add-day dropdown (excludes 0 = the move day).
const OFFSET_PRESETS = [-3, -2, -1, 1, 2, 3, 4, 5];

// Widest absolute offset. Planner queries widen their visible window by this so
// an extra day that lands inside the window is still found when the job's own
// move date sits just outside it.
const MAX_OFFSET_DAYS = OFFSET_PRESETS.reduce((m, o) => Math.max(m, Math.abs(o)), 0);

// Hard cap on extra days per job — defensive bound on stored JSON size.
const MAX_DAYS = 12;

/** Human label for an offset, e.g. -1 → "1 day before", 4 → "4 days after". */
function offsetLabel(offset) {
  const n = Math.abs(Number(offset) || 0);
  const unit = n === 1 ? 'day' : 'days';
  if (offset < 0) return `${n} ${unit} before`;
  if (offset > 0) return `${n} ${unit} after`;
  return 'Move day';
}

/**
 * Add `n` days to a YYYY-MM-DD string, returning YYYY-MM-DD.
 * Uses UTC math so it never drifts across DST boundaries. Returns null on bad
 * input.
 */
function addDaysIso(iso, n) {
  if (!iso) return null;
  const [y, m, d] = String(iso).slice(0, 10).split('-').map(Number);
  if (!y || !m || !d) return null;
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + Number(n || 0));
  return dt.toISOString().slice(0, 10);
}

/** The date every extra day is measured from. */
function scheduleAnchor(job) {
  if (!job) return null;
  const v = job.confirmed_move_date || job.preferred_move_date || null;
  return v ? String(v).slice(0, 10) : null;
}

/**
 * Validate + clean a raw move_schedule value (request body or DB JSON column).
 * Returns a clean { id, label, offset }[]. Drops malformed entries, dedupes ids,
 * and caps the count. Never throws.
 */
function normalizeSchedule(raw) {
  let arr = raw;
  if (typeof arr === 'string') {
    try { arr = JSON.parse(arr); } catch { return []; }
  }
  if (!Array.isArray(arr)) return [];

  const seen = new Set();
  const out = [];
  for (const entry of arr) {
    if (!entry || typeof entry !== 'object') continue;
    const offset = Number(entry.offset);
    if (!Number.isInteger(offset) || offset === 0) continue;
    if (Math.abs(offset) > MAX_OFFSET_DAYS) continue;
    const label = typeof entry.label === 'string' ? entry.label.trim().slice(0, 60) : '';
    if (!label) continue;

    let id = typeof entry.id === 'string' && entry.id.trim() ? entry.id.trim().slice(0, 40) : '';
    if (!id || seen.has(id)) id = `day_${out.length + 1}_${offset < 0 ? 'b' : 'a'}${Math.abs(offset)}`;
    seen.add(id);

    out.push({ id, label, offset });
    if (out.length >= MAX_DAYS) break;
  }
  return out;
}

/**
 * Expand a job's stored schedule into resolved days with real dates, sorted by
 * offset. `date` is null when the job has no anchor move date yet.
 */
function expandSchedule(job) {
  const anchor = scheduleAnchor(job);
  return normalizeSchedule(job && job.move_schedule)
    .map(day => ({ ...day, date: anchor ? addDaysIso(anchor, day.offset) : null }))
    .sort((a, b) => a.offset - b.offset);
}

/**
 * Every date a job legitimately occupies: its main move day plus each additional
 * day. Used to decide whether a crew assignment on a given date belongs to the
 * job (the main move date is no longer the only valid assignment date).
 * Returns a Set of YYYY-MM-DD strings (empty when the job has no anchor).
 */
function jobValidDates(job) {
  const anchor = scheduleAnchor(job);
  const set = new Set();
  if (!anchor) return set;
  set.add(anchor);
  for (const day of expandSchedule(job)) {
    if (day.date) set.add(day.date);
  }
  return set;
}

/**
 * For a given date, return the schedule day that falls on it ({ id, label,
 * offset, date }), or null when the date is the main move day (or no match).
 * Lets callers label an assignment/expense as "Packing", "Delivery", etc.
 */
function scheduleDayForDate(job, date) {
  if (!date) return null;
  const d = String(date).slice(0, 10);
  if (scheduleAnchor(job) === d) return null; // main move day
  return expandSchedule(job).find(day => day.date === d) || null;
}

module.exports = {
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
};
