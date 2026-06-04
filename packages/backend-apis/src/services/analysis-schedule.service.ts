import type { Client, ScheduleHandle } from '@temporalio/client';
import { getTemporalClient } from '../config/temporal-client';
import { TASK_QUEUES } from '../../../temporal-workflows/src/shared/constants';
import { logger } from '../utils/logger';
import { ensureMonthlyNoteSchedule } from './monthly-analysis-schedule.service';

/**
 * Lazy per-tenant Temporal Schedule registration.
 *
 * Called from the analysis read endpoints so a tenant's nightly Schedule
 * gets created the first time they actually look at insights — no auth-path
 * coupling, no work for tenants who never open the app. Idempotent: a
 * second call is a no-op (or a one-time self-heal, see below).
 *
 * Registering the daily schedule also registers the monthly note schedule for
 * the same tenant — the two run as a pair (monthly fires 10 minutes after the
 * daily analysis and rolls that day's summaries up). So a tenant never has a
 * daily schedule without the matching monthly one.
 *
 * Self-heal: the scheduled action MUST NOT carry a static `analysisDate` — the
 * activity resolves "yesterday in UTC" at fire time. An older build baked the
 * registration-time date into the args, which froze every future run on one
 * day. When the schedule already exists we reconcile that away (a one-time
 * update), so a redeploy / next endpoint hit corrects stale schedules without
 * needing the seed script.
 *
 * Failures are logged but never thrown — schedule registration must not
 * affect the caller's HTTP response.
 */

const DEFAULT_TZ = process.env.DEFAULT_TENANT_TZ || 'UTC';
const DAILY_CRON = '0 4 * * *';

function scheduleIdFor(userId: string): string {
  return `daily-analysis-${userId}`;
}

function workflowIdFor(userId: string): string {
  return `daily-analysis-wf-${userId}`;
}

/**
 * The canonical scheduled action. `analysisDate` is intentionally omitted: the
 * activity computes "yesterday in UTC" at fire time so each daily cron run
 * targets the correct calendar day. Baking a static date here would freeze
 * every future run on the same day.
 */
function dailyAnalysisAction(userId: string) {
  return {
    type: 'startWorkflow' as const,
    workflowType: 'dailyTransactionAnalysisWorkflow',
    workflowId: workflowIdFor(userId),
    taskQueue: TASK_QUEUES.PIPELINE,
    args: [{ userId }],
  };
}

function isAlreadyExists(err: any): boolean {
  const message = err?.message ?? String(err);
  return (
    err?.name === 'ScheduleAlreadyRunning' ||
    message.includes('AlreadyExists') ||
    message.includes('already exists') ||
    message.includes('already running')
  );
}

/**
 * One-time reconcile of an existing schedule whose args still carry a baked-in
 * `analysisDate` (left over from an older build). No-op once healed.
 */
async function reconcileDailyScheduleArgs(
  handle: ScheduleHandle,
  userId: string,
  tz: string
): Promise<void> {
  const desc = await handle.describe();
  const action = desc.action as { args?: unknown[] } | undefined;
  const first = Array.isArray(action?.args) ? (action!.args[0] as Record<string, unknown>) : undefined;
  const hasStaleDate = !!first && typeof first === 'object' && 'analysisDate' in first;
  if (!hasStaleDate) return;

  await handle.update(() => ({
    action: dailyAnalysisAction(userId),
    spec: { cronExpressions: [DAILY_CRON], timezone: tz },
  }) as any);
  logger.info('Healed stale analysisDate in daily analysis schedule', {
    userId,
    removed: first!.analysisDate,
  });
}

export async function ensureDailyAnalysisSchedule(
  userId: string,
  opts: { timezone?: string } = {}
): Promise<void> {
  const tz = opts.timezone ?? DEFAULT_TZ;
  try {
    const client: Client = await getTemporalClient();
    try {
      await client.schedule.create({
        scheduleId: scheduleIdFor(userId),
        spec: { cronExpressions: [DAILY_CRON], timezone: tz },
        action: dailyAnalysisAction(userId),
      });
      logger.info('Registered daily analysis schedule', { userId, tz });
    } catch (err: any) {
      if (!isAlreadyExists(err)) throw err;
      // Schedule already exists — reconcile any stale args, then move on.
      await reconcileDailyScheduleArgs(client.schedule.getHandle(scheduleIdFor(userId)), userId, tz);
    }
  } catch (err: any) {
    logger.warn('Failed to register/reconcile daily analysis schedule', {
      userId,
      error: err?.message ?? String(err),
    });
  }

  // The monthly note schedule is created together with the daily one. Its own
  // helper is idempotent and swallows "already exists", so this is safe to run
  // even when the daily schedule already existed.
  await ensureMonthlyNoteSchedule(userId, opts);
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
