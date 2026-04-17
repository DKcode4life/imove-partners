const prisma = require('../db/prisma');
const registry = require('./registry');

// The runner polls the background_jobs table for pending work and executes handlers.
//
// For production, replace this polling runner with a proper job queue:
//   - BullMQ (Redis-backed, recommended for Node.js)
//   - Trigger.dev (managed, good DX)
//   - pg-boss (PostgreSQL-backed, no extra infra)
//
// The handler interface stays the same — only the runner changes.

let running = false;
let pollInterval = null;

async function start({ intervalMs = 5000 } = {}) {
  if (running) return;
  running = true;
  console.log(`[jobs] Runner started (polling every ${intervalMs}ms)`);
  pollInterval = setInterval(() => tick().catch(err => console.error('[jobs] Tick error:', err)), intervalMs);
  tick().catch(err => console.error('[jobs] Initial tick error:', err));
}

function stop() {
  running = false;
  if (pollInterval) clearInterval(pollInterval);
  console.log('[jobs] Runner stopped');
}

async function tick() {
  const now = new Date();

  const jobs = await prisma.backgroundJob.findMany({
    where: {
      status: { in: ['pending', 'retrying'] },
      scheduled_for: { lte: now },
    },
    orderBy: [{ priority: 'desc' }, { created_at: 'asc' }],
    take: 10,
  });

  for (const job of jobs) {
    await execute(job);
  }
}

async function execute(job) {
  const handler = registry[job.type];
  if (!handler) {
    await prisma.backgroundJob.update({
      where: { id: job.id },
      data: { status: 'failed', last_error: `Unknown job type: ${job.type}`, completed_at: new Date() },
    });
    return;
  }

  await prisma.backgroundJob.update({
    where: { id: job.id },
    data: { status: 'running', started_at: new Date(), attempts: job.attempts + 1 },
  });

  try {
    const payload = JSON.parse(job.payload);
    await handler(payload);

    await prisma.backgroundJob.update({
      where: { id: job.id },
      data: { status: 'completed', completed_at: new Date() },
    });
  } catch (err) {
    const canRetry = job.attempts + 1 < job.max_attempts;

    await prisma.backgroundJob.update({
      where: { id: job.id },
      data: {
        status: canRetry ? 'retrying' : 'failed',
        last_error: err.message,
        scheduled_for: canRetry
          ? new Date(Date.now() + Math.pow(2, job.attempts) * 30000) // exponential backoff
          : undefined,
        completed_at: canRetry ? undefined : new Date(),
      },
    });

    console.error(`[jobs] ${job.type}#${job.id} failed:`, err.message);
  }
}

async function enqueue(type, payload, { priority = 0, maxAttempts = 3, scheduledFor } = {}) {
  return prisma.backgroundJob.create({
    data: {
      type,
      payload: JSON.stringify(payload),
      priority,
      max_attempts: maxAttempts,
      scheduled_for: scheduledFor || new Date(),
    },
  });
}

module.exports = { start, stop, enqueue };
