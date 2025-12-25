import {
  proxyActivities,
  log,
  sleep,
  defineSignal,
  setHandler,
  condition,
  continueAsNew
} from '@temporalio/workflow';
import type { GmailSyncActivities } from '../activities/gmail-sync/gmail-sync.activities';
import {
  GmailSubscriptionInput,
  GmailSubscriptionResult,
  IncomingWebhookSignal,
  FetchGmailChangesOutput
} from '../shared/types';
import {
  GMAIL_SYNC_TIMEOUTS,
  GMAIL_SYNC_RETRY_POLICIES,
  GMAIL_WATCH_CONFIG,
  GMAIL_SIGNALS
} from '../shared/constants';

// Proxy activities with appropriate timeouts
const gmailSyncActivities = proxyActivities<GmailSyncActivities>({
  startToCloseTimeout: GMAIL_SYNC_TIMEOUTS.RENEW_WATCH,
  retry: GMAIL_SYNC_RETRY_POLICIES.GMAIL_API
});

// Define signals
export const incomingWebhookSignal = defineSignal<[IncomingWebhookSignal]>(
  GMAIL_SIGNALS.INCOMING_WEBHOOK
);
export const stopSyncSignal = defineSignal(GMAIL_SIGNALS.STOP_SYNC);

/**
 * Gmail Subscription Workflow
 *
 * Manages the lifecycle of a Gmail watch subscription:
 * 1. Refreshes access tokens automatically
 * 2. Renews Gmail watch() every 5 days (before 7-day expiration)
 * 3. Handles incoming webhook signals for new emails
 * 4. Implements continueAsNew() for long-running workflows
 */
export async function gmailSubscriptionWorkflow(
  input: GmailSubscriptionInput
): Promise<GmailSubscriptionResult> {
  log.info('Gmail Subscription Workflow started', {
    userId: input.userId,
    email: input.email
  });

  // Workflow state
  let isActive = true;
  let currentAccessToken: string | null = null;
  let currentHistoryId: string | null = null;
  const workflowStartTime = Date.now();

  // Queue for incoming webhook signals
  const webhookQueue: IncomingWebhookSignal[] = [];

  // Set up signal handlers
  setHandler(incomingWebhookSignal, (signal: IncomingWebhookSignal) => {
    log.info('Received webhook signal', {
      emailAddress: signal.emailAddress,
      historyId: signal.historyId
    });
    webhookQueue.push(signal);
  });

  setHandler(stopSyncSignal, () => {
    log.info('Received stop signal, shutting down workflow');
    isActive = false;
  });

  try {
    // Step 1: Save Gmail account to database
    await gmailSyncActivities.saveGmailAccount({
      userId: input.userId,
      email: input.email,
      refreshToken: input.refreshToken,
      workflowId: input.workflowId,
      pubSubTopicName: input.pubSubTopicName
    });

    // Step 2: Refresh access token
    log.info('Refreshing access token');
    const tokenResult = await gmailSyncActivities.refreshGmailToken({
      userId: input.userId,
      refreshToken: input.refreshToken
    });
    currentAccessToken = tokenResult.accessToken;

    // Step 3: Set up initial Gmail watch
    log.info('Setting up Gmail watch subscription');
    const watchResult = await gmailSyncActivities.renewGmailWatch({
      userId: input.userId,
      accessToken: currentAccessToken,
      topicName: input.pubSubTopicName
    });
    currentHistoryId = watchResult.historyId;

    log.info('Gmail watch setup complete', {
      historyId: currentHistoryId,
      expiration: watchResult.expiration
    });

    // Main loop: Renewal + Webhook Processing
    while (isActive) {
      // Calculate sleep duration (5 days for renewal buffer)
      const renewalSleepMs = GMAIL_WATCH_CONFIG.RENEWAL_BUFFER_DAYS * 24 * 60 * 60 * 1000;

      // Sleep with condition to wake on signals
      await condition(
        () => webhookQueue.length > 0 || !isActive,
        renewalSleepMs
      );

      // Process webhook queue
      while (webhookQueue.length > 0) {
        const webhook = webhookQueue.shift()!;

        try {
          log.info('Processing webhook', { historyId: webhook.historyId });

          // Refresh token if needed
          if (!currentAccessToken) {
            const tokenRefresh = await gmailSyncActivities.refreshGmailToken({
              userId: input.userId,
              refreshToken: input.refreshToken
            });
            currentAccessToken = tokenRefresh.accessToken;
          }

          // Fetch new messages using history API
          const changes: FetchGmailChangesOutput = await gmailSyncActivities.fetchGmailChanges({
            userId: input.userId,
            accessToken: currentAccessToken,
            startHistoryId: currentHistoryId || webhook.historyId
          });

          currentHistoryId = changes.newHistoryId;

          log.info('Processed Gmail changes', {
            messagesCount: changes.messages.length,
            newHistoryId: changes.newHistoryId
          });
        } catch (error) {
          log.error('Failed to process webhook', { error });
          await gmailSyncActivities.updateGmailAccount({
            userId: input.userId,
            lastError: (error as Error).message,
            errorCount: 1
          });
        }
      }

      // If still active after processing webhooks, check if renewal is needed
      if (isActive) {
        // Refresh token
        log.info('Refreshing access token for renewal');
        const tokenRefresh = await gmailSyncActivities.refreshGmailToken({
          userId: input.userId,
          refreshToken: input.refreshToken
        });
        currentAccessToken = tokenRefresh.accessToken;

        // Renew Gmail watch
        log.info('Renewing Gmail watch subscription');
        const renewalResult = await gmailSyncActivities.renewGmailWatch({
          userId: input.userId,
          accessToken: currentAccessToken,
          topicName: input.pubSubTopicName
        });
        currentHistoryId = renewalResult.historyId;

        log.info('Gmail watch renewed', {
          newExpiration: renewalResult.expiration
        });
      }

      // Check if we need continueAsNew (after 30 days)
      const elapsedDays = (Date.now() - workflowStartTime) / (1000 * 60 * 60 * 24);
      if (elapsedDays >= GMAIL_WATCH_CONFIG.CONTINUE_AS_NEW_DAYS) {
        log.info('Workflow running for 30 days, calling continueAsNew');

        // Continue as new to maintain history health
        await continueAsNew<typeof gmailSubscriptionWorkflow>(input);
      }
    }

    // Cleanup: Deactivate account
    await gmailSyncActivities.deactivateGmailAccount({
      userId: input.userId
    });

    return {
      userId: input.userId,
      workflowId: input.workflowId,
      status: 'stopped',
      message: 'Gmail sync stopped gracefully'
    };

  } catch (error) {
    log.error('Gmail Subscription Workflow failed', { error });

    await gmailSyncActivities.updateGmailAccount({
      userId: input.userId,
      lastError: (error as Error).message,
      errorCount: 1
    });

    return {
      userId: input.userId,
      workflowId: input.workflowId,
      status: 'error',
      message: (error as Error).message
    };
  }
}
