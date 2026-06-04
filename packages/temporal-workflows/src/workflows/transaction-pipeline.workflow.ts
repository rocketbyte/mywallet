/**
 * Transaction Pipeline Workflow
 *
 * Durable 3-step Temporal workflow for AI-powered transaction extraction.
 *
 * Step 1 — classifyEmail:      AI decides if the email is a bank transaction.
 * Step 2 — extractTransaction: AI extracts structured financial data.
 * Step 3 — storeTransaction:   Persists the transaction to MongoDB.
 *
 * Each step uses a dynamic prompt loaded from the `pipeline_steps` collection,
 * making the AI behaviour fully customisable at runtime without redeployment.
 *
 * The workflow is triggered as a child workflow from emailProcessingWorkflow
 * and can also be triggered directly via the pipeline API.
 */
import { proxyActivities, log, workflowInfo } from '@temporalio/workflow';

import type { PipelineActivities } from '../infrastructure/temporal/activities/pipeline.activities';
import {
  TransactionPipelineInput,
  TransactionPipelineResult
} from '../shared/types';
import {
  PIPELINE_ACTIVITY_TIMEOUTS,
  PIPELINE_HEARTBEAT_TIMEOUT,
  PIPELINE_RETRY_POLICY,
  CLASSIFICATION_CONFIDENCE_THRESHOLD
} from '../shared/constants';

// AI activities: generous startToClose + heartbeatTimeout so Temporal detects
// a crashed worker quickly and reschedules without waiting the full 15 minutes.
const { classifyEmail } = proxyActivities<PipelineActivities>({
  startToCloseTimeout: PIPELINE_ACTIVITY_TIMEOUTS.AI_CALL,
  heartbeatTimeout: PIPELINE_HEARTBEAT_TIMEOUT,
  retry: PIPELINE_RETRY_POLICY
});

const { extractTransactionData } = proxyActivities<PipelineActivities>({
  startToCloseTimeout: PIPELINE_ACTIVITY_TIMEOUTS.AI_CALL,
  heartbeatTimeout: PIPELINE_HEARTBEAT_TIMEOUT,
  retry: PIPELINE_RETRY_POLICY
});

const { storeTransaction } = proxyActivities<PipelineActivities>({
  startToCloseTimeout: PIPELINE_ACTIVITY_TIMEOUTS.STORE,
  retry: PIPELINE_RETRY_POLICY
});

export async function transactionPipelineWorkflow(
  input: TransactionPipelineInput
): Promise<TransactionPipelineResult> {
  log.info('Starting transaction pipeline', {
    userId: input.userId,
    emailId: input.emailId,
    subject: input.subject
  });

  // ── Step 1: Classify ────────────────────────────────────────────────────
  const classification = await classifyEmail({
    userId: input.userId,
    emailId: input.emailId,
    subject: input.subject,
    from: input.from,
    body: input.body,
    date: input.date
  });

  log.info('Classification result', {
    emailId: input.emailId,
    isTransaction: classification.isTransaction,
    confidence: classification.confidence,
    type: classification.transactionType
  });

  if (!classification.isTransaction || classification.confidence < CLASSIFICATION_CONFIDENCE_THRESHOLD) {
    log.info('Email is not a transaction — stopping pipeline', {
      emailId: input.emailId,
      isTransaction: classification.isTransaction,
      confidence: classification.confidence
    });
    return {
      emailId: input.emailId,
      status: 'ignored',
      reason: classification.isTransaction
        ? `Classification confidence too low: ${classification.confidence}`
        : (classification.reasoning ?? 'Not a bank transaction'),
      classificationConfidence: classification.confidence
    };
  }

  // ── Step 2: Extract ─────────────────────────────────────────────────────
  const rawData = await extractTransactionData({
    userId: input.userId,
    emailId: input.emailId,
    subject: input.subject,
    from: input.from,
    body: input.body,
    date: input.date,
    classificationResult: classification
  });

  log.info('Extraction result', {
    emailId: input.emailId,
    merchant: rawData.merchant,
    amount: rawData.amount,
    currency: rawData.currency,
    confidence: rawData.confidence
  });

  // ── Step 3: Store ────────────────────────────────────────────────────────
  const stored = await storeTransaction({
    userId: input.userId,
    emailId: input.emailId,
    rawData,
    workflowId: input.workflowId,
    workflowRunId: workflowInfo().runId,
    patternId: input.patternId,
    patternName: input.patternName
  });

  log.info(stored.isDuplicate ? 'Transaction skipped — duplicate detected' : 'Transaction stored', {
    emailId: input.emailId,
    transactionId: stored.transactionId,
    merchant: stored.merchant,
    amount: stored.amount,
    duplicateReason: stored.duplicateReason
  });

  return {
    emailId: input.emailId,
    status: stored.isDuplicate ? 'duplicate' : 'stored',
    reason: stored.duplicateReason,
    transactionId: stored.transactionId,
    merchant: stored.merchant,
    amount: stored.amount,
    currency: stored.currency,
    classificationConfidence: classification.confidence,
    extractionConfidence: rawData.confidence
  };
}
