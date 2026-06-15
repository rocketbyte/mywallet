import { ScheduleOverlapPolicy, ScheduleNotFoundError } from '@temporalio/client';
import { getTemporalClient } from '../config/temporal-client';
import { TASK_QUEUES, RECURRING_CONFIG } from '../../../temporal-workflows/src/shared/constants';
import { logger } from '../utils/logger';

/**
 * Registers the single global daily recurring-transactions Schedule.
 *
 * There is exactly ONE schedule for the whole system (not per-tenant): it runs
 * daily and the dispatcher workflow pages over all tenants. Because the
 * `scheduleId` is a fixed constant (`RECURRING_CONFIG.SCHEDULE_ID`) and this
 * function UPSERTS it (update if present, else create), running it repeatedly —
 * e.g. on every deploy via the Helm post-install hook — can never produce a
 * duplicate schedule; it only keeps the one schedule in sync with the config.
 *
 * Idempotent. Re-registration of an already-correct schedule is a no-op; only a
 * genuine failure throws (so the deploy-time hook Job surfaces real problems
 * rather than silently "succeeding").
 */
const DEFAULT_TZ = process.env.DEFAULT_TENANT_TZ || 'UTC';

export async function ensureRecurringSchedule(opts: { timezone?: string } = {}): Promise<void> {
  const tz = opts.timezone ?? DEFAULT_TZ;
  const action = {
    type: 'startWorkflow' as const,
    workflowType: RECURRING_CONFIG.WORKFLOW_TYPE,
    workflowId: RECURRING_CONFIG.SCHEDULE_ID,
    taskQueue: TASK_QUEUES.RECURRING,
    args: [] as unknown[],
  };
  const spec = { cronExpressions: [RECURRING_CONFIG.CRON], timezone: tz };
  const policies = { overlap: ScheduleOverlapPolicy.SKIP };

  try {
    const client = await getTemporalClient();
    try {
      // Update the existing schedule in place — never a second one.
      const handle = client.schedule.getHandle(RECURRING_CONFIG.SCHEDULE_ID);
      await handle.update(() => ({ action, spec, policies } as any));
      logger.info('Updated recurring-transactions schedule', { scheduleId: RECURRING_CONFIG.SCHEDULE_ID, tz });
    } catch (err: any) {
      const message = err?.message ?? String(err);
      const isNotFound =
        err instanceof ScheduleNotFoundError ||
        message.includes('NotFound') ||
        message.includes('not found');
      if (!isNotFound) throw err;
      await client.schedule.create({ scheduleId: RECURRING_CONFIG.SCHEDULE_ID, spec, action, policies });
      logger.info('Created recurring-transactions schedule', { scheduleId: RECURRING_CONFIG.SCHEDULE_ID, tz });
    }
  } catch (err: any) {
    const message = err?.message ?? String(err);
    // A create/update race that lands "already exists" is a successful no-op.
    if (message.includes('AlreadyRunning') || message.includes('already')) {
      logger.info('Recurring-transactions schedule already present', { scheduleId: RECURRING_CONFIG.SCHEDULE_ID });
      return;
    }
    logger.error('Failed to ensure recurring-transactions schedule', { error: message });
    throw err;
  }
}
