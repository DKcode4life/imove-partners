import type { MoveScheduleDay } from '../types';

/**
 * Client-side helpers for additional move days (packing, pre-load, delivery, …).
 * Mirrors server/lib/move-schedule.js. Offsets are signed days relative to the
 * anchor move date (confirmed || preferred); real dates are derived on render so
 * they auto-shift when the confirmed move date changes.
 */

// Preset offsets for the add-day dropdown (excludes 0 = the move day).
export const OFFSET_PRESETS: number[] = [-3, -2, -1, 1, 2, 3, 4, 5];

/** Human label for an offset, e.g. -1 → "1 day before", 4 → "4 days after". */
export function offsetLabel(offset: number): string {
  const n = Math.abs(offset);
  const unit = n === 1 ? 'day' : 'days';
  if (offset < 0) return `${n} ${unit} before`;
  if (offset > 0) return `${n} ${unit} after`;
  return 'Move day';
}

/** Add `n` days to a YYYY-MM-DD string (UTC math). Returns null on bad input. */
export function addDaysIso(iso: string | null | undefined, n: number): string | null {
  if (!iso) return null;
  const [y, m, d] = String(iso).slice(0, 10).split('-').map(Number);
  if (!y || !m || !d) return null;
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + n);
  return dt.toISOString().slice(0, 10);
}

/** The date every extra day is measured from. */
export function scheduleAnchor(job: {
  confirmed_move_date: string | null;
  preferred_move_date: string | null;
}): string | null {
  const v = job.confirmed_move_date || job.preferred_move_date || null;
  return v ? String(v).slice(0, 10) : null;
}

/** Resolve a stored schedule into days with real dates, sorted by offset. */
export function expandSchedule(
  days: MoveScheduleDay[] | null | undefined,
  anchor: string | null,
): (MoveScheduleDay & { date: string | null })[] {
  return (days ?? [])
    .map(day => ({ ...day, date: anchor ? addDaysIso(anchor, day.offset) : null }))
    .sort((a, b) => a.offset - b.offset);
}

/** Generate a stable-enough local id for a newly added day. */
export function newDayId(): string {
  return `day_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
}
