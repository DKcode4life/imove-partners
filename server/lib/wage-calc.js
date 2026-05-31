/**
 * Wage calculator — single source of truth for per-assignment wages.
 *
 * Used by:
 *   - GET /api/planner/staff-week     (Staff View grid)
 *   - GET /api/wages/week             (weekly rollup on the Wages page)
 *
 * Rules (in order):
 *   1. Lux Move: if the linked contract is_lux AND both start_time and
 *      finish_time are set → hours = (finish − start), wage = hours ×
 *      luxHourlyRate. mode='lux'. If only one of the times is set the row
 *      hasn't been fully filled in yet — falls through to daily.
 *   2. Otherwise → total = assignment.daily_rate ?? roleDefault(asset.role),
 *      mode='daily'.
 *   3. Lorry bonus: if the assigned vehicle is_lorry AND the assignment is a
 *      driver → add lorryBonus.
 */

const ROLE_DEFAULT_RATE = {
  driver: 150,
  porter: 125,
};

function roleDefault(role) {
  if (!role) return 0;
  return ROLE_DEFAULT_RATE[String(role).toLowerCase()] ?? 0;
}

/**
 * Convert "HH:MM" → minutes since midnight. Returns null if not a valid time.
 */
function toMinutes(hhmm) {
  if (!hhmm) return null;
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm).trim());
  if (!m) return null;
  const h = parseInt(m[1], 10);
  const mm = parseInt(m[2], 10);
  if (h < 0 || h > 23 || mm < 0 || mm > 59) return null;
  return h * 60 + mm;
}

/**
 * Derive worked hours between start and finish. Crossing midnight (finish
 * earlier than start) wraps around — most jobs don't, but it's the obvious
 * fallback. Returns null if either is missing or invalid.
 */
function deriveHours(start, finish) {
  const s = toMinutes(start);
  const f = toMinutes(finish);
  if (s == null || f == null) return null;
  let diff = f - s;
  if (diff < 0) diff += 24 * 60;
  return +(diff / 60).toFixed(2);
}

/**
 * @param {Object}   input
 * @param {Object}   input.assignment    — PlannerAssignment row (uses daily_rate, start_time, finish_time, assigned_role)
 * @param {Object}   input.asset         — PlannerAsset row for the staff member (uses role)
 * @param {Object?}  input.vehicle       — PlannerAsset row for the assigned vehicle, or null (uses is_lorry)
 * @param {Object?}  input.contract      — Contract row of the linked event, or null (uses is_lux)
 * @param {number}   input.luxHourlyRate — global setting £/hour
 * @param {number}   input.lorryBonus    — global setting £ flat
 * @returns {{ mode:'lux'|'daily', daily:number, lux:number, bonus:number, hours:number|null, total:number }}
 */
function computeAssignmentWage({ assignment, asset, vehicle, contract, luxHourlyRate, lorryBonus }) {
  const a = assignment || {};
  const isLuxContract = !!(contract && contract.is_lux);
  const hours = isLuxContract ? deriveHours(a.start_time, a.finish_time) : null;
  const assignedRole = String(a.assigned_role || asset?.role || '').toLowerCase();

  let daily = 0;
  let lux = 0;
  let mode;
  if (isLuxContract && hours != null) {
    lux = hours * Number(luxHourlyRate || 0);
    mode = 'lux';
  } else {
    daily = a.daily_rate != null ? Number(a.daily_rate) : roleDefault(asset?.role);
    mode = 'daily';
  }

  const bonus = (vehicle && vehicle.is_lorry && assignedRole === 'driver')
    ? Number(lorryBonus || 0)
    : 0;

  const total = +(daily + lux + bonus).toFixed(2);
  return { mode, daily, lux, bonus, hours, total };
}

module.exports = { computeAssignmentWage, roleDefault, ROLE_DEFAULT_RATE, deriveHours };
