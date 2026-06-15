const prisma = require('../../db/prisma');
const gcal = require('../../services/google-calendar');
const { expandSchedule, scheduleAnchor } = require('../../lib/move-schedule');

// Default working window for an all-day-ish move slot.
const START_HOUR = '08:00:00';
const END_HOUR = '17:00:00';

/**
 * Sync a job to Google Calendar as one event per day:
 *   - the main move day (slot_key 'move')
 *   - each additional move day (packing, delivery, …) keyed by its schedule id
 *
 * Events are upserted by (connection_id, job_id, slot_key) and any stale events
 * (a removed extra day, or a cleared move date) are deleted both remotely and
 * locally. Extra days carry no stored date — they're derived from the anchor, so
 * they shift automatically whenever the confirmed move date changes.
 *
 * NOTE: this handler is registered but is not yet enqueued anywhere — the Google
 * Calendar connect/trigger flow is not built. It is kept correct so it works the
 * moment that integration is wired up.
 */
module.exports = async function calendarSync({ connection_id, job_id }) {
  const connection = await prisma.calendarConnection.findUnique({
    where: { id: connection_id },
  });
  if (!connection || !connection.enabled) return;

  const job = await prisma.crmJob.findUnique({ where: { id: job_id } });
  if (!job) throw new Error(`Job ${job_id} not found`);

  const moveDate = scheduleAnchor(job);

  const from = [job.from_line1, job.from_city, job.from_postcode].filter(Boolean).join(', ');
  const to = [job.to_line1, job.to_city, job.to_postcode].filter(Boolean).join(', ');
  const description = [
    from ? `From: ${from}` : null,
    to ? `To: ${to}` : null,
    job.bedrooms ? `Size: ${job.bedrooms}` : null,
    job.phone ? `Phone: ${job.phone}` : null,
  ].filter(Boolean).join('\n');

  // Desired set of events, keyed by slot_key. Empty when the job has no date.
  const slots = [];
  if (moveDate) {
    slots.push({ slot_key: 'move', title: `Move: ${job.full_name}`, date: moveDate });
    for (const day of expandSchedule(job)) {
      if (!day.date) continue;
      slots.push({ slot_key: day.id, title: `${day.label}: ${job.full_name}`, date: day.date });
    }
  }

  const auth = {
    accessToken: connection.access_token,
    refreshToken: connection.refresh_token,
    calendarId: connection.calendar_id || 'primary',
  };

  // Older rows predate slot_key — treat a null key as the main move event.
  const existing = await prisma.calendarEvent.findMany({ where: { connection_id, job_id } });
  const existingBySlot = new Map(existing.map(e => [e.slot_key || 'move', e]));
  const desiredKeys = new Set(slots.map(s => s.slot_key));

  for (const slot of slots) {
    const gcalEvent = {
      title: slot.title,
      description,
      start: `${slot.date}T${START_HOUR}`,
      end: `${slot.date}T${END_HOUR}`,
      location: from,
    };
    const dbData = {
      slot_key: slot.slot_key,
      title: slot.title,
      description,
      start_time: new Date(`${slot.date}T${START_HOUR}`),
      end_time: new Date(`${slot.date}T${END_HOUR}`),
      location: from,
      synced_at: new Date(),
    };

    const row = existingBySlot.get(slot.slot_key);
    if (row) {
      await gcal.updateEvent({ ...auth, eventId: row.external_id, event: gcalEvent });
      await prisma.calendarEvent.update({ where: { id: row.id }, data: dbData });
    } else {
      const result = await gcal.createEvent({ ...auth, event: gcalEvent });
      await prisma.calendarEvent.create({
        data: { connection_id, job_id, external_id: result.id, ...dbData },
      });
    }
  }

  // Prune events whose slot no longer exists (removed extra day or cleared date).
  for (const [key, row] of existingBySlot) {
    if (desiredKeys.has(key)) continue;
    if (row.external_id) {
      try {
        await gcal.deleteEvent({ ...auth, eventId: row.external_id });
      } catch (err) {
        console.error(`[job] Failed to delete stale calendar event ${row.id}`, err);
      }
    }
    await prisma.calendarEvent.delete({ where: { id: row.id } });
  }

  console.log(`[job] Calendar synced for job ${job_id} (${slots.length} day(s))`);
};
