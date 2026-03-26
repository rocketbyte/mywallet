/**
 * Pipeline Activities (Layer 3 - Interface Adapters)
 * Implements the 3-step AI transaction extraction pipeline.
 *
 * Step 1 — classifyEmail:   AI determines if the email is a bank transaction.
 * Step 2 — extractTransaction: AI extracts structured transaction data.
 * Step 3 — storeTransaction: Persists the result to MongoDB.
 *
 * Every step loads its prompt config from the `pipeline_steps` collection at
 * runtime, so prompts can be updated without redeploying the worker.
 */
import { Context } from '@temporalio/activity';
import { DependencyContainer } from 'tsyringe';

import { IAIGateway } from '../../../application/interfaces/gateways/iai-gateway';
import { IPipelineStepRepository } from '../../../application/interfaces/repositories/ipipeline-step-repository';
import {
  ClassifyEmailInput,
  ClassificationResult,
  ExtractTransactionDataInput,
  RawTransactionData,
  StoreTransactionInput,
  StoredTransactionResult
} from '../../../shared/types';
import { PIPELINE_STEP_KEYS } from '../../../shared/constants';
import { Transaction } from '../../../models/transaction.model';
import { Email } from '../../../models/email.model';

// ---------------------------------------------------------------------------
// Template interpolation helper
// Replaces {{variable}} tokens in a prompt template with actual values.
// ---------------------------------------------------------------------------
function renderTemplate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => vars[key] ?? '');
}

export function createPipelineActivities(container: DependencyContainer) {
  const aiGateway = container.resolve<IAIGateway>('IAIGateway');
  const pipelineStepRepo = container.resolve<IPipelineStepRepository>('IPipelineStepRepository');

  return {
    /**
     * Step 1: Classify Email
     *
     * Asks the AI whether the email contains a bank transaction notification
     * (credit, debit, transfer, payment, refund, etc.).
     * Returns a classification result with confidence score.
     */
    async classifyEmail(input: ClassifyEmailInput): Promise<ClassificationResult> {
      Context.current().heartbeat('started');

      const step = await pipelineStepRepo.getActiveStep(PIPELINE_STEP_KEYS.CLASSIFY_EMAIL);

      const userMessage = renderTemplate(step.userPromptTemplate, {
        email_subject: input.subject,
        email_from: input.from,
        email_body: input.body,
        email_date: new Date(input.date).toISOString()
      });

      // Heartbeat every 20s during the AI call so Temporal detects a crashed
      // worker within heartbeatTimeout (2 min) rather than startToCloseTimeout.
      const heartbeat = setInterval(() => {
        try { Context.current().heartbeat('ai-call-in-progress'); } catch {}
      }, 20_000);

      let result;
      try {
        result = await aiGateway.extractStructuredData({
          systemPrompt: step.systemPrompt,
          userPrompt: userMessage,
          temperature: step.temperature,
          maxTokens: step.maxTokens,
          responseFormat: 'json'
        });
      } finally {
        clearInterval(heartbeat);
      }

      const data = result.data as Partial<ClassificationResult>;

      return {
        isTransaction: data.isTransaction ?? false,
        confidence: data.confidence ?? result.confidence ?? 0,
        transactionType: data.transactionType,
        reasoning: data.reasoning
      };
    },

    /**
     * Step 2: Extract Transaction Data
     *
     * Asks the AI to extract all relevant financial details from the email
     * and return them as structured JSON.
     */
    async extractTransactionData(input: ExtractTransactionDataInput): Promise<RawTransactionData> {
      Context.current().heartbeat('started');

      const step = await pipelineStepRepo.getActiveStep(PIPELINE_STEP_KEYS.EXTRACT_TRANSACTION);

      const userMessage = renderTemplate(step.userPromptTemplate, {
        email_subject: input.subject,
        email_from: input.from,
        email_body: input.body,
        email_date: new Date(input.date).toISOString(),
        transaction_type: input.classificationResult.transactionType ?? ''
      });

      const heartbeat = setInterval(() => {
        try { Context.current().heartbeat('ai-call-in-progress'); } catch {}
      }, 20_000);

      let result;
      try {
        result = await aiGateway.extractStructuredData({
          systemPrompt: step.systemPrompt,
          userPrompt: userMessage,
          temperature: step.temperature,
          maxTokens: step.maxTokens,
          responseFormat: 'json'
        });
      } finally {
        clearInterval(heartbeat);
      }

      const data = result.data as Partial<RawTransactionData>;

      return {
        merchant: data.merchant ?? 'Unknown',
        amount: Number(data.amount) || 0,
        currency: data.currency ?? 'USD',
        transactionDate: data.transactionDate ? new Date(data.transactionDate) : new Date(input.date),
        transactionType: data.transactionType ?? (input.classificationResult.transactionType === 'credit' ? 'credit' : 'debit'),
        bankName: data.bankName ?? '',
        accountLast4: data.accountLast4,
        referenceNumber: data.referenceNumber,
        category: data.category ?? 'Other',
        description: data.description,
        confidence: data.confidence ?? result.confidence ?? 0
      };
    },

    /**
     * Step 3: Store Transaction
     *
     * Persists the extracted transaction data to MongoDB.
     * Marks the source email as processed.
     * Idempotent — if the transaction already exists for the email it is skipped.
     */
    async storeTransaction(input: StoreTransactionInput): Promise<StoredTransactionResult> {
      Context.current().heartbeat();

      // Check for existing transaction to ensure idempotency
      const existing = await Transaction.findOne({
        userId: input.userId,
        emailId: input.emailId
      }).lean();

      if (existing) {
        return {
          transactionId: existing._id.toString(),
          merchant: existing.merchant,
          amount: existing.amount,
          currency: existing.currency
        };
      }

      // Fetch the source email to backfill required fields on the Transaction
      const sourceEmail = await Email.findOne({
        userId: input.userId,
        emailId: input.emailId
      }).lean();

      const transaction = await Transaction.create({
        userId: input.userId,
        emailId: input.emailId,
        emailSubject: sourceEmail?.subject ?? '',
        emailDate: sourceEmail?.date ?? new Date(),
        emailFrom: sourceEmail?.from ?? '',
        rawEmailText: sourceEmail?.body ?? '',

        transactionDate: input.rawData.transactionDate,
        merchant: input.rawData.merchant,
        amount: input.rawData.amount,
        currency: input.rawData.currency,
        transactionType: input.rawData.transactionType,
        bankName: input.rawData.bankName,
        accountNumber: input.rawData.accountLast4 ?? '',
        category: input.rawData.category ?? 'Other',
        confidence: input.rawData.confidence,

        extractedData: input.rawData,
        workflowId: input.workflowId,
        workflowRunId: input.workflowId,
        processedAt: new Date()
      });

      // Mark the email as processed and link to the transaction
      await Email.updateOne(
        { userId: input.userId, emailId: input.emailId },
        {
          $set: {
            isProcessed: true,
            processedAt: new Date(),
            processingWorkflowId: input.workflowId,
            matchedPatternId: input.patternId,
            matchedPatternName: input.patternName,
            transactionId: transaction._id.toString(),
            confidence: input.rawData.confidence
          }
        }
      );

      return {
        transactionId: transaction._id.toString(),
        merchant: transaction.merchant,
        amount: transaction.amount,
        currency: transaction.currency
      };
    }
  };
}

export type PipelineActivities = ReturnType<typeof createPipelineActivities>;
