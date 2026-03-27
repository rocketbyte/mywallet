/**
 * Gmail Subscription Workflow
 *
 * Manages the complete lifecycle of a Gmail watch subscription for one user:
 *
 *  1. Persists the Gmail account to MongoDB.
 *  2. Performs an initial OAuth access token refresh.
 *  3. Calls gmail.users.watch() to register the Pub/Sub push subscription.
 *  4. Enters the main loop which:
 *       a. Sleeps until a webhook signal arrives OR the proactive refresh timer fires.
 *       b. Proactively refreshes the access token every PROACTIVE_REFRESH_INTERVAL_MINUTES
 *          (or sooner if fewer than REFRESH_BEFORE_EXPIRY_MINUTES remain).
 *       c. Processes all queued webhook signals — fetches Gmail history changes and
 *          triggers the email-processing workflow for any new messages.
 *       d. Renews the Gmail watch subscription every RENEWAL_BUFFER_DAYS days
 *          (before the 7-day hard expiry enforced by Google).
 *       e. Calls continueAsNew every CONTINUE_AS_NEW_DAYS days to keep Temporal
 *          event history bounded.
 *  5. On receiving a stopSync signal, deactivates the account and exits cleanly.
 *  6. On detecting a permanently revoked refresh token (invalid_grant), marks the
 *     account inactive in MongoDB so the user can be re-prompted to authorize,
 *     then exits the workflow gracefully.
 *
 * External interaction points:
 *  - `incomingWebhook`  signal: sent by the webhook controller on every Pub/Sub push.
 *  - `stopSync`         signal: sent by the unlink endpoint.
 *  - `forceTokenRefresh` signal: sent by admins or a re-auth flow to bypass the timer.
 */
import {
  proxyActivities,
  log,
  sleep,
  defineSignal,
  setHandler,
  condition,
  continueAsNew
} from '@temporalio/workflow';
import type { SyncActivities } from '../infrastructure/temporal/activities/sync.activities';
import type { WorkflowStarterActivities } from '../activities/workflow/workflow-starter.activities';
import {
  GmailSubscriptionInput,
  GmailSubscriptionResult,
  IncomingWebhookSignal,
  ForceTokenRefreshSignal,
  FetchGmailChangesOutput
} from '../shared/types';
import {
  GMAIL_SYNC_TIMEOUTS,
  GMAIL_SYNC_RETRY_POLICIES,
  GMAIL_WATCH_CONFIG,
  GMAIL_SIGNALS,
  TOKEN_REFRESH_CONFIG,
  WORKFLOW_IDS
} from '../shared/constants';

// ---------------------------------------------------------------------------
// Activity proxies
// ---------------------------------------------------------------------------

/**
 * Activities that talk to Gmail / Google OAuth.
 * Uses the GMAIL_API retry policy (backs off on transient 5xx, stops on
 * InvalidGrantError / AuthenticationError which indicate permanent failure).
 */
const gmailSyncActivities = proxyActivities<SyncActivities>({
  startToCloseTimeout: GMAIL_SYNC_TIMEOUTS.RENEW_WATCH,
  retry: GMAIL_SYNC_RETRY_POLICIES.GMAIL_API
});

/**
 * Activities that talk to MongoDB.
 * Shorter timeout and a more aggressive retry since these are fast operations.
 */
const workflowStarterActivities = proxyActivities<WorkflowStarterActivities>({
  startToCloseTimeout: GMAIL_SYNC_TIMEOUTS.DB_OPERATION,
  retry: GMAIL_SYNC_RETRY_POLICIES.DB_OPERATION
});

// ---------------------------------------------------------------------------
// Signal definitions
// ---------------------------------------------------------------------------

/**
 * Sent by the Pub/Sub webhook controller whenever a new Gmail notification
 * arrives. The signal is queued internally and processed in batch.
 */
export const incomingWebhookSignal = defineSignal<[IncomingWebhookSignal]>(
  GMAIL_SIGNALS.INCOMING_WEBHOOK
);

/**
 * Sent by the unlink endpoint. Causes the workflow to stop watching,
 * deactivate the account and exit cleanly.
 */
export const stopSyncSignal = defineSignal(GMAIL_SIGNALS.STOP_SYNC);

/**
 * Sent externally (Temporal UI, admin API, or re-auth flow) to force an
 * immediate token refresh, bypassing the proactive timer.
 * Use this after a user re-authorizes to immediately replace a revoked token.
 */
export const forceTokenRefreshSignal = defineSignal<[ForceTokenRefreshSignal]>(
  GMAIL_SIGNALS.FORCE_TOKEN_REFRESH
);

// ---------------------------------------------------------------------------
// Workflow
// ---------------------------------------------------------------------------

export async function gmailSubscriptionWorkflow(
  input: GmailSubscriptionInput
): Promise<GmailSubscriptionResult> {

  log.info('Gmail Subscription Workflow started', {
    userId: input.userId,
    email: input.email
  });

  // -------------------------------------------------------------------------
  // Workflow state
  // -------------------------------------------------------------------------

  let isActive = true;

  /** The most recently obtained short-lived access token. */
  let currentAccessToken: string | null = null;

  /** Expiry timestamp of the current access token (tracked in workflow state). */
  let tokenExpiresAt: Date | null = null;

  /** Last history ID processed \u2014 used as the baseline for the Gmail History API. */
  let currentHistoryId: string | null = null;

  /** Epoch when this workflow execution started \u2014 used for continueAsNew scheduling. */
  const workflowStartTime = Date.now();

  /** FIFO queue of unprocessed webhook signals. */
  const webhookQueue: IncomingWebhookSignal[] = [];

  /** Set to true when a forceTokenRefresh signal arrives. */
  let forceTokenRefreshPending = false;

  // -------------------------------------------------------------------------
  // Signal handlers
  // -------------------------------------------------------------------------

  setHandler(incomingWebhookSignal, (signal: IncomingWebhookSignal) => {
    log.info('Received incomingWebhook signal', {
      emailAddress: signal.emailAddress,
      historyId: signal.historyId
    });
    webhookQueue.push(signal);
  });

  setHandler(stopSyncSignal, () => {
    log.info('Received stopSync signal \u2014 shutting down workflow gracefully');
    isActive = false;
  });

  setHandler(forceTokenRefreshSignal, (signal: ForceTokenRefreshSignal) => {
    log.info('Received forceTokenRefresh signal', { reason: signal.reason });
    forceTokenRefreshPending = true;
  });

  // -------------------------------------------------------------------------
  // Pure helper \u2014 usable inside workflow code (no activity calls, no I/O)
  // -------------------------------------------------------------------------

  /**
   * Returns true when the in-memory token expiry shows fewer than
   * REFRESH_BEFORE_EXPIRY_MINUTES remaining, making a refresh necessary
   * before the next Gmail API call.
   */
  function isTokenExpiringSoon(): boolean {
    if (!tokenExpiresAt) return true; // No token at all \u2014 must refresh
    const minutesRemaining = (tokenExpiresAt.getTime() - Date.now()) / 60_000;
    return minutesRemaining < TOKEN_REFRESH_CONFIG.REFRESH_BEFORE_EXPIRY_MINUTES;
  }

  /**
   * Returns true if the error message matches any known revocation indicator.
   * When true, the refresh token has been permanently revoked by the user or
   * by Google and no amount of retrying will recover it.
   */
  function isRevocationError(error: unknown): boolean {
    // Temporal wraps activity errors — the real message may be in the cause chain.
    // Walk the entire chain so invalid_grant is caught regardless of wrapping depth.
    let current: unknown = error;
    while (current) {
      const msg = (current as Error)?.message ?? String(current);
      if (TOKEN_REFRESH_CONFIG.REVOCATION_ERROR_TYPES.some(p =>
        msg.toLowerCase().includes(p.toLowerCase())
      )) {
        return true;
      }
      current = (current as any)?.cause;
    }
    return false;
  }

  // -------------------------------------------------------------------------
  // Proactive token refresh helper (calls an activity)
  // -------------------------------------------------------------------------

  /**
   * Runs checkAndRefreshToken and updates workflow state.
   *
   * @param forceRefresh - Pass true to bypass the server-side expiry check and
   *   always call the OAuth endpoint (used after a forceTokenRefresh signal).
   * @returns false when a permanent revocation is detected (caller should stop).
   */
  async function refreshTokenIfNeeded(forceRefresh = false): Promise<boolean> {
    try {
      const result = await gmailSyncActivities.checkAndRefreshToken({
        userId: input.userId,
        refreshToken: input.refreshToken,
        forceRefresh
      });
      currentAccessToken = result.accessToken;
      // Activity results are JSON-deserialized — Date becomes a string in transit.
      tokenExpiresAt = new Date(result.expiresAt);

      log.info('Access token is fresh', {
        expiresAt: result.expiresAt,
        forced: forceRefresh
      });
      return true;
    } catch (error) {
      if (isRevocationError(error)) {
        log.error('Refresh token has been permanently revoked \u2014 stopping workflow', { error });

        // Persist revocation state to DB so the API surface reflects it
        await gmailSyncActivities.updateGmailAccountTokenRevoked({
          userId: input.userId,
          reason: (error as Error).message
        });

        isActive = false;
        return false;
      }
      // Any other error (transient network, 5xx) \u2014 re-throw so Temporal retries
      throw error;
    }
  }

  // -------------------------------------------------------------------------
  // Workflow body
  // -------------------------------------------------------------------------

  try {

    // Step 1: Persist Gmail account to MongoDB (upsert \u2014 safe to replay)
    await gmailSyncActivities.saveGmailAccount({
      userId: input.userId,
      email: input.email,
      refreshToken: input.refreshToken,
      workflowId: input.workflowId,
      pubSubTopicName: input.pubSubTopicName
    });

    // Step 2: Initial token acquisition
    log.info('Performing initial token refresh');
    const tokenOk = await refreshTokenIfNeeded(/* forceRefresh */ true);
    if (!tokenOk) {
      // Refresh token was revoked before we even started \u2014 exit immediately
      return {
        userId: input.userId,
        workflowId: input.workflowId,
        status: 'error',
        message: 'Refresh token revoked on initial startup'
      };
    }

    // Step 3: Register Gmail watch subscription with Pub/Sub
    log.info('Setting up Gmail watch subscription');
    const watchResult = await gmailSyncActivities.renewGmailWatch({
      userId: input.userId,
      accessToken: currentAccessToken!,
      topicName: input.pubSubTopicName
    });
    currentHistoryId = watchResult.historyId;

    log.info('Gmail watch active', {
      historyId: currentHistoryId,
      expiration: watchResult.expiration
    });

    // -----------------------------------------------------------------------
    // Main loop \u2014 runs until stopSync signal or token revocation
    // -----------------------------------------------------------------------
    while (isActive) {

      /**
       * Sleep for the proactive refresh interval, but wake up early if:
       *  - A webhook signal arrives (webhookQueue becomes non-empty)
       *  - A forceTokenRefresh signal arrives
       *  - The token is expiring soon (isTokenExpiringSoon flips to true)
       *  - The stopSync signal flips isActive to false
       */
      const proactiveRefreshMs =
        TOKEN_REFRESH_CONFIG.PROACTIVE_REFRESH_INTERVAL_MINUTES * 60 * 1_000;

      await condition(
        () =>
          webhookQueue.length > 0 ||
          !isActive ||
          forceTokenRefreshPending ||
          isTokenExpiringSoon(),
        proactiveRefreshMs
      );

      // --------------------------------------------------------------------
      // Proactive token refresh (runs on every wake-up that warrants it)
      // --------------------------------------------------------------------
      if (isActive && (isTokenExpiringSoon() || forceTokenRefreshPending)) {
        const forced = forceTokenRefreshPending;
        forceTokenRefreshPending = false; // Consume the flag before the activity

        log.info('Running proactive token refresh', {
          forced,
          tokenExpiringSoon: isTokenExpiringSoon()
        });

        const tokenOk = await refreshTokenIfNeeded(forced);
        if (!tokenOk) break; // Revocation detected \u2014 exit loop
      }

      // Skip processing if we've been told to stop
      if (!isActive) break;

      // --------------------------------------------------------------------
      // Process incoming webhook queue
      // --------------------------------------------------------------------
      while (webhookQueue.length > 0) {
        const webhook = webhookQueue.shift()!;

        try {
          log.info('Processing webhook signal', { historyId: webhook.historyId });

          // Token is guaranteed fresh at this point (refreshed above if needed)
          const changes: FetchGmailChangesOutput = await gmailSyncActivities.fetchGmailChanges({
            userId: input.userId,
            accessToken: currentAccessToken!,
            startHistoryId: currentHistoryId || webhook.historyId
          });

          currentHistoryId = changes.newHistoryId;

          if (changes.messages.length > 0) {
            log.info('New messages found, triggering email-processing workflow', {
              count: changes.messages.length
            });

            await workflowStarterActivities.startEmailProcessingWorkflow({
              userId: input.userId,
              emailIds: changes.messages.map(m => m.id),
              workflowIdPrefix: `${WORKFLOW_IDS.EMAIL_PROCESSING_PREFIX}-${input.userId}`
            });
          }

          log.info('Webhook processed', {
            messagesFound: changes.messages.length,
            newHistoryId: changes.newHistoryId
          });

        } catch (error) {
          log.error('Failed to process webhook \u2014 recording error and continuing', { error });

          await gmailSyncActivities.updateGmailAccount({
            userId: input.userId,
            lastError: (error as Error).message,
            errorCount: 1
          });
        }
      }

      // --------------------------------------------------------------------
      // Gmail watch renewal
      //
      // The condition() above is set to wake after PROACTIVE_REFRESH_INTERVAL_MINUTES
      // (45 min). The watch runs for RENEWAL_BUFFER_DAYS (5 days). After processing
      // all webhooks we always attempt to renew the watch so it never expires.
      // renewGmailWatch is idempotent (it calls gmail.users.watch which returns a
      // new expiry each time).
      // --------------------------------------------------------------------
      if (isActive) {
        log.info('Renewing Gmail watch subscription');

        const renewalResult = await gmailSyncActivities.renewGmailWatch({
          userId: input.userId,
          accessToken: currentAccessToken!,
          topicName: input.pubSubTopicName
        });
        currentHistoryId = renewalResult.historyId;

        log.info('Gmail watch renewed', { newExpiration: renewalResult.expiration });
      }

      // --------------------------------------------------------------------
      // continueAsNew \u2014 reset event history every 30 days to keep Temporal
      // history bounded and queries fast.
      // --------------------------------------------------------------------
      const elapsedDays = (Date.now() - workflowStartTime) / (1_000 * 60 * 60 * 24);
      if (elapsedDays >= GMAIL_WATCH_CONFIG.CONTINUE_AS_NEW_DAYS) {
        log.info('30-day mark reached \u2014 calling continueAsNew to reset event history');
        await continueAsNew<typeof gmailSubscriptionWorkflow>(input);
      }

    } // end while (isActive)

    // -----------------------------------------------------------------------
    // Cleanup
    // -----------------------------------------------------------------------
    await gmailSyncActivities.deactivateGmailAccount({ userId: input.userId });

    return {
      userId: input.userId,
      workflowId: input.workflowId,
      status: 'stopped',
      message: 'Gmail sync stopped gracefully'
    };

  } catch (error) {
    log.error('Gmail Subscription Workflow failed with unhandled error', { error });

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
