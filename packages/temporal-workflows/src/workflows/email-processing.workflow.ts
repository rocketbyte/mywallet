import { proxyActivities, executeChild, sleep, log } from '@temporalio/workflow';
import type { GmailActivities } from '../activities/gmail/gmail.activities';
import type { EmailActivities } from '../activities/database/email.activities';
import {
  EmailProcessingInput,
  EmailProcessingResult
} from '../shared/types';
import { ACTIVITY_TIMEOUTS, RETRY_POLICIES, TASK_QUEUES } from '../shared/constants';
import { transactionPipelineWorkflow } from './transaction-pipeline.workflow';

// Proxy activities with their respective configurations
const gmailActivities = proxyActivities<GmailActivities>({
  startToCloseTimeout: ACTIVITY_TIMEOUTS.GMAIL_FETCH,
  retry: RETRY_POLICIES.GMAIL
});

const emailActivities = proxyActivities<EmailActivities>({
  startToCloseTimeout: ACTIVITY_TIMEOUTS.DB_OPERATION,
  retry: RETRY_POLICIES.MONGODB
});

/**
 * Main workflow for processing Gmail emails and extracting transactions
 *
 * This workflow:
 * 1. Fetches emails from Gmail based on search criteria
 * 2. Matches emails against known patterns
 * 3. Extracts transaction data using OpenAI
 * 4. Saves transactions to MongoDB
 */
export async function emailProcessingWorkflow(
  input: EmailProcessingInput
): Promise<EmailProcessingResult> {
  log.info('Starting email processing workflow', {
    userId: input.userId,
    workflowId: input.workflowId,
    searchQuery: input.searchQuery,
    emailIds: input.emailIds
  });

  const result: EmailProcessingResult = {
    totalEmails: 0,
    processedCount: 0,
    failedCount: 0,
    transactions: [],
    errors: []
  };

  try {
    // Step 1: Fetch emails (either from Gmail search OR by specific IDs)
    let emails;

    if (input.emailIds && input.emailIds.length > 0) {
      // NEW: Process specific emails (from Gmail sync workflow)
      log.info(`Fetching ${input.emailIds.length} specific emails by ID`);
      emails = await emailActivities.getEmailsByIds({
        userId: input.userId,
        emailIds: input.emailIds
      });
    } else if (input.searchQuery) {
      // Existing: Fetch via Gmail search
      log.info('Fetching emails from Gmail via search');
      emails = await gmailActivities.fetchEmails({
        userId: input.userId,
        query: input.searchQuery,
        maxResults: input.maxResults || 50,
        afterDate: input.afterDate
      });
    } else {
      log.warn('No searchQuery or emailIds provided');
      return result;
    }

    result.totalEmails = emails.length;
    log.info(`Processing ${emails.length} emails for user ${input.userId}`);

    if (emails.length === 0) {
      log.info('No emails to process');
      return result;
    }

    // Step 2: Process each email
    const isSyncPath = !!(input.emailIds && input.emailIds.length > 0);

    for (const email of emails) {
      // In the sync path, emails come from getEmailsByIds which returns:
      //   id = MongoDB _id, emailId = Gmail message ID
      // In the search path, emails come from fetchEmails which returns:
      //   id = Gmail message ID (no emailId field)
      const gmailMessageId: string = (email as any).emailId ?? email.id;

      try {
        log.info(`Processing email: ${gmailMessageId}`, {
          subject: email.subject,
          from: email.from
        });

        // Save raw email only in the search path — in the sync path the email
        // was already persisted by fetchGmailChanges with all required fields.
        if (!isSyncPath) {
          await emailActivities.saveEmail({
            userId: input.userId,
            emailId: gmailMessageId,
            threadId: email.threadId,
            from: email.from,
            to: 'me',
            subject: email.subject,
            date: email.date,
            body: email.body,
            snippet: email.snippet,
            fetchedBy: input.workflowId
          });
        }

        // Run the 3-step AI pipeline as a child workflow.
        // Each step (classify → extract → store) is independently durable.
        const pipelineResult = await executeChild(
          transactionPipelineWorkflow,
          {
            taskQueue: TASK_QUEUES.PIPELINE,
            workflowId: `pipeline-${gmailMessageId}-${input.workflowId}`,
            args: [{
              userId: input.userId,
              emailId: gmailMessageId,
              subject: email.subject,
              from: email.from,
              body: email.body || '',
              date: email.date,
              workflowId: input.workflowId
            }]
          }
        );

        log.info('Pipeline result', { emailId: gmailMessageId, status: pipelineResult.status });

        if (pipelineResult.status === 'ignored') {
          result.errors.push({
            emailId: gmailMessageId,
            error: pipelineResult.reason ?? 'Not a transaction'
          });
          result.failedCount++;
          continue;
        }

        if (pipelineResult.status === 'failed') {
          result.errors.push({
            emailId: gmailMessageId,
            error: pipelineResult.reason ?? 'Pipeline failed'
          });
          result.failedCount++;
          continue;
        }

        // status === 'stored' — mark email as processed in Gmail
        await gmailActivities.markEmailAsProcessed(gmailMessageId);

        result.transactions.push({
          id: pipelineResult.transactionId ?? '',
          emailId: gmailMessageId,
          transactionDate: new Date(),
          merchant: pipelineResult.merchant ?? '',
          amount: pipelineResult.amount ?? 0,
          category: 'Other'
        });
        result.processedCount++;

        log.info('Successfully processed email', {
          emailId: gmailMessageId,
          transactionId: pipelineResult.transactionId,
          merchant: pipelineResult.merchant,
          amount: pipelineResult.amount
        });

        // Rate limiting: small delay between processing emails
        await sleep('100ms');

      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        log.error('Failed to process email', {
          emailId: gmailMessageId,
          error: errorMessage
        });

        // Update email with error status (with userId)
        try {
          await emailActivities.updateEmailProcessing({
            userId: input.userId,
            emailId: gmailMessageId,
            isProcessed: false,
            processedAt: new Date(),
            processingWorkflowId: input.workflowId,
            processingError: errorMessage
          });
        } catch (updateError) {
          log.error('Failed to update email error status', { updateError });
        }

        result.errors.push({
          emailId: gmailMessageId,
          error: errorMessage
        });
        result.failedCount++;
      }
    }

    log.info('Email processing workflow completed', {
      total: result.totalEmails,
      processed: result.processedCount,
      failed: result.failedCount
    });

    return result;

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    log.error('Email processing workflow failed', { error: errorMessage });
    throw error;
  }
}
