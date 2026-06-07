/**
 * Recurring Transactions Workflows
 *
 * A single global Temporal Schedule (daily, cron `0 0 * * *`) starts the
 * dispatcher. Each day it copies the previous month's recurrent transactions
 * whose day-of-month matches today (on the month's last day, later source days
 * 29/30/31 collapse onto it). It fans out one fire-and-forget child workflow per
 * tenant, paging over tenants and bounding its own history with continueAsNew.
 * Each child copies the matched rows through an idempotent activity. See the
 * change's `design.md` for the full rationale.
 */
import {
  proxyActivities,
  startChild,
  continueAsNew,
  workflowInfo,
  ParentClosePolicy,
  log,
} from '@temporalio/workflow';

import type { RecurringActivities } from '../infrastructure/temporal/activities/recurring.activities';
import {
  TASK_QUEUES,
  RECURRING_CONFIG,
  RECURRING_ACTIVITY_TIMEOUTS,
  RECURRING_RETRY_POLICY,
} from '../shared/constants';
import { yearMonthKey, recurringSourceWindow } from '../shared/recurring';

const { listUsersWithRecurringTransactions } = proxyActivities<RecurringActivities>({
  startToCloseTimeout: RECURRING_ACTIVITY_TIMEOUTS.LIST_USERS,
  retry: RECURRING_RETRY_POLICY,
});

const { copyRecurringTransactionsForUserPage } = proxyActivities<RecurringActivities>({
  startToCloseTimeout: RECURRING_ACTIVITY_TIMEOUTS.COPY_PAGE,
  retry: RECURRING_RETRY_POLICY,
});

export interface MonthlyRecurringWorkflowInput {
  /** Target (current) month, 1-based. Resolved from workflow time on first run. */
  targetYear?: number;
  targetMonth?: number;
  /** Day-of-month of this run, used in the per-day child workflow id. */
  targetDay?: number;
  /** ISO bounds of the matched source-day slice of the previous month. */
  sourceStart?: string;
  sourceEnd?: string;
  targetYearMonth?: string;
  /** Dispatcher cursor across continueAsNew iterations. */
  userCursor?: string | null;
}

interface UserRecurringWorkflowInput {
  userId: string;
  targetYear: number;
  targetMonth0: number;
  targetYearMonth: string;
  sourceStart: string;
  sourceEnd: string;
}

interface ResolvedWindow {
  targetYear: number;
  targetMonth0: number;
  targetDay: number;
  targetYearMonth: string;
  sourceStart: string;
  sourceEnd: string;
}

/**
 * Resolve this run's target day and the matched source-day slice of the previous
 * month, carried unchanged across continueAsNew iterations. Returns `null` when
 * today has no corresponding previous-month day (so there is nothing to copy).
 */
function resolveWindow(input: MonthlyRecurringWorkflowInput): ResolvedWindow | null {
  if (
    input.targetYear &&
    input.targetMonth &&
    input.targetDay &&
    input.sourceStart &&
    input.sourceEnd &&
    input.targetYearMonth
  ) {
    return {
      targetYear: input.targetYear,
      targetMonth0: input.targetMonth - 1,
      targetDay: input.targetDay,
      targetYearMonth: input.targetYearMonth,
      sourceStart: input.sourceStart,
      sourceEnd: input.sourceEnd,
    };
  }
  // Date is deterministic inside the Temporal workflow sandbox.
  const now = new Date();
  const window = recurringSourceWindow(now);
  if (!window) return null;
  return {
    targetYear: now.getFullYear(),
    targetMonth0: now.getMonth(),
    targetDay: now.getDate(),
    targetYearMonth: yearMonthKey(now),
    sourceStart: window.sourceStart.toISOString(),
    sourceEnd: window.sourceEnd.toISOString(),
  };
}

/**
 * Daily dispatcher: for today's matched previous-month day, pages over tenants
 * with a recurrent row on that day and starts one abandoned child per tenant,
 * then continueAsNew with the next cursor so its history never grows with the
 * tenant count. A no-op on days with no corresponding previous-month day.
 */
export async function monthlyRecurringTransactionsWorkflow(
  input: MonthlyRecurringWorkflowInput = {},
): Promise<void> {
  const w = resolveWindow(input);
  if (!w) {
    log.info('Recurring dispatcher: no source day to copy today');
    return;
  }
  const cursor = input.userCursor ?? null;

  const { userIds, nextCursor } = await listUsersWithRecurringTransactions({
    sourceStart: w.sourceStart,
    sourceEnd: w.sourceEnd,
    afterUserId: cursor,
    limit: RECURRING_CONFIG.USER_PAGE_SIZE,
  });

  log.info('Recurring dispatcher page', {
    targetYearMonth: w.targetYearMonth,
    cursor,
    users: userIds.length,
  });

  const dayStamp = `${w.targetYearMonth}-${String(w.targetDay).padStart(2, '0')}`;

  for (const userId of userIds) {
    try {
      // Deterministic per-day child id → a duplicate fire / replay does not
      // double-start this tenant's run, while different days each get their own.
      await startChild(userMonthlyRecurringTransactionsWorkflow, {
        workflowId: `recurring-user-${userId}-${dayStamp}`,
        taskQueue: TASK_QUEUES.RECURRING,
        parentClosePolicy: ParentClosePolicy.ABANDON,
        args: [
          {
            userId,
            targetYear: w.targetYear,
            targetMonth0: w.targetMonth0,
            targetYearMonth: w.targetYearMonth,
            sourceStart: w.sourceStart,
            sourceEnd: w.sourceEnd,
          },
        ],
      });
    } catch (err: any) {
      // Already-started for this tenant+month is the idempotent happy path.
      if (!String(err?.name ?? err).includes('AlreadyStarted')) throw err;
    }
  }

  if (!nextCursor) {
    log.info('Recurring dispatcher complete', { targetYearMonth: w.targetYearMonth });
    return;
  }

  // Bound history: hand the cursor to a fresh execution.
  await continueAsNew<typeof monthlyRecurringTransactionsWorkflow>({
    targetYear: w.targetYear,
    targetMonth: w.targetMonth0 + 1,
    targetDay: w.targetDay,
    sourceStart: w.sourceStart,
    sourceEnd: w.sourceEnd,
    targetYearMonth: w.targetYearMonth,
    userCursor: nextCursor,
  });
}

/**
 * Per-tenant child: pages over the user's previous-month recurrent rows, copying
 * each page idempotently. continueAsNew guards against an unusually large series.
 */
export async function userMonthlyRecurringTransactionsWorkflow(
  input: UserRecurringWorkflowInput,
  afterId: string | null = null,
): Promise<void> {
  let cursor = afterId;
  let pages = 0;

  while (true) {
    const res = await copyRecurringTransactionsForUserPage({
      userId: input.userId,
      sourceStart: input.sourceStart,
      sourceEnd: input.sourceEnd,
      targetYear: input.targetYear,
      targetMonth0: input.targetMonth0,
      targetYearMonth: input.targetYearMonth,
      afterId: cursor,
      limit: RECURRING_CONFIG.ROW_PAGE_SIZE,
    });

    cursor = res.nextCursor;
    pages += 1;
    if (!cursor) return;

    // A pathologically large per-user series: reset history and continue.
    if (workflowInfo().historyLength >= RECURRING_CONFIG.CONTINUE_AS_NEW_HISTORY_LENGTH) {
      await continueAsNew<typeof userMonthlyRecurringTransactionsWorkflow>(input, cursor);
    }
  }
}
