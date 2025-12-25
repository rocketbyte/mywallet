import { proxyActivities, log } from '@temporalio/workflow';
import type { GmailActivities } from '../activities/gmail/gmail.activities';
import type { EmailActivities } from '../activities/database/email.activities';
import type { ScheduleActivities } from '../activities/database/schedule.activities';
import type { OpenAIActivities } from '../activities/openai/openai.activities';
import type { MongoDBActivities } from '../activities/database/mongodb.activities';
import {
  ScheduledEmailProcessingInput,
  ScheduledEmailProcessingResult
} from '../shared/types';
import { ACTIVITY_TIMEOUTS, RETRY_POLICIES, CONFIDENCE_THRESHOLD } from '../shared/constants';

// Proxy activities
const gmailActivities = proxyActivities<GmailActivities>({
  startToCloseTimeout: ACTIVITY_TIMEOUTS.GMAIL_FETCH,
  retry: RETRY_POLICIES.GMAIL
});

const emailActivities = proxyActivities<EmailActivities>({
  startToCloseTimeout: ACTIVITY_TIMEOUTS.DB_OPERATION,
  retry: RETRY_POLICIES.MONGODB
});

const scheduleActivities = proxyActivities<ScheduleActivities>({
  startToCloseTimeout: ACTIVITY_TIMEOUTS.DB_OPERATION,
  retry: RETRY_POLICIES.MONGODB
});

const openaiActivities = proxyActivities<OpenAIActivities>({
  startToCloseTimeout: ACTIVITY_TIMEOUTS.OPENAI_EXTRACT,
  retry: RETRY_POLICIES.OPENAI
});

const mongoActivities = proxyActivities<MongoDBActivities>({
  startToCloseTimeout: ACTIVITY_TIMEOUTS.DB_OPERATION,
  retry: RETRY_POLICIES.MONGODB
});

/**
 * Scheduled workflow that runs periodically to:
 * 1. Fetch emails from Gmail
 * 2. Store raw emails in MongoDB
 * 3. Process unprocessed emails
 * 4. Extract transactions
 * 5. Update statistics
 */
export async function scheduledEmailProcessingWorkflow(
  input: ScheduledEmailProcessingInput
): Promise<ScheduledEmailProcessingResult> {
  const runTimestamp = new Date();

  log.info('Starting scheduled email processing', {
    scheduleId: input.scheduleId,
    searchQuery: input.searchQuery,
    runTimestamp
  });

  const result: ScheduledEmailProcessingResult = {
    scheduleId: input.scheduleId,
    runTimestamp,
    emailsFetched: 0,
    emailsStored: 0,
    emailsProcessed: 0,
    emailsFailed: 0,
    duplicatesSkipped: 0,
    transactions: [],
    errors: []
  };

  try {
    // Get schedule configuration for search query
    const scheduleConfig = await scheduleActivities.getScheduleConfig(input.scheduleId);
    const searchQuery = scheduleConfig?.searchQuery || input.searchQuery;

    log.info('Using search query', { searchQuery });

    // Step 1: Fetch emails from Gmail
    const emails = await gmailActivities.fetchEmails({
      query: searchQuery,
      maxResults: input.maxResults,
      afterDate: input.afterDate
    });

    result.emailsFetched = emails.length;
    log.info(`Fetched ${emails.length} emails from Gmail`);

    if (emails.length === 0) {
      log.info('No new emails found');
      await scheduleActivities.updateScheduleStats({
        scheduleId: input.scheduleId,
        emailsFetched: 0,
        emailsProcessed: 0,
        errors: 0,
        status: 'success'
      });
      return result;
    }

    // Step 2: Store raw emails in MongoDB
    for (const email of emails) {
      try {
        const savedEmail = await emailActivities.saveEmail({
          emailId: email.id,
          threadId: email.threadId,
          from: email.from,
          to: 'me',
          subject: email.subject,
          date: email.date,
          body: email.body,
          snippet: email.snippet,
          fetchedBy: input.scheduleId
        });

        // Check if this was a duplicate
        if (savedEmail.isProcessed && input.skipProcessed) {
          log.info('Email already processed, skipping', { emailId: email.id });
          result.duplicatesSkipped++;
          continue;
        }

        result.emailsStored++;
        log.info(`Stored email: ${email.id}`, { subject: email.subject });

      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        log.error('Failed to store email', { emailId: email.id, error: errorMessage });
        result.errors.push({ emailId: email.id, error: errorMessage });
        result.emailsFailed++;
      }
    }

    // Step 3: Get unprocessed emails and process them
    const unprocessedEmails = await emailActivities.getUnprocessedEmails({
      limit: input.maxResults
    });

    log.info(`Found ${unprocessedEmails.length} unprocessed emails`);

    // Step 4: Process each unprocessed email
    for (const emailRecord of unprocessedEmails) {
      try {
        // Get full email from Gmail (we need the body)
        const fullEmail = emails.find(e => e.id === emailRecord.emailId);
        if (!fullEmail) {
          log.warn('Email not in current batch, skipping', { emailId: emailRecord.emailId });
          continue;
        }

        log.info(`Processing email: ${emailRecord.emailId}`, {
          subject: emailRecord.subject
        });

        // Match email against patterns
        const pattern = await mongoActivities.matchEmailPattern({
          from: fullEmail.from,
          subject: fullEmail.subject,
          body: fullEmail.body
        });

        if (!pattern) {
          log.warn('No matching pattern found', { emailId: emailRecord.emailId });
          await emailActivities.updateEmailProcessing({
            emailId: emailRecord.emailId,
            isProcessed: false,
            processedAt: new Date(),
            processingWorkflowId: input.scheduleId,
            processingError: 'No matching pattern found'
          });
          result.emailsFailed++;
          continue;
        }

        // Extract transaction using OpenAI
        const extractedData = await openaiActivities.extractTransactionFromEmail({
          emailContent: fullEmail.body,
          emailSubject: fullEmail.subject,
          emailFrom: fullEmail.from,
          emailDate: fullEmail.date,
          extractionPrompt: pattern.extractionPrompt,
          bankName: pattern.bankName
        });

        log.info('Transaction extracted', {
          emailId: emailRecord.emailId,
          merchant: extractedData.merchant,
          amount: extractedData.amount,
          confidence: extractedData.confidence
        });

        // Check confidence threshold
        if (extractedData.confidence < CONFIDENCE_THRESHOLD) {
          log.warn('Low confidence extraction', {
            emailId: emailRecord.emailId,
            confidence: extractedData.confidence
          });

          await emailActivities.updateEmailProcessing({
            emailId: emailRecord.emailId,
            isProcessed: false,
            processedAt: new Date(),
            processingWorkflowId: input.scheduleId,
            confidence: extractedData.confidence,
            processingError: `Low confidence: ${extractedData.confidence}`
          });

          await mongoActivities.updateEmailPatternStats({
            patternId: pattern.id,
            success: false
          });

          result.emailsFailed++;
          continue;
        }

        // Save transaction
        const transaction = await mongoActivities.saveTransaction({
          emailId: emailRecord.emailId,
          emailSubject: emailRecord.subject,
          emailDate: emailRecord.date,
          emailFrom: fullEmail.from,
          rawEmailText: fullEmail.body,
          extractedData,
          workflowId: input.scheduleId,
          workflowRunId: 'scheduled'
        });

        // Update pattern stats
        await mongoActivities.updateEmailPatternStats({
          patternId: pattern.id,
          success: true
        });

        // Mark email as processed in Gmail
        await gmailActivities.markEmailAsProcessed(emailRecord.emailId);

        // Update email processing status
        await emailActivities.updateEmailProcessing({
          emailId: emailRecord.emailId,
          isProcessed: true,
          processedAt: new Date(),
          processingWorkflowId: input.scheduleId,
          matchedPatternId: pattern.id,
          matchedPatternName: pattern.name,
          transactionId: transaction.id,
          confidence: extractedData.confidence
        });

        result.transactions.push(transaction);
        result.emailsProcessed++;

        log.info('Successfully processed email', {
          emailId: emailRecord.emailId,
          transactionId: transaction.id
        });

      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        log.error('Failed to process email', {
          emailId: emailRecord.emailId,
          error: errorMessage
        });

        try {
          await emailActivities.updateEmailProcessing({
            emailId: emailRecord.emailId,
            isProcessed: false,
            processedAt: new Date(),
            processingWorkflowId: input.scheduleId,
            processingError: errorMessage
          });
        } catch (updateError) {
          log.error('Failed to update error status', { updateError });
        }

        result.errors.push({
          emailId: emailRecord.emailId,
          error: errorMessage
        });
        result.emailsFailed++;
      }
    }

    // Step 5: Update schedule statistics
    await scheduleActivities.updateScheduleStats({
      scheduleId: input.scheduleId,
      emailsFetched: result.emailsFetched,
      emailsProcessed: result.emailsProcessed,
      errors: result.emailsFailed,
      status: 'success'
    });

    log.info('Scheduled email processing completed', {
      scheduleId: input.scheduleId,
      fetched: result.emailsFetched,
      stored: result.emailsStored,
      processed: result.emailsProcessed,
      failed: result.emailsFailed,
      duplicates: result.duplicatesSkipped
    });

    return result;

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    log.error('Scheduled email processing failed', { error: errorMessage });

    // Update schedule with failure status
    try {
      await scheduleActivities.updateScheduleStats({
        scheduleId: input.scheduleId,
        emailsFetched: result.emailsFetched,
        emailsProcessed: result.emailsProcessed,
        errors: result.emailsFailed + 1,
        status: 'failure'
      });
    } catch (statsError) {
      log.error('Failed to update failure stats', { statsError });
    }

    throw error;
  }
}
