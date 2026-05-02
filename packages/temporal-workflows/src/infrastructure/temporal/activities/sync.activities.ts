/**
 * Sync Activities (Layer 3 - Interface Adapters / Controllers)
 * Handle Mail sync operations (token refresh, watch renewal, etc.)
 */
import { Context } from '@temporalio/activity';
import { DependencyContainer } from 'tsyringe';
import { Connection } from 'mongoose';

// Application Interfaces
import { MailSyncGatewayInterface } from '../../../application/interfaces/gateways/imail-sync-gateway';

// Domain Models (Mongoose)
import { GmailAccount } from '../../../models/gmail-account.model';
import { Email } from '../../../models/email.model';

// Shared Types
import {
  RefreshGmailTokenInput,
  RefreshGmailTokenOutput,
  RefreshGmailTokenWithContextInput,
  RenewGmailWatchInput,
  RenewGmailWatchOutput,
  FetchGmailChangesInput,
  FetchGmailChangesOutput,
  SaveGmailAccountInput,
  UpdateGmailAccountInput,
  GetGmailAccountInput,
  DeactivateGmailAccountInput
} from '../../../shared/types';
import { TOKEN_REFRESH_CONFIG } from '../../../shared/constants';

/**
 * Create Sync Activities using DI Container
 *
 * @param container - DI Container
 */
export function createSyncActivities(container: DependencyContainer) {
  const mailSyncGateway = container.resolve<MailSyncGatewayInterface>('MailSyncGatewayInterface');
  // Resolve MongoConnection to ensure it's loaded, but don't force a type assignment since Mongoose handles it globally
  container.resolve('MongoConnection');

  return {
    /**
     * Refresh Gmail Access Token (basic, always refreshes)
     */
    async refreshGmailToken(input: RefreshGmailTokenInput): Promise<RefreshGmailTokenOutput> {
      Context.current().heartbeat({ userId: input.userId });
      console.log(`[Activity] Refreshing token for user: ${input.userId}`);

      const result = await mailSyncGateway.refreshAccessToken({
        userId: input.userId,
        refreshToken: input.refreshToken
      });

      // Persist to database so the access token survives worker restarts
      await GmailAccount.findOneAndUpdate(
        { userId: input.userId },
        {
          currentAccessToken: result.accessToken,
          accessTokenExpiresAt: result.expiresAt,
          lastError: null
        }
      );

      return result;
    },

    /**
     * Proactively check if the current access token needs refreshing and,
     * if so, fetch a new one from Google.
     *
     * This is the primary token management activity used by the subscription
     * workflow. It:
     *  - Skips the OAuth call when the token still has adequate time remaining
     *    (unless `forceRefresh` is set, e.g. after a forceTokenRefresh signal).
     *  - Always persists the updated token and expiry to MongoDB so worker
     *    restarts can resume without re-authenticating.
     *  - Propagates `invalid_grant` and similar revocation errors verbatim so
     *    the workflow can detect them as non-retryable and deactivate the account.
     *
     * @throws {Error} With message containing a TOKEN_REFRESH_CONFIG.REVOCATION_ERROR_TYPES
     *   string when the refresh token has been permanently revoked.
     */
    async checkAndRefreshToken(
      input: RefreshGmailTokenWithContextInput
    ): Promise<RefreshGmailTokenOutput> {
      Context.current().heartbeat({ userId: input.userId });

      if (!input.forceRefresh) {
        // Check if existing token is still valid with enough buffer
        const account = await GmailAccount.findOne({ userId: input.userId })
          .select('+currentAccessToken accessTokenExpiresAt');

        if (account?.accessTokenExpiresAt && account.currentAccessToken) {
          const minutesRemaining =
            (account.accessTokenExpiresAt.getTime() - Date.now()) / 60_000;

          if (minutesRemaining > TOKEN_REFRESH_CONFIG.REFRESH_BEFORE_EXPIRY_MINUTES) {
            console.log(
              `[Activity] Token still valid for ${minutesRemaining.toFixed(1)} min, skipping refresh`,
              { userId: input.userId }
            );
            return {
              accessToken: account.currentAccessToken,
              expiresAt: account.accessTokenExpiresAt
            };
          }
        }
      }

      console.log(
        `[Activity] Refreshing token for user: ${input.userId}`,
        { forced: !!input.forceRefresh }
      );

      // Call the OAuth endpoint — let revocation errors propagate naturally
      const result = await mailSyncGateway.refreshAccessToken({
        userId: input.userId,
        refreshToken: input.refreshToken
      });

      // Persist fresh token and clear any previous errors
      await GmailAccount.findOneAndUpdate(
        { userId: input.userId },
        {
          currentAccessToken: result.accessToken,
          accessTokenExpiresAt: result.expiresAt,
          lastError: null
        }
      );

      console.log(
        `[Activity] Token refreshed, expires at ${result.expiresAt.toISOString()}`,
        { userId: input.userId }
      );

      return result;
    },

    /**
     * Mark a Gmail account as inactive due to a permanently revoked token.
     *
     * Called by the workflow when `checkAndRefreshToken` throws an
     * `invalid_grant` error (or equivalent). Sets `isActive: false` and
     * records the revocation reason in `lastError` so the user can be
     * notified out-of-band (e.g. via a push notification or email).
     */
    async updateGmailAccountTokenRevoked(
      input: { userId: string; reason: string }
    ): Promise<void> {
      Context.current().heartbeat({ userId: input.userId });
      console.error(
        `[Activity] Token revoked for user ${input.userId}: ${input.reason}`
      );

      await GmailAccount.findOneAndUpdate(
        { userId: input.userId },
        {
          isActive: false,
          lastError: `token_revoked: ${input.reason}`,
          // Reset watch so a re-link flow must call gmail.users.watch again
          watchExpiration: null
        }
      );
    },

    /**
     * Renew Gmail Watch Subscription
     */
    async renewGmailWatch(input: RenewGmailWatchInput): Promise<RenewGmailWatchOutput> {
      Context.current().heartbeat({ userId: input.userId });
      console.log(`[Activity] Renewing Gmail watch for user: ${input.userId}`);

      const result = await mailSyncGateway.renewWatch({
        userId: input.userId,
        accessToken: input.accessToken,
        topicName: input.topicName
      });

      // Update in database
      await GmailAccount.findOneAndUpdate(
        { userId: input.userId },
        {
          watchExpiration: result.expiration,
          historyId: result.historyId,
          lastError: null,
          errorCount: 0
        }
      );

      return result;
    },

    /**
     * Fetch Gmail Changes via History API
     */
    async fetchGmailChanges(input: FetchGmailChangesInput): Promise<FetchGmailChangesOutput> {
      Context.current().heartbeat({ userId: input.userId, historyId: input.startHistoryId });
      console.log(`[Activity] Fetching changes for user: ${input.userId}`);

      const result = await mailSyncGateway.fetchChanges({
        userId: input.userId,
        accessToken: input.accessToken,
        startHistoryId: input.startHistoryId
      });

      // Save new messages to database with userId for tenant isolation
      for (const message of result.messages) {
        try {
          await Email.findOneAndUpdate(
            {
              userId: input.userId,
              emailId: message.id
            },
            {
              userId: input.userId,
              emailId: message.id,
              threadId: message.threadId,
              from: message.from,
              to: message.to,
              subject: message.subject,
              date: new Date(parseInt(message.internalDate)),
              body: message.body,
              snippet: message.snippet,
              fetchedAt: new Date(),
              fetchedBy: `gmail-sync-${input.userId}`,
              isProcessed: false
            },
            { upsert: true, new: true }
          );
        } catch (error) {
          console.error(`Failed to save message ${message.id}:`, error);
        }
      }

      // Update account with new history ID
      await GmailAccount.findOneAndUpdate(
        { userId: input.userId },
        {
          historyId: result.newHistoryId,
          lastSyncAt: new Date(),
          $inc: { totalEmailsSynced: result.messages.length }
        }
      );

      return result;
    },

    /**
     * Save Gmail Account
     */
    async saveGmailAccount(input: SaveGmailAccountInput): Promise<void> {
      Context.current().heartbeat({ userId: input.userId });

      // Deactivate any other accounts sharing the same email so the webhook
      // lookup always resolves to the most recently linked account.
      await GmailAccount.updateMany(
        { email: input.email, userId: { $ne: input.userId } },
        { isActive: false }
      );

      await GmailAccount.findOneAndUpdate(
        { userId: input.userId },
        {
          userId: input.userId,
          email: input.email,
          refreshToken: input.refreshToken,
          workflowId: input.workflowId,
          pubSubTopicName: input.pubSubTopicName,
          isActive: true
        },
        { upsert: true, new: true }
      );

      console.log(`[Activity] Saved Gmail account for user: ${input.userId}`);
    },

    /**
     * Update Gmail Account
     */
    async updateGmailAccount(input: UpdateGmailAccountInput): Promise<void> {
      Context.current().heartbeat({ userId: input.userId });

      const updateFields: any = {};

      if (input.accessToken) updateFields.currentAccessToken = input.accessToken;
      if (input.accessTokenExpiresAt) updateFields.accessTokenExpiresAt = input.accessTokenExpiresAt;
      if (input.watchExpiration) updateFields.watchExpiration = input.watchExpiration;
      if (input.historyId) updateFields.historyId = input.historyId;
      if (input.lastSyncAt) updateFields.lastSyncAt = input.lastSyncAt;
      if (input.lastError !== undefined) updateFields.lastError = input.lastError;
      if (input.errorCount !== undefined) updateFields.errorCount = input.errorCount;
      if (input.totalEmailsSynced !== undefined) {
        updateFields.$inc = { totalEmailsSynced: input.totalEmailsSynced };
      }

      await GmailAccount.findOneAndUpdate(
        { userId: input.userId },
        updateFields
      );

      console.log(`[Activity] Updated Gmail account for user: ${input.userId}`);
    },

    /**
     * Get Gmail Account
     */
    async getGmailAccount(input: GetGmailAccountInput) {
      Context.current().heartbeat({ userId: input.userId });

      const account = await GmailAccount.findOne({ userId: input.userId })
        .select('+refreshToken +currentAccessToken');

      if (!account) {
        throw new Error(`Gmail account not found for user: ${input.userId}`);
      }

      return account.toObject();
    },

    /**
     * Deactivate Gmail Account
     */
    async deactivateGmailAccount(input: DeactivateGmailAccountInput): Promise<void> {
      Context.current().heartbeat({ userId: input.userId });

      const account = await GmailAccount.findOne({ userId: input.userId })
        .select('+currentAccessToken');

      if (account && account.currentAccessToken) {
        try {
          await mailSyncGateway.stopWatch(account.currentAccessToken);
        } catch (error) {
          console.error('Failed to stop watch:', error);
        }
      }

      await GmailAccount.findOneAndUpdate(
        { userId: input.userId },
        {
          isActive: false,
          watchExpiration: null
        }
      );

      console.log(`[Activity] Deactivated Gmail account for user: ${input.userId}`);
    }
  };
}

export type SyncActivities = ReturnType<typeof createSyncActivities>;
