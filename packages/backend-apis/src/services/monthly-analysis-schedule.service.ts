import { getTemporalClient } from '../config/temporal-client';
import { TASK_QUEUES } from '../../../temporal-workflows/src/shared/constants';
import { logger } from '../utils/logger';

/**
 * Per-tenant Temporal Schedule registration for the monthly note.
 *
 * Registered together with the daily analysis schedule (see
 * `analysis-schedule.service.ts`): whenever a tenant gets a daily analysis
 * schedule they also get this monthly rollup. The two run as a pair — the
 * monthly fires daily at 04:10, 10 minutes after the daily analysis at 04:00,
 * so that day's summary is already written before the rollup reads it. The
 * Schedule always targets the current month; the workflow's skip-when-unchanged
 * rule keeps the daily cadence cheap.
 *
 * Idempotent: a second call is a no-op because Temporal returns
 * `ScheduleAlreadyRunning` which we swallow. Failures are logged but never
 * thrown — schedule registration must not affect the caller's HTTP response.
 * A missed registration is recoverable via `scripts/seed-daily-analysis-schedules.ts`
 * (which registers both) or by re-hitting an analysis endpoint.
 */

const DEFAULT_TZ = process.env.DEFAULT_TENANT_TZ || 'UTC';

function scheduleIdFor(userId: string): string {
  return `monthly-note-${userId}`;
}

function workflowIdFor(userId: string): string {
  return `monthly-note-wf-${userId}`;
}

export async function ensureMonthlyNoteSchedule(
  userId: string,
  opts: { timezone?: string } = {}
): Promise<void> {
  const tz = opts.timezone ?? DEFAULT_TZ;
  try {
    const client = await getTemporalClient();
    await client.schedule.create({
      scheduleId: scheduleIdFor(userId),
      // 04:10 — 10 minutes after the 04:00 daily analysis, so the day's
      // summary is already persisted before this rollup reads it.
      spec: { cronExpressions: ['10 4 * * *'], timezone: tz },
      action: {
        type: 'startWorkflow',
        workflowType: 'monthlyFinancialNoteWorkflow',
        workflowId: workflowIdFor(userId),
        taskQueue: TASK_QUEUES.PIPELINE,
        // year/month intentionally omitted: the activity resolves the current
        // month at fire time so each daily run targets the right month.
        args: [{ userId }],
      },
    });
    logger.info('Registered monthly note schedule', { userId, tz });
  } catch (err: any) {
    const message = err?.message ?? String(err);
    const isAlreadyExists =
      err?.name === 'ScheduleAlreadyRunning' ||
      message.includes('AlreadyExists') ||
      message.includes('already exists') ||
      message.includes('already running');
    if (isAlreadyExists) return;
    logger.warn('Failed to register monthly note schedule', { userId, error: message });
  }
}
