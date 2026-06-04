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
 */
const { deriveHours } = require('./wage-calc');

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
  if (!contract || !contract.overtime_applicable) return [];
  const fee = Number(contract.overtime_fee);
  if (!Number.isFinite(fee) || fee <= 0) return [];
  const rawThr = Number(contract.overtime_threshold_hours);
  const threshold = Number.isFinite(rawThr) && rawThr >= 0 ? rawThr : 10;

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

  // date -> Map(asset_id -> total hours that day)
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

  const lines = [];
  for (const [job_date, byPerson] of perDayPerson) {
    let otHours = 0;
    for (const hours of byPerson.values()) {
      if (hours > threshold) otHours += hours - threshold;
    }
    otHours = +otHours.toFixed(2);
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

module.exports = { computeOvertimeLines };
