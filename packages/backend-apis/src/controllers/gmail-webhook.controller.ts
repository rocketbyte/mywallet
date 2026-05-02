import { Request, Response } from 'express';
import { getTemporalClient } from '../config/temporal-client';
import {
  GmailWebhookPayload,
  DecodedGmailNotification,
  IncomingWebhookSignal,
  GmailSubscriptionInput
} from '../../../temporal-workflows/src/shared/types';
import { GMAIL_SUBSCRIPTION_WORKFLOW_PREFIX, GMAIL_SIGNALS, GMAIL_SYNC_TASK_QUEUE } from '../../../temporal-workflows/src/shared/constants';
import { GmailAccount } from '../../../temporal-workflows/src/models/gmail-account.model';
import { EmailProviderInterface } from '../providers/types';
import { logger } from '../utils/logger';

/**
 * Handles Gmail-specific operations:
 * - Pub/Sub webhook processing (Gmail-specific format — stays here)
 * - Account link / unlink / status delegated to EmailProviderInterface
 *   so the same pattern works for Outlook/Yahoo in the future.
 */
export class GmailWebhookController {
  constructor(private readonly provider: EmailProviderInterface) {}

  /**
   * POST /api/gmail/webhook
   * Receives Pub/Sub push notifications from Google Cloud.
   * Signals the running Temporal workflow; starts it if it isn't running yet.
   */
  async handleWebhook(req: Request, res: Response): Promise<void> {
    try {
      logger.info('Received Gmail webhook', req.body);

      const payload: GmailWebhookPayload = req.body;
      const decodedData = Buffer.from(payload.message.data, 'base64').toString('utf-8');

      let notification: DecodedGmailNotification;
      try {
        notification = JSON.parse(decodedData);
      } catch {
        // Non-JSON payload (e.g. manual test messages published to the topic).
        // Acknowledge with 200 so Pub/Sub stops retrying — nothing to process.
        logger.warn('Ignoring non-JSON Pub/Sub message', { data: decodedData });
        res.status(200).json({ status: 'ignored', reason: 'invalid_payload' });
        return;
      }

      if (!notification.emailAddress || !notification.historyId) {
        // Valid JSON but not a Gmail notification — acknowledge and ignore.
        logger.warn('Ignoring Pub/Sub message missing emailAddress/historyId', { notification });
        res.status(200).json({ status: 'ignored', reason: 'not_gmail_notification' });
        return;
      }

      logger.info('Decoded Gmail webhook notification', {
        emailAddress: notification.emailAddress,
        historyId: notification.historyId,
        publishTime: payload.message.publishTime
      });

      const account = await GmailAccount.findOne({
        email: notification.emailAddress,
        isActive: true
      }).select('+refreshToken');

      if (!account) {
        logger.warn('No active account found for webhook email', { email: notification.emailAddress });
        res.status(200).json({ status: 'ignored', reason: 'account_not_found' });
        return;
      }

      const client = await getTemporalClient();

      const signalPayload: IncomingWebhookSignal = {
        emailAddress: notification.emailAddress,
        historyId: notification.historyId,
        timestamp: new Date(payload.message.publishTime)
      };

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
        workflowId: account.workflowId,
        taskQueue: GMAIL_SYNC_TASK_QUEUE,
        args: [workflowStartArgs]
      });

      logger.info('Signaled workflow with incoming changes', { workflowId: account.workflowId });
      res.status(200).json({ status: 'processed', workflowId: account.workflowId });

    } catch (error) {
      logger.error('Error handling Gmail webhook', { error });
      res.status(500).json({ error: 'webhook_processing_failed', message: (error as Error).message });
    }
  }

  /**
   * POST /api/gmail/link
   * Link a Gmail account and start the Temporal sync workflow.
   */
  async linkAccount(req: Request, res: Response): Promise<void> {
    try {
      const { userId, email, refreshToken, pubSubTopicName } = req.body;

      if (!userId || !email || !refreshToken) {
        res.status(400).json({ error: 'missing_fields', message: 'userId, email, and refreshToken are required' });
        return;
      }

      const result = await this.provider.linkAccount({ userId, email, refreshToken, pubSubTopicName });

      res.status(201).json({
        status: 'linked',
        userId: result.userId,
        workflowId: result.workflowId,
        message: 'Gmail account linked successfully'
      });
    } catch (error) {
      logger.error('Error linking Gmail account', { error });
      res.status(500).json({ error: 'link_failed', message: (error as Error).message });
    }
  }

  /**
   * DELETE /api/gmail/unlink/:userId
   * Stop the sync workflow and mark the account inactive.
   */
  async unlinkAccount(req: Request, res: Response): Promise<void> {
    try {
      const { userId } = req.params;

      await this.provider.unlinkAccount(userId);

      res.status(200).json({ status: 'unlinked', userId, message: 'Gmail account unlinked successfully' });
    } catch (error) {
      const code = (error as any).code;
      if (code === 'not_found') {
        res.status(404).json({ error: 'account_not_found', message: (error as Error).message });
        return;
      }
      logger.error('Error unlinking Gmail account', { error });
      res.status(500).json({ error: 'unlink_failed', message: (error as Error).message });
    }
  }

  /**
   * GET /api/gmail/status/:userId
   * Returns the current sync status combining MongoDB + Temporal state.
   */
  async getStatus(req: Request, res: Response): Promise<void> {
    try {
      const { userId } = req.params;

      const status = await this.provider.getAccountStatus(userId);

      res.status(200).json(status);
    } catch (error) {
      const code = (error as any).code;
      if (code === 'not_found') {
        res.status(404).json({ error: 'account_not_found', message: (error as Error).message });
        return;
      }
      logger.error('Error getting Gmail sync status', { error });
      res.status(500).json({ error: 'status_check_failed', message: (error as Error).message });
    }
  }
}
