const prisma = require('../../db/prisma');
const gcal = require('../../services/google-calendar');

module.exports = async function calendarSync({ connection_id, job_id }) {
  const connection = await prisma.calendarConnection.findUnique({
    where: { id: connection_id },
  });
  if (!connection || !connection.enabled) return;

  const job = await prisma.crmJob.findUnique({ where: { id: job_id } });
  if (!job) throw new Error(`Job ${job_id} not found`);

  const moveDate = job.confirmed_move_date || job.preferred_move_date;
  if (!moveDate) return;

  const from = [job.from_line1, job.from_city, job.from_postcode].filter(Boolean).join(', ');
  const to = [job.to_line1, job.to_city, job.to_postcode].filter(Boolean).join(', ');

  const eventData = {
    title: `Move: ${job.full_name}`,
    description: [
      `From: ${from}`,
      `To: ${to}`,
      job.bedrooms ? `Size: ${job.bedrooms}` : null,
      job.phone ? `Phone: ${job.phone}` : null,
    ].filter(Boolean).join('\n'),
    start: `${moveDate}T08:00:00`,
    end: `${moveDate}T17:00:00`,
    location: from,
  };

  const existing = await prisma.calendarEvent.findFirst({
    where: { connection_id, job_id },
  });

  if (existing) {
    await gcal.updateEvent({
      accessToken: connection.access_token,
      refreshToken: connection.refresh_token,
      calendarId: connection.calendar_id || 'primary',
      eventId: existing.external_id,
      event: eventData,
    });
    await prisma.calendarEvent.update({
      where: { id: existing.id },
      data: { ...eventData, synced_at: new Date() },
    });
  } else {
    const result = await gcal.createEvent({
      accessToken: connection.access_token,
      refreshToken: connection.refresh_token,
      calendarId: connection.calendar_id || 'primary',
      event: eventData,
    });
    await prisma.calendarEvent.create({
      data: {
        connection_id,
        job_id,
        external_id: result.id,
        title: eventData.title,
        description: eventData.description,
        start_time: new Date(`${moveDate}T08:00:00`),
        end_time: new Date(`${moveDate}T17:00:00`),
        location: from,
        synced_at: new Date(),
      },
    });
  }

  console.log(`[job] Calendar synced for job ${job_id}`);
};
