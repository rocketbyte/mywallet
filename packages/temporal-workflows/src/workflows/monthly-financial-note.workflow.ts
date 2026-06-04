/**
 * Monthly Financial Note Workflow
 *
 * Runs once a day per tenant (registered as a Temporal Schedule, cron
 * 30 4 * * * in tenant timezone) and always targets the current month. Rolls
 * the month's daily analysis summaries plus a pre-computed numeric block into
 * a single short `note` for the dashboard MONTHLY NOTE card.
 *
 * Token discipline: the AI step is skipped entirely when the month's inputs
 * are unchanged since the last successful run (sourceHash match), so a daily
 * cadence costs at most one tiny call per tenant — and zero on quiet days or
 * manual reruns.
 *
 * Failures still persist a row with status: "failed" so the read API can tell
 * the user the month was attempted rather than returning a stale note.
 */
import { proxyActivities, log } from '@temporalio/workflow';

import type { MonthlyAnalysisActivities } from '../infrastructure/temporal/activities/monthly-analysis.activities';
import {
  MonthlyNoteWorkflowInput,
  MonthlyNoteWorkflowResult,
} from '../shared/types';
import {
  PIPELINE_ACTIVITY_TIMEOUTS,
  PIPELINE_HEARTBEAT_TIMEOUT,
  ANALYSIS_RETRY_POLICY,
} from '../shared/constants';
import { shouldSkipMonthlyNote } from '../shared/monthly-note';

const { aggregateMonthlyContext, persistMonthlyAnalysis } = proxyActivities<MonthlyAnalysisActivities>({
  startToCloseTimeout: PIPELINE_ACTIVITY_TIMEOUTS.STORE,
  retry: ANALYSIS_RETRY_POLICY,
});

const { analyzeMonthlyContext } = proxyActivities<MonthlyAnalysisActivities>({
  startToCloseTimeout: PIPELINE_ACTIVITY_TIMEOUTS.AI_CALL,
  heartbeatTimeout: PIPELINE_HEARTBEAT_TIMEOUT,
  retry: ANALYSIS_RETRY_POLICY,
});

export async function monthlyFinancialNoteWorkflow(
  input: MonthlyNoteWorkflowInput
): Promise<MonthlyNoteWorkflowResult> {
  log.info('Starting monthly financial note', {
    userId: input.userId,
    year: input.year ?? null,
    month: input.month ?? null,
  });

  const context = await aggregateMonthlyContext({
    userId: input.userId,
    year: input.year,
    month: input.month,
  });

  // The activity resolves the current month when none is provided. Use the
  // resolved values downstream so the persisted row, logs, and upsert key are
  // self-consistent.
  const { year, month } = context;

  log.info('Aggregated monthly context', {
    userId: input.userId,
    year,
    month,
    dailyCount: context.dailyCount,
    hasBudget: context.budgetSnapshot !== null,
    hasPriorNote: context.priorMonthNote !== null,
  });

  // Skip-when-unchanged: a ready row whose sourceHash matches the freshly
  // aggregated inputs means nothing moved — return without calling the AI.
  if (context.existing && shouldSkipMonthlyNote(context.existing, context.sourceHash)) {
    log.info('Monthly note unchanged — skipping AI call', {
      userId: input.userId,
      year,
      month,
      analysisId: context.existing.analysisId,
    });
    return { status: 'skipped', analysisId: context.existing.analysisId };
  }

  try {
    const ai = await analyzeMonthlyContext(context);

    const { analysisId } = await persistMonthlyAnalysis({
      userId: input.userId,
      year,
      month,
      currency: context.currency,
      inputs: {
        dailyCount: context.dailyCount,
        totals: context.totals,
        balance: context.balance,
        budgetSnapshot: context.budgetSnapshot,
        sourceHash: context.sourceHash,
      },
      ai,
      status: 'ready',
    });

    log.info('Monthly note ready', { analysisId, userId: input.userId, year, month });
    return { status: 'ready', analysisId };
  } catch (err: any) {
    const reason = err?.message ?? 'analyze step failed';
    log.error('Monthly note failed — persisting failed-status row', {
      userId: input.userId,
      year,
      month,
      reason,
    });

    const { analysisId } = await persistMonthlyAnalysis({
      userId: input.userId,
      year,
      month,
      currency: context.currency,
      inputs: {
        dailyCount: context.dailyCount,
        totals: context.totals,
        balance: context.balance,
        budgetSnapshot: context.budgetSnapshot,
        sourceHash: context.sourceHash,
      },
      ai: null,
      status: 'failed',
      failureReason: reason,
    });

    return { status: 'failed', analysisId, reason };
  }
}
