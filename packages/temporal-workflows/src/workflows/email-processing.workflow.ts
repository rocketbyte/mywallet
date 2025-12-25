import { proxyActivities, sleep, log } from '@temporalio/workflow';
import type { GmailActivities } from '../activities/gmail/gmail.activities';
import type { OpenAIActivities } from '../activities/openai/openai.activities';
import type { MongoDBActivities } from '../activities/database/mongodb.activities';
import type { EmailActivities } from '../activities/database/email.activities';
import {
  EmailProcessingInput,
  EmailProcessingResult
} from '../shared/types';
import { ACTIVITY_TIMEOUTS, RETRY_POLICIES, CONFIDENCE_THRESHOLD } from '../shared/constants';

// Proxy activities with their respective configurations
const gmailActivities = proxyActivities<GmailActivities>({
  startToCloseTimeout: ACTIVITY_TIMEOUTS.GMAIL_FETCH,
  retry: RETRY_POLICIES.GMAIL
});

const openaiActivities = proxyActivities<OpenAIActivities>({
  startToCloseTimeout: ACTIVITY_TIMEOUTS.OPENAI_EXTRACT,
  retry: RETRY_POLICIES.OPENAI
});

const mongoActivities = proxyActivities<MongoDBActivities>({
  startToCloseTimeout: ACTIVITY_TIMEOUTS.DB_OPERATION,
  retry: RETRY_POLICIES.MONGODB
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
  log.info('Starting email processing workflow', { input });

  const result: EmailProcessingResult = {
    totalEmails: 0,
    processedCount: 0,
    failedCount: 0,
    transactions: [],
    errors: []
  };

  try {
    // Step 1: Fetch emails from Gmail
    log.info('Fetching emails from Gmail');
    const emails = await gmailActivities.fetchEmails({
      query: input.searchQuery,
      maxResults: input.maxResults || 50,
      afterDate: input.afterDate
    });

    result.totalEmails = emails.length;
    log.info(`Fetched ${emails.length} emails`);

    if (emails.length === 0) {
      log.info('No emails found matching query');
      return result;
    }

    // Step 2: Process each email
    for (const email of emails) {
      try {
        log.info(`Processing email: ${email.id}`, {
          subject: email.subject,
          from: email.from
        });

        // Save raw email to database first
        await emailActivities.saveEmail({
          emailId: email.id,
          threadId: email.threadId,
          from: email.from,
          to: 'me',
          subject: email.subject,
          date: email.date,
          body: email.body,
          snippet: email.snippet,
          fetchedBy: input.workflowId
        });

        // Match email against patterns
        const pattern = await mongoActivities.matchEmailPattern({
          from: email.from,
          subject: email.subject,
          body: email.body
        });

        if (!pattern) {
          log.warn('No matching pattern found for email', {
            emailId: email.id,
            subject: email.subject
          });
          result.errors.push({
            emailId: email.id,
            error: 'No matching pattern found'
          });
          result.failedCount++;
          continue;
        }

        log.info(`Matched pattern: ${pattern.name}`, { emailId: email.id });

        // Extract transaction data using OpenAI
        const extractedData = await openaiActivities.extractTransactionFromEmail({
          emailContent: email.body,
          emailSubject: email.subject,
          emailFrom: email.from,
          emailDate: email.date,
          extractionPrompt: pattern.extractionPrompt,
          bankName: pattern.bankName
        });

        log.info('Extraction complete', {
          emailId: email.id,
          merchant: extractedData.merchant,
          amount: extractedData.amount,
          confidence: extractedData.confidence
        });

        // Validate extraction confidence
        if (extractedData.confidence < CONFIDENCE_THRESHOLD) {
          log.warn('Low confidence extraction', {
            emailId: email.id,
            confidence: extractedData.confidence,
            threshold: CONFIDENCE_THRESHOLD
          });
          result.errors.push({
            emailId: email.id,
            error: 'Low confidence extraction',
            confidence: extractedData.confidence
          });

          // Update pattern stats as failed
          await mongoActivities.updateEmailPatternStats({
            patternId: pattern.id,
            success: false
          });

          result.failedCount++;
          continue;
        }

        // Save transaction to MongoDB
        const transaction = await mongoActivities.saveTransaction({
          emailId: email.id,
          emailSubject: email.subject,
          emailDate: email.date,
          emailFrom: email.from,
          rawEmailText: email.body,
          extractedData,
          workflowId: input.workflowId,
          workflowRunId: input.workflowRunId
        });

        // Update pattern statistics
        await mongoActivities.updateEmailPatternStats({
          patternId: pattern.id,
          success: true
        });

        // Mark email as processed
        await gmailActivities.markEmailAsProcessed(email.id);

        // Update email processing status in database
        await emailActivities.updateEmailProcessing({
          emailId: email.id,
          isProcessed: true,
          processedAt: new Date(),
          processingWorkflowId: input.workflowId,
          matchedPatternId: pattern.id,
          matchedPatternName: pattern.name,
          transactionId: transaction.id,
          confidence: extractedData.confidence
        });

        result.transactions.push(transaction);
        result.processedCount++;

        log.info('Successfully processed email', {
          emailId: email.id,
          transactionId: transaction.id,
          merchant: transaction.merchant,
          amount: transaction.amount
        });

        // Rate limiting: small delay between processing emails
        await sleep('100ms');

      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        log.error('Failed to process email', {
          emailId: email.id,
          error: errorMessage
        });

        // Update email with error status
        try {
          await emailActivities.updateEmailProcessing({
            emailId: email.id,
            isProcessed: false,
            processedAt: new Date(),
            processingWorkflowId: input.workflowId,
            processingError: errorMessage
          });
        } catch (updateError) {
          log.error('Failed to update email error status', { updateError });
        }

        result.errors.push({
          emailId: email.id,
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
