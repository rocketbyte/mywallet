/**
 * Daily Transaction Analysis Workflow
 *
 * Runs once a day per tenant (registered as a Temporal Schedule, cron 0 4 * * *
 * in tenant timezone). Reads yesterday's transactions, current balance, and
 * the current-month budget snapshot; produces a structured AI report with
 * short + full summaries and suggestions; persists it.
 *
 * Failures still persist a row with status: "failed" so the read API can
 * tell the user today was attempted rather than silently returning yesterday.
 */
import { proxyActivities, log } from '@temporalio/workflow';

import type { AnalysisActivities } from '../infrastructure/temporal/activities/analysis.activities';
import {
  DailyAnalysisWorkflowInput,
  DailyAnalysisWorkflowResult,
} from '../shared/types';
import {
  PIPELINE_ACTIVITY_TIMEOUTS,
  PIPELINE_HEARTBEAT_TIMEOUT,
  ANALYSIS_RETRY_POLICY,
} from '../shared/constants';

const { aggregateDailyContext, persistDailyAnalysis } = proxyActivities<AnalysisActivities>({
  startToCloseTimeout: PIPELINE_ACTIVITY_TIMEOUTS.STORE,
  retry: ANALYSIS_RETRY_POLICY,
});

const { analyzeDailyContext } = proxyActivities<AnalysisActivities>({
  startToCloseTimeout: PIPELINE_ACTIVITY_TIMEOUTS.AI_CALL,
  heartbeatTimeout: PIPELINE_HEARTBEAT_TIMEOUT,
  retry: ANALYSIS_RETRY_POLICY,
});

export async function dailyTransactionAnalysisWorkflow(
  input: DailyAnalysisWorkflowInput
): Promise<DailyAnalysisWorkflowResult> {
  log.info('Starting daily transaction analysis', { userId: input.userId, analysisDateInput: input.analysisDate ?? null });

  const context = await aggregateDailyContext({
    userId: input.userId,
    analysisDate: input.analysisDate,
  });

  // The activity resolves "yesterday in UTC" when no analysisDate is provided.
  // Use the resolved value everywhere downstream so the persisted row, logs,
  // and the (userId, analysisDate) upsert key are all self-consistent.
  const analysisDate = context.analysisDate;

  log.info('Aggregated daily context', {
    userId: input.userId,
    analysisDate,
    transactionCount: context.transactions.length,
    priorSummaries: context.priorSummaries.length,
    hasBudget: context.budgetSnapshot !== null,
  });

  try {
    const ai = await analyzeDailyContext(context);

    const { analysisId } = await persistDailyAnalysis({
      userId: input.userId,
      analysisDate,
      currency: context.currency,
      language: context.language,
      inputs: {
        transactionCount: context.transactions.length,
        totals: context.totals,
        balance: context.balance,
        budgetSnapshot: context.budgetSnapshot,
      },
      ai,
      status: 'ready',
    });

    log.info('Daily analysis ready', { analysisId, userId: input.userId, analysisDate });
    return { status: 'ready', analysisId };
  } catch (err: any) {
    const reason = err?.message ?? 'analyze step failed';
    log.error('Daily analysis failed — persisting failed-status row', { userId: input.userId, analysisDate, reason });

    const { analysisId } = await persistDailyAnalysis({
      userId: input.userId,
      analysisDate,
      currency: context.currency,
      language: context.language,
      inputs: {
        transactionCount: context.transactions.length,
        totals: context.totals,
        balance: context.balance,
        budgetSnapshot: context.budgetSnapshot,
      },
      ai: null,
      status: 'failed',
      failureReason: reason,
    });

    return { status: 'failed', analysisId, reason };
  }
}
