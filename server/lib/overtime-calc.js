/**
 * Overtime line calculator for weekly contractor invoices.
 *
 * A contractor flagged `overtime_applicable` with an `overtime_fee` bills the
 * hours its staff work past `overtime_threshold_hours` on a given day. Overtime
 * is a daily, per-person concept: a person's hours are summed across all their
 * jobs that day, then `max(0, sum − threshold)` is that person's overtime. Every
 * person's overtime for the day is summed into one invoice line for that date.
 *
 * Independent of the Lux Move flag — any job with start/finish times counts.
 *
 * Used by:
 *   - server/lib/contract-invoice-sync.js  (live draft reconcile)
 *   - server/routes/contract-jobs.js        (auto-draft generation)
 *   - server/routes/wages.js & planner.js   (P&L income — overtime attributed
 *                                             to a representative event per day)
 */
const { deriveHours } = require('./wage-calc');

const DEFAULT_THRESHOLD_HOURS = 10;

/**
 * Resolve a contract's overtime billing config, or null when overtime does not
 * apply (flag off, no fee, or non-positive fee).
 * @param {{ overtime_applicable?:boolean, overtime_fee?:number, overtime_threshold_hours?:number }|null} contract
 * @returns {{ fee:number, threshold:number }|null}
 */
function overtimeConfig(contract) {
  if (!contract || !contract.overtime_applicable) return null;
  const fee = Number(contract.overtime_fee);
  if (!Number.isFinite(fee) || fee <= 0) return null;
  const rawThr = Number(contract.overtime_threshold_hours);
  const threshold = Number.isFinite(rawThr) && rawThr >= 0 ? rawThr : DEFAULT_THRESHOLD_HOURS;
  return { fee, threshold };
}

/**
 * Sum the overtime hours for one day from a per-person hours map: each person's
 * hours over the threshold, added together. Rounded to 2 dp.
 * @param {Map<number, number>} hoursByPerson — asset_id -> total hours that day
 * @param {number} threshold
 * @returns {number}
 */
function overtimeHoursForDay(hoursByPerson, threshold) {
  let otHours = 0;
  for (const hours of hoursByPerson.values()) {
    if (hours > threshold) otHours += hours - threshold;
  }
  return +otHours.toFixed(2);
}

/**
 * Build the date -> Map(asset_id -> hours) structure from a set of contract jobs.
 * Each job must carry `job_date` and a `planner_event` with `event_time` and
 * `assignments` ({ asset_id, start_time, finish_time }).
 */
function hoursByDayPerson(jobs) {
  const perDayPerson = new Map();
  for (const job of jobs) {
    const ev = job.planner_event;
    if (!ev) continue;
    for (const a of ev.assignments) {
      // Start falls back to the event's scheduled time — same rule the wage calc
      // uses, so the user only has to type the finish time on the Staff View row.
      const start = a.start_time || ev.event_time || null;
      const hours = deriveHours(start, a.finish_time);
      if (hours == null || hours <= 0) continue;
      let byPerson = perDayPerson.get(job.job_date);
      if (!byPerson) { byPerson = new Map(); perDayPerson.set(job.job_date, byPerson); }
      byPerson.set(a.asset_id, (byPerson.get(a.asset_id) || 0) + hours);
    }
  }
  return perDayPerson;
}

/**
 * @param {object} prisma
 * @param {object} contract  — Contract row (uses overtime_applicable, overtime_fee, overtime_threshold_hours, id)
 * @param {string} weekStart — YYYY-MM-DD (inclusive)
 * @param {string} weekEnd   — YYYY-MM-DD (inclusive)
 * @returns {Promise<Array<{ job_date:string, hours:number, fee:number, total:number, description:string }>>}
 *          One entry per day with overtime > 0, sorted by date. Empty when the
 *          contractor has no overtime fee configured.
 */
async function computeOvertimeLines(prisma, contract, weekStart, weekEnd) {
  const cfg = overtimeConfig(contract);
  if (!cfg) return [];
  const { fee, threshold } = cfg;

  const jobs = await prisma.contractJob.findMany({
    where: {
      contract_id: contract.id,
      job_date: { gte: weekStart, lte: weekEnd },
    },
    select: {
      job_date: true,
      planner_event: {
        select: {
          event_time: true,
          assignments: { select: { asset_id: true, start_time: true, finish_time: true } },
        },
      },
    },
  });

  const perDayPerson = hoursByDayPerson(jobs);

  const lines = [];
  for (const [job_date, byPerson] of perDayPerson) {
    const otHours = overtimeHoursForDay(byPerson, threshold);
    if (otHours <= 0) continue;
    lines.push({
      job_date,
      hours: otHours,
      fee,
      total: +(otHours * fee).toFixed(2),
      description: `Overtime — ${otHours} hrs @ £${fee.toFixed(2)}/hr`,
    });
  }
  lines.sort((a, b) => a.job_date.localeCompare(b.job_date));
  return lines;
}

/**
 * Attribute one contract's overtime to its planner events for the P&L.
 *
 * Overtime is a per-day figure (summed per person across that day's jobs). The
 * invoice shows a single overtime line per day, not per job — so for the P&L we
 * attribute each day's overtime to one representative event: the day's job with
 * the lowest id that has a planner event. The per-event figures therefore sum to
 * exactly the invoice's overtime total, with no double counting across the
 * multiple jobs a contractor may run on the same day.
 *
 * @param {Array} jobs — contract jobs with `id`, `job_date` and a `planner_event`
 *                        ({ id, event_time, assignments }).
 * @param {{ fee:number, threshold:number }} cfg
 * @returns {Map<number, number>} planner_event_id -> overtime income (£)
 */
function attributeOvertimeToEvents(jobs, { fee, threshold }) {
  const perDayPerson = hoursByDayPerson(jobs);

  // date -> representative event id (lowest job id that day with an event)
  const repByDate = new Map();
  for (const job of jobs) {
    const ev = job.planner_event;
    if (!ev || ev.id == null) continue;
    const cur = repByDate.get(job.job_date);
    if (!cur || job.id < cur.jobId) repByDate.set(job.job_date, { jobId: job.id, eventId: ev.id });
  }

  const byEvent = new Map();
  for (const [date, byPerson] of perDayPerson) {
    const otHours = overtimeHoursForDay(byPerson, threshold);
    if (otHours <= 0) continue;
    const rep = repByDate.get(date);
    if (!rep) continue; // every contributing day has an event; defensive
    const amount = +(otHours * fee).toFixed(2);
    byEvent.set(rep.eventId, +((byEvent.get(rep.eventId) || 0) + amount).toFixed(2));
  }
  return byEvent;
}

/**
 * Overtime income per planner event across a date window, for the P&L.
 * Spans every overtime-applicable contract (or a single one when `contractId`
 * is given). Two queries total: the contracts, then all their jobs in range.
 *
 * @param {object} prisma
 * @param {string} weekStart — YYYY-MM-DD (inclusive)
 * @param {string} weekEnd   — YYYY-MM-DD (inclusive)
 * @param {{ contractId?:number }} [opts]
 * @returns {Promise<Map<number, number>>} planner_event_id -> overtime income (£)
 */
async function computeOvertimeIncomeByEvent(prisma, weekStart, weekEnd, { contractId } = {}) {
  const where = { overtime_applicable: true };
  if (contractId != null) where.id = contractId;
  const contracts = await prisma.contract.findMany({
    where,
    select: { id: true, overtime_applicable: true, overtime_fee: true, overtime_threshold_hours: true },
  });

  const configById = new Map();
  for (const c of contracts) {
    const cfg = overtimeConfig(c);
    if (cfg) configById.set(c.id, cfg);
  }
  if (configById.size === 0) return new Map();

  const jobs = await prisma.contractJob.findMany({
    where: {
      contract_id: { in: [...configById.keys()] },
      job_date: { gte: weekStart, lte: weekEnd },
    },
    select: {
      id: true,
      contract_id: true,
      job_date: true,
      planner_event: {
        select: {
          id: true,
          event_time: true,
          assignments: { select: { asset_id: true, start_time: true, finish_time: true } },
        },
      },
    },
  });

  const jobsByContract = new Map();
  for (const job of jobs) {
    if (!jobsByContract.has(job.contract_id)) jobsByContract.set(job.contract_id, []);
    jobsByContract.get(job.contract_id).push(job);
  }

  // Event ids are unique per contract job, so no key collisions across contracts.
  const byEvent = new Map();
  for (const [cid, cfg] of configById) {
    const m = attributeOvertimeToEvents(jobsByContract.get(cid) || [], cfg);
    for (const [eventId, amount] of m) byEvent.set(eventId, amount);
  }
  return byEvent;
}

module.exports = {
  computeOvertimeLines,
  computeOvertimeIncomeByEvent,
  // exported for unit tests
  overtimeConfig,
  overtimeHoursForDay,
  attributeOvertimeToEvents,
};
