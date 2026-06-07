/**
 * One-shot entry that upserts the single global recurring-transactions Schedule.
 *
 * Run by the Helm post-install/post-upgrade hook (using the backend image) so the
 * schedule is (re)registered on every deploy. Idempotent via a fixed scheduleId —
 * it never creates a duplicate. Exits non-zero on a genuine failure so the hook
 * Job (and therefore the release) surfaces the problem.
 */
import { ensureRecurringSchedule } from '../services/recurring-schedule.service';
import { logger } from '../utils/logger';

ensureRecurringSchedule()
  .then(() => {
    logger.info('ensure-recurring-schedule: done');
    process.exit(0);
  })
  .catch((err) => {
    logger.error('ensure-recurring-schedule: failed', { error: err?.message ?? String(err) });
    process.exit(1);
  });
