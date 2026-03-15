/**
 * Sync Activities (Layer 3 - Interface Adapters / Controllers)
 * Handle Mail sync operations (token refresh, watch renewal, etc.)
 */
import { Context } from '@temporalio/activity';
import { DependencyContainer } from 'tsyringe';
import { Connection } from 'mongoose';

// Application Interfaces
import { IMailSyncGateway } from '../../../application/interfaces/gateways/imail-sync-gateway';

// Domain Models (Mongoose)
import { GmailAccount } from '../../../models/gmail-account.model';
import { Email } from '../../../models/email.model';

// Shared Types
import {
  RefreshGmailTokenInput,
  RefreshGmailTokenOutput,
  RenewGmailWatchInput,
  RenewGmailWatchOutput,
  FetchGmailChangesInput,
  FetchGmailChangesOutput,
  SaveGmailAccountInput,
  UpdateGmailAccountInput,
  GetGmailAccountInput,
  DeactivateGmailAccountInput
} from '../../../shared/types';

/**
 * Create Sync Activities using DI Container
 *
 * @param container - DI Container
 */
export function createSyncActivities(container: DependencyContainer) {
  const mailSyncGateway = container.resolve<IMailSyncGateway>('IMailSyncGateway');
  // Resolve MongoConnection to ensure it's loaded, but don't force a type assignment since Mongoose handles it globally
  container.resolve('MongoConnection');

  return {
    /**
     * Refresh Gmail Access Token
     */
    async refreshGmailToken(input: RefreshGmailTokenInput): Promise<RefreshGmailTokenOutput> {
      Context.current().heartbeat({ userId: input.userId });
      console.log(`[Activity] Refreshing token for user: ${input.userId}`);

      const result = await mailSyncGateway.refreshAccessToken({
        userId: input.userId,
        refreshToken: input.refreshToken
      });

      // Update in database
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
