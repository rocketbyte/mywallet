/**
 * One-shot entry that upserts the single global recurring-transactions Schedule.
 *
 * Run by the Helm post-install/post-upgrade hook (using the backend image) so the
 * schedule is (re)registered on every deploy. Idempotent via a fixed scheduleId —
 * it never creates a duplicate. Exits non-zero on a genuine failure so the hook
 * Job (and therefore the release) surfaces the problem.
 *
 * The whole operation is bounded by a deadline: a hung Temporal connection or
 * RPC must fail the process (so the Job's `backoffLimit` can retry) rather than
 * block until Helm's hook wait times out — the failure mode that stalled deploys.
 */
import { ensureRecurringSchedule } from '../services/recurring-schedule.service';
import { logger } from '../utils/logger';

const DEADLINE_MS = parseInt(process.env.RECURRING_SEED_TIMEOUT_MS || '60000', 10);

function withDeadline<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`ensure-recurring-schedule: timed out after ${ms}ms`)),
      ms,
    );
    promise.then(
      (value) => { clearTimeout(timer); resolve(value); },
      (err) => { clearTimeout(timer); reject(err); },
    );
  });
}

withDeadline(ensureRecurringSchedule(), DEADLINE_MS)
  .then(() => {
    logger.info('ensure-recurring-schedule: done');
    process.exit(0);
  })
  .catch((err) => {
    logger.error('ensure-recurring-schedule: failed', { error: err?.message ?? String(err) });
    process.exit(1);
  });
