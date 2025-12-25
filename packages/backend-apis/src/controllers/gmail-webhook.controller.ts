import { Request, Response } from 'express';
import { Connection } from 'mongoose';
import { getTemporalClient } from '../config/temporal-client';
import {
  GmailWebhookPayload,
  DecodedGmailNotification,
  IncomingWebhookSignal,
  GmailSubscriptionInput
} from '../../../temporal-workflows/src/shared/types';
import { GMAIL_SUBSCRIPTION_WORKFLOW_PREFIX, GMAIL_SIGNALS, GMAIL_SYNC_TASK_QUEUE } from '../../../temporal-workflows/src/shared/constants';
import { GmailAccount } from '../../../temporal-workflows/src/models/gmail-account.model';
import { logger } from '../utils/logger';

export class GmailWebhookController {
  constructor(private mongoConnection: Connection) {}

  /**
   * POST /api/gmail/webhook
   * Receives Pub/Sub push notifications from Google Cloud
   */
  async handleWebhook(req: Request, res: Response): Promise<void> {
    try {
      const payload: GmailWebhookPayload = req.body;

      // Decode base64 message data
      const decodedData = Buffer.from(payload.message.data, 'base64').toString('utf-8');
      const notification: DecodedGmailNotification = JSON.parse(decodedData);

      logger.info('Received Gmail webhook', {
        emailAddress: notification.emailAddress,
        historyId: notification.historyId,
        publishTime: payload.message.publishTime
      });

      // Find Gmail account by email
      const account = await GmailAccount.findOne({
        email: notification.emailAddress,
        isActive: true
      }).select('+refreshToken');

      if (!account) {
        logger.warn('No active account found', { email: notification.emailAddress });
        res.status(200).json({ status: 'ignored', reason: 'account_not_found' });
        return;
      }

      // Get Temporal client
      const client = await getTemporalClient();

      // Signal the Temporal workflow
      const workflowId = account.workflowId;
      const signalPayload: IncomingWebhookSignal = {
        emailAddress: notification.emailAddress,
        historyId: notification.historyId,
        timestamp: new Date(payload.message.publishTime)
      };

      // Prepare workflow start args in case workflow isn't running
      const workflowStartArgs: GmailSubscriptionInput = {
        userId: account.userId,
        email: account.email,
        refreshToken: account.refreshToken,
        pubSubTopicName: account.pubSubTopicName,
        workflowId: account.workflowId
      };

      await client.workflow.signalWithStart('gmailSubscriptionWorkflow', {
        signal: GMAIL_SIGNALS.INCOMING_WEBHOOK,
        signalArgs: [signalPayload],
        workflowId,
        taskQueue: GMAIL_SYNC_TASK_QUEUE,
        args: [workflowStartArgs]
      });

      logger.info('Signaled workflow with new changes', { workflowId });

      res.status(200).json({ status: 'processed', workflowId });

    } catch (error) {
      logger.error('Error handling Gmail webhook', { error });
      res.status(500).json({
        error: 'webhook_processing_failed',
        message: (error as Error).message
      });
    }
  }

  /**
   * POST /api/gmail/link
   * Link a new Gmail account (OAuth callback would call this)
   */
  async linkAccount(req: Request, res: Response): Promise<void> {
    try {
      const { userId, email, refreshToken, pubSubTopicName } = req.body;

      // Validation
      if (!userId || !email || !refreshToken || !pubSubTopicName) {
        res.status(400).json({
          error: 'missing_fields',
          message: 'userId, email, refreshToken, and pubSubTopicName are required'
        });
        return;
      }

      // Generate workflow ID
      const workflowId = `${GMAIL_SUBSCRIPTION_WORKFLOW_PREFIX}${userId}`;

      // Get Temporal client
      const client = await getTemporalClient();

      // Start Gmail subscription workflow
      const workflowArgs: GmailSubscriptionInput = {
        userId,
        email,
        refreshToken,
        pubSubTopicName,
        workflowId
      };

      await client.workflow.start('gmailSubscriptionWorkflow', {
        workflowId,
        taskQueue: GMAIL_SYNC_TASK_QUEUE,
        args: [workflowArgs]
      });

      logger.info('Started Gmail sync workflow', { userId, workflowId });

      res.status(201).json({
        status: 'linked',
        userId,
        workflowId,
        message: 'Gmail account linked successfully'
      });

    } catch (error) {
      logger.error('Error linking Gmail account', { error });
      res.status(500).json({
        error: 'link_failed',
        message: (error as Error).message
      });
    }
  }

  /**
   * DELETE /api/gmail/unlink/:userId
   * Unlink Gmail account and stop sync
   */
  async unlinkAccount(req: Request, res: Response): Promise<void> {
    try {
      const { userId } = req.params;

      const account = await GmailAccount.findOne({ userId });

      if (!account) {
        res.status(404).json({
          error: 'account_not_found',
          message: `No Gmail account found for user: ${userId}`
        });
        return;
      }

      // Get Temporal client
      const client = await getTemporalClient();

      // Get workflow handle and signal to stop
      const handle = client.workflow.getHandle(account.workflowId);
      await handle.signal(GMAIL_SIGNALS.STOP_SYNC);

      logger.info('Stopped Gmail sync', { userId, workflowId: account.workflowId });

      res.status(200).json({
        status: 'unlinked',
        userId,
        message: 'Gmail account unlinked successfully'
      });

    } catch (error) {
      logger.error('Error unlinking Gmail account', { error });
      res.status(500).json({
        error: 'unlink_failed',
        message: (error as Error).message
      });
    }
  }

  /**
   * GET /api/gmail/status/:userId
   * Get Gmail sync status for a user
   */
  async getStatus(req: Request, res: Response): Promise<void> {
    try {
      const { userId } = req.params;

      const account = await GmailAccount.findOne({ userId });

      if (!account) {
        res.status(404).json({
          error: 'account_not_found',
          message: `No Gmail account found for user: ${userId}`
        });
        return;
      }

      // Get Temporal client
      const client = await getTemporalClient();

      // Get workflow status
      let workflowStatus = 'unknown';
      try {
        const handle = client.workflow.getHandle(account.workflowId);
        const description = await handle.describe();
        workflowStatus = description.status.name;
      } catch (error) {
        logger.error('Failed to get workflow status', { error });
      }

      res.status(200).json({
        userId: account.userId,
        email: account.email,
        isActive: account.isActive,
        workflowId: account.workflowId,
        workflowStatus,
        watchExpiration: account.watchExpiration,
        lastSyncAt: account.lastSyncAt,
        totalEmailsSynced: account.totalEmailsSynced,
        lastError: account.lastError,
        errorCount: account.errorCount
      });

    } catch (error) {
      logger.error('Error getting Gmail sync status', { error });
      res.status(500).json({
        error: 'status_check_failed',
        message: (error as Error).message
      });
    }
  }
}
