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

import { AIGatewayInterface } from '../../../application/interfaces/gateways/ai-gateway.interface';
import { PipelineStepRepositoryInterface } from '../../../application/interfaces/repositories/pipeline-step-repository.interface';
import { TransactionRepositoryInterface } from '../../../application/interfaces/repositories/transaction-repository.interface';
import { EmailRepositoryInterface } from '../../../application/interfaces/repositories/email-repository.interface';
import {
  ClassifyEmailInput,
  ClassificationResult,
  ExtractTransactionDataInput,
  RawTransactionData,
  StoreTransactionInput,
  StoredTransactionResult
} from '../../../shared/types';
import { PIPELINE_STEP_KEYS } from '../../../shared/constants';

// ---------------------------------------------------------------------------
// Template interpolation helper
// Replaces {{variable}} tokens in a prompt template with actual values.
// ---------------------------------------------------------------------------
function renderTemplate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => vars[key] ?? '');
}

export function createPipelineActivities(container: DependencyContainer) {
  const aiGateway = container.resolve<AIGatewayInterface>('AIGatewayInterface');
  const pipelineStepRepo = container.resolve<PipelineStepRepositoryInterface>('PipelineStepRepositoryInterface');
  const transactionRepo = container.resolve<TransactionRepositoryInterface>('TransactionRepositoryInterface');
  const emailRepo = container.resolve<EmailRepositoryInterface>('EmailRepositoryInterface');

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
     * Persists the extracted transaction data via the injected repositories.
     * Marks the source email as processed.
     * Idempotent — if the transaction already exists for the email it is skipped.
     */
    async storeTransaction(input: StoreTransactionInput): Promise<StoredTransactionResult> {
      Context.current().heartbeat();

      // Idempotency check — scoped to tenant
      const existing = await transactionRepo.findByEmailId(input.userId, input.emailId);
      if (existing) {
        return {
          transactionId: existing.id,
          merchant: existing.merchant,
          amount: existing.amount,
          currency: existing.currency
        };
      }

      // Fetch source email to denormalize fields onto the transaction record
      const sourceEmail = await emailRepo.findById(input.userId, input.emailId);

      const transaction = await transactionRepo.save({
        id: '',
        emailId: input.emailId,
        userId: input.userId,
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
        workflowId: input.workflowId,
        workflowRunId: input.workflowRunId,
        rawData: input.rawData
      } as any);

      await emailRepo.updateProcessingStatus(input.emailId, {
        isProcessed: true,
        processedAt: new Date(),
        workflowId: input.workflowId,
        transactionId: transaction.id,
        confidence: input.rawData.confidence,
        matchedPatternId: input.patternId,
        matchedPatternName: input.patternName
      });

      return {
        transactionId: transaction.id,
        merchant: transaction.merchant,
        amount: transaction.amount,
        currency: transaction.currency
      };
    }
  };
}

export type PipelineActivities = ReturnType<typeof createPipelineActivities>;
