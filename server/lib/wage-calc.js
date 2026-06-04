/**
 * Wage calculator — single source of truth for per-assignment wages.
 *
 * Used by:
 *   - GET /api/planner/staff-week     (Staff View grid)
 *   - GET /api/wages/week             (weekly rollup on the Wages page)
 *
 * Rules (in order):
 *   1. Manual override: if assignment.wage_override is set, total = override
 *      flat. mode='override'. Lorry bonus is NOT added on top — the user
 *      typed the final number they want paid.
 *   2. Lux Move: if the linked contract is_lux AND both start_time and
 *      finish_time are set → hours = (finish − start), wage = hours × rate.
 *      Rate is asset.lux_hourly_rate (per-staff) when set, otherwise the
 *      global luxHourlyRate company setting. mode='lux'. If only one of the
 *      times is set the row hasn't been fully filled in yet — falls through
 *      to daily.
 *   3. Otherwise → daily. Per-assignment daily_rate wins; if absent we use
 *      the per-staff rate that matches the effective role on the day
 *      (asset.driver_daily_rate / asset.porter_daily_rate). Falls back to
 *      ROLE_DEFAULT_RATE for that role when the staff member's rate is null.
 *   4. Lorry bonus: if the assigned vehicle is_lorry AND the assignment is a
 *      driver → add lorryBonus (skipped when override is set, per rule 1).
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
 * Pick the per-staff daily rate field that matches the role being worked.
 * Returns null when there's no matching per-staff rate (caller falls back
 * to ROLE_DEFAULT_RATE).
 */
function assetRateForRole(asset, role) {
  if (!asset) return null;
  const r = String(role || '').toLowerCase();
  if (r === 'driver') return asset.driver_daily_rate ?? null;
  if (r === 'porter') return asset.porter_daily_rate ?? null;
  return null;
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
function computeAssignmentWage({ assignment, asset, vehicle, contract, event, luxHourlyRate, lorryBonus }) {
  const a = assignment || {};
  const isLuxContract = !!(contract && contract.is_lux);
  // Start time for Lux hour-calc falls back to the event's scheduled start so
  // the user only has to type the finish time on the Staff View row. (The
  // start_time input is pre-populated with event_time visually but isn't always
  // persisted to the assignment — falling back here makes the wage compute
  // regardless of that.)
  const effectiveStart = a.start_time || event?.event_time || null;
  // Worked hours are derived for EVERY job, not just Lux — the Staff View shows
  // an Hours column so overtime-billed contracts can be reconciled by eye. Only
  // Lux jobs feed `hours` into the wage; all others stay on the daily rate.
  const hours = deriveHours(effectiveStart, a.finish_time);
  // Effective role on the day = assigned_role (per-assignment) ?? asset.role (staff default).
  // Drives both per-staff rate selection and the lorry bonus check.
  const effectiveRole = String(a.assigned_role || asset?.role || '').toLowerCase();

  // Manual override short-circuits everything else.
  if (a.wage_override != null) {
    const total = +Number(a.wage_override).toFixed(2);
    return { mode: 'override', daily: 0, lux: 0, bonus: 0, hours, total };
  }

  let daily = 0;
  let lux = 0;
  let mode;
  if (isLuxContract && hours != null) {
    const perStaffLux = asset?.lux_hourly_rate;
    const rate = perStaffLux != null ? Number(perStaffLux) : Number(luxHourlyRate || 0);
    lux = hours * rate;
    mode = 'lux';
  } else {
    if (a.daily_rate != null) {
      daily = Number(a.daily_rate);
    } else {
      const perStaff = assetRateForRole(asset, effectiveRole);
      daily = perStaff != null ? Number(perStaff) : roleDefault(effectiveRole);
    }
    mode = 'daily';
  }

  const bonus = (vehicle && vehicle.is_lorry && effectiveRole === 'driver')
    ? Number(lorryBonus || 0)
    : 0;

  const total = +(daily + lux + bonus).toFixed(2);
  return { mode, daily, lux, bonus, hours, total };
}

module.exports = { computeAssignmentWage, roleDefault, ROLE_DEFAULT_RATE, deriveHours, assetRateForRole };
