const express = require('express');
const prisma = require('../db/prisma');
const { authenticateApiKey, requireScope } = require('../middleware/apiKey');
const wrap = require('../lib/async-handler');

const router = express.Router();

/**
 * GET /api/crm/jobs/ai-sync
 * 
 * Returns ALL jobs with all fields for AI system to track.
 * Authentication: API key with crm:read scope
 * 
 * Response format:
 * {
 *   synced_at: "2026-04-30T11:00:00Z",
 *   count: 142,
 *   jobs: [ { ...full job }, ... ]
 * }
 */
router.get('/jobs/ai-sync', authenticateApiKey, requireScope('crm:read'), wrap(async (req, res) => {
  try {
    const jobs = await prisma.crmJob.findMany({
      include: {
        lead: {
          select: {
            client_name: true,
            current_address: true,
            contact_number: true,
            email: true,
            estimated_moving_date: true,
          },
        },
        customer: true,
        referred_by: true,
        activities: {
          orderBy: { created_at: 'desc' },
          take: 10,
        },
        quotes: {
          orderBy: { created_at: 'desc' },
          take: 5,
        },
        invoices: {
          orderBy: { created_at: 'desc' },
          take: 5,
        },
        documents: {
          orderBy: { created_at: 'desc' },
          take: 10,
        },
        planner_assignments: {
          include: {
            asset: true,
          },
        },
        change_logs: {
          orderBy: { created_at: 'desc' },
          take: 20,
        },
      },
      orderBy: { updated_at: 'desc' },
    });

    // Get status colors from job_statuses table
    const statuses = await prisma.jobStatus.findMany();
    const statusMap = {};
    statuses.forEach(s => { statusMap[s.name] = s.color; });

    // Enhance jobs with status color
    const enhancedJobs = jobs.map(job => ({
      ...job,
      status_color: statusMap[job.status] || '#64748b',
    }));

    res.json({
      synced_at: new Date().toISOString(),
      count: enhancedJobs.length,
      jobs: enhancedJobs,
    });
  } catch (error) {
    console.error('[AI Sync] Error fetching jobs:', error);
    res.status(500).json({ error: 'Failed to fetch jobs for AI sync' });
  }
}));

/**
 * PUT /api/crm/jobs/:id/ai-update
 * 
 * Allows AI system to update specific job fields (status, notes).
 * Authentication: API key with crm:write scope
 * 
 * Allowed fields:
 * - status_id: ID of new status (from job_statuses table)
 * - status_name: Name of new status (alternative to status_id)
 * - notes: Replace internal_notes field
 * - append_notes: Append to internal_notes with timestamp
 * 
 * Updates are logged to JobChangeLog with change_type='ai_update'
 */
router.put('/jobs/:id/ai-update', authenticateApiKey, requireScope('crm:write'), wrap(async (req, res) => {
  const jobId = parseInt(req.params.id);
  if (isNaN(jobId)) {
    return res.status(400).json({ error: 'Invalid job ID' });
  }

  const { status_id, status_name, notes, append_notes } = req.body;
  
  // Validate at least one field is provided
  if (!status_id && !status_name && !notes && !append_notes) {
    return res.status(400).json({ error: 'At least one field must be provided (status_id, status_name, notes, or append_notes)' });
  }

  try {
    // Check if job exists
    const existingJob = await prisma.crmJob.findUnique({
      where: { id: jobId },
    });

    if (!existingJob) {
      return res.status(404).json({ error: 'Job not found' });
    }

    // Resolve status if status_name is provided
    let resolvedStatusId = status_id;
    let resolvedStatusName = null;

    if (status_name) {
      const status = await prisma.jobStatus.findFirst({
        where: { name: status_name },
      });

      if (!status) {
        return res.status(400).json({ error: `Status "${status_name}" not found` });
      }

      resolvedStatusId = status.id;
      resolvedStatusName = status.name;
    } else if (status_id) {
      const status = await prisma.jobStatus.findUnique({
        where: { id: status_id },
      });

      if (!status) {
        return res.status(400).json({ error: `Status ID ${status_id} not found` });
      }

      resolvedStatusName = status.name;
    }

    // Prepare update data
    const updateData = {};
    const changeLogs = [];

    if (resolvedStatusId && resolvedStatusName) {
      updateData.status = resolvedStatusName;
      changeLogs.push({
        field_name: 'status',
        old_value: existingJob.status,
        new_value: resolvedStatusName,
        change_type: 'ai_update',
        ip_address: req.ip,
        user_agent: req.headers['user-agent'],
      });
    }

    if (notes !== undefined) {
      updateData.internal_notes = notes;
      changeLogs.push({
        field_name: 'internal_notes',
        old_value: existingJob.internal_notes,
        new_value: notes,
        change_type: 'ai_update',
        ip_address: req.ip,
        user_agent: req.headers['user-agent'],
      });
    }

    if (append_notes) {
      const timestamp = new Date().toISOString().split('T')[0];
      const appendedNotes = existingJob.internal_notes 
        ? `${existingJob.internal_notes}\n\n[${timestamp}] AI Update: ${append_notes}`
        : `[${timestamp}] AI Update: ${append_notes}`;
      
      updateData.internal_notes = appendedNotes;
      changeLogs.push({
        field_name: 'internal_notes',
        old_value: existingJob.internal_notes,
        new_value: appendedNotes,
        change_type: 'ai_update',
        ip_address: req.ip,
        user_agent: req.headers['user-agent'],
      });
    }

    // Update the job
    const updatedJob = await prisma.crmJob.update({
      where: { id: jobId },
      data: {
        ...updateData,
        updated_at: new Date(),
      },
    });

    // Log changes to audit trail
    if (changeLogs.length > 0) {
      await Promise.all(
        changeLogs.map(log =>
          prisma.jobChangeLog.create({
            data: {
              job_id: jobId,
              user_id: req.user.id, // Will be 0 for env keys, negative for DB keys
              field_name: log.field_name,
              old_value: log.old_value,
              new_value: log.new_value,
              change_type: log.change_type,
              ip_address: log.ip_address,
              user_agent: log.user_agent,
            },
          })
        )
      );
    }

    res.json({
      success: true,
      message: 'Job updated successfully',
      job: updatedJob,
      changes: changeLogs.map(log => log.field_name),
    });
  } catch (error) {
    console.error('[AI Update] Error updating job:', error);
    res.status(500).json({ error: 'Failed to update job' });
  }
}));

module.exports = router;