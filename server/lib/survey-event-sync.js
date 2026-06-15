'use strict';

/**
 * Keeps a job's scheduled survey in sync with a planner event, so a booked
 * survey shows on the planner/calendar and crew can be assigned to it.
 *
 * The job is the source of truth: saving a survey (survey_required + survey_date)
 * creates/updates a linked "Survey" PlannerEvent; clearing the survey deletes it.
 * The link is CrmJob.survey_event_id (relation onDelete: SetNull, so deleting the
 * event on the planner simply unlinks the job).
 */

function surveyAddress(job) {
  return [job.from_line1, job.from_city, job.from_postcode].filter(Boolean).join(', ') || null;
}

/**
 * Forward sync: create / update / delete the survey event to match the job.
 * Safe to call after any job save; no-op when nothing relevant changed.
 */
async function syncSurveyEvent(prisma, jobId) {
  const job = await prisma.crmJob.findUnique({ where: { id: jobId } });
  if (!job) return;

  const wants = !!job.survey_required && !!job.survey_date;

  const existing = job.survey_event_id
    ? await prisma.plannerEvent.findUnique({ where: { id: job.survey_event_id } })
    : null;

  // No survey wanted → remove any linked event (and clear a dangling link).
  if (!wants) {
    if (existing) {
      await prisma.plannerEvent.delete({ where: { id: existing.id } }); // SetNull clears the link
    } else if (job.survey_event_id) {
      await prisma.crmJob.update({ where: { id: jobId }, data: { survey_event_id: null } });
    }
    return;
  }

  const data = {
    title: `Survey — ${job.full_name}`,
    category: 'Survey',
    customer_name: job.full_name,
    contact_number: job.phone || null,
    address: surveyAddress(job),
    event_date: String(job.survey_date).slice(0, 10),
    event_time: job.survey_time || null,
    notes: job.survey_type ? `${job.survey_type} survey` : null,
  };

  if (existing) {
    await prisma.plannerEvent.update({ where: { id: existing.id }, data });
  } else {
    const created = await prisma.plannerEvent.create({ data });
    await prisma.crmJob.update({ where: { id: jobId }, data: { survey_event_id: created.id } });
  }
}

/**
 * Reverse sync: when a survey's planner event is moved or its time edited, push
 * the new date/time back to the linked job so the profile stays consistent.
 */
async function syncJobSurveyFromEvent(prisma, eventId, newDate, newTime) {
  const job = await prisma.crmJob.findFirst({
    where: { survey_event_id: eventId },
    select: { id: true, survey_date: true, survey_time: true },
  });
  if (!job) return;

  const data = {};
  const d = newDate ? String(newDate).slice(0, 10) : null;
  if (d && d !== job.survey_date) data.survey_date = d;
  if (newTime !== undefined && (newTime || null) !== (job.survey_time || null)) {
    data.survey_time = newTime || null;
  }
  if (Object.keys(data).length) await prisma.crmJob.update({ where: { id: job.id }, data });
}

module.exports = { syncSurveyEvent, syncJobSurveyFromEvent };
