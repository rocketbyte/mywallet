import { getTemporalClient } from '../config/temporal-client';
import { TASK_QUEUES } from '../../../temporal-workflows/src/shared/constants';
import { logger } from '../utils/logger';

/**
 * Lazy per-tenant Temporal Schedule registration.
 *
 * Called from the analysis read endpoints so a tenant's nightly Schedule
 * gets created the first time they actually look at insights — no auth-path
 * coupling, no work for tenants who never open the app. Idempotent: a
 * second call is a no-op because Temporal returns `ScheduleAlreadyRunning`
 * which we swallow.
 *
 * Failures are logged but never thrown — schedule registration must not
 * affect the caller's HTTP response. A missed registration is recoverable
 * via `scripts/seed-daily-analysis-schedules.ts` or by re-hitting the
 * endpoint after Temporal recovers.
 */

const DEFAULT_TZ = process.env.DEFAULT_TENANT_TZ || 'UTC';

function scheduleIdFor(userId: string): string {
  return `daily-analysis-${userId}`;
}

function workflowIdFor(userId: string): string {
  return `daily-analysis-wf-${userId}`;
}

export async function ensureDailyAnalysisSchedule(
  userId: string,
  opts: { timezone?: string } = {}
): Promise<void> {
  const tz = opts.timezone ?? DEFAULT_TZ;
  try {
    const client = await getTemporalClient();
    await client.schedule.create({
      scheduleId: scheduleIdFor(userId),
      spec: { cronExpressions: ['0 4 * * *'], timezone: tz },
      action: {
        type: 'startWorkflow',
        workflowType: 'dailyTransactionAnalysisWorkflow',
        workflowId: workflowIdFor(userId),
        taskQueue: TASK_QUEUES.PIPELINE,
        // analysisDate intentionally omitted: the activity computes
        // "yesterday in UTC" at fire time so each daily cron run targets
        // the correct calendar day. Baking a static date into the Schedule
        // would freeze every future run on the same day.
        args: [{ userId }],
      },
    });
    logger.info('Registered daily analysis schedule', { userId, tz });
  } catch (err: any) {
    const message = err?.message ?? String(err);
    const isAlreadyExists =
      err?.name === 'ScheduleAlreadyRunning' ||
      message.includes('AlreadyExists') ||
      message.includes('already exists') ||
      message.includes('already running');
    if (isAlreadyExists) return;
    logger.warn('Failed to register daily analysis schedule', { userId, error: message });
  }
}

/**
 * Fire-and-forget wrapper for endpoints that shouldn't block on Temporal.
 * Errors land in the logger via the underlying helper.
 */
export function ensureDailyAnalysisScheduleDetached(
  userId: string,
  opts: { timezone?: string } = {}
): void {
  void ensureDailyAnalysisSchedule(userId, opts).catch(() => {
    // Already logged inside the helper; this catch is just defence in depth.
  });
}
