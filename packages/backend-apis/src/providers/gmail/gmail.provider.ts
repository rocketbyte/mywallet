import { google } from 'googleapis';
import { getTemporalClient } from '../../config/temporal-client';
import {
  GmailSubscriptionInput
} from '../../../../temporal-workflows/src/shared/types';
import {
  GMAIL_SUBSCRIPTION_WORKFLOW_PREFIX,
  GMAIL_SIGNALS,
  GMAIL_SYNC_TASK_QUEUE
} from '../../../../temporal-workflows/src/shared/constants';
import { GmailAccount } from '../../../../temporal-workflows/src/models/gmail-account.model';
import { logger } from '../../utils/logger';
import {
  AuthorizationContext,
  AuthState,
  IEmailProvider,
  LinkAccountInput,
  LinkAccountResult,
  AccountStatus
} from '../types';

/**
 * Gmail implementation of IEmailProvider.
 * Handles the full Gmail OAuth flow and Temporal workflow lifecycle.
 * Adding Outlook/Yahoo later means creating a parallel implementation
 * of IEmailProvider — no changes needed here.
 */
export class GmailProvider implements IEmailProvider {
  readonly type = 'gmail';

  private readonly oauth2Client = new google.auth.OAuth2(
    process.env.GMAIL_CLIENT_ID,
    process.env.GMAIL_CLIENT_SECRET,
    process.env.GMAIL_REDIRECT_URI
  );

  /**
   * Returns the Google OAuth2 authorization URL with the auth context
   * embedded in `state` so the callback can verify and auto-link.
   */
  getAuthUrl(ctx: AuthorizationContext): string {
    const state: AuthState = { userId: ctx.userId, email: ctx.email, provider: this.type };
    const encodedState = Buffer.from(JSON.stringify(state)).toString('base64');

    return this.oauth2Client.generateAuthUrl({
      access_type: 'offline',
      scope: [
        'https://www.googleapis.com/auth/gmail.readonly',
        'https://www.googleapis.com/auth/gmail.modify',
        'https://www.googleapis.com/auth/userinfo.email'  // needed to fetch email address after token exchange
      ],
      prompt: 'consent',
      login_hint: ctx.email,
      state: encodedState
    });
  }

  /**
   * Exchanges an OAuth authorization code for credentials.
   * Returns the authenticated email address and the refresh token.
   */
  async exchangeCode(code: string): Promise<{ email: string; refreshToken: string }> {
    const { tokens } = await this.oauth2Client.getToken(code);
    this.oauth2Client.setCredentials(tokens);

    if (!tokens.refresh_token) {
      throw new Error(
        'No refresh token received — the user may need to revoke app access and re-authorize.'
      );
    }

    const oauth2 = google.oauth2({ version: 'v2', auth: this.oauth2Client });
    const userInfo = await oauth2.userinfo.get();
    const email = userInfo.data.email;

    if (!email) {
      throw new Error('Could not retrieve email address from Google — ensure the userinfo.email scope is granted.');
    }

    return { email, refreshToken: tokens.refresh_token };
  }

  /**
   * Starts the Gmail subscription Temporal workflow for a user.
   * Falls back to the env-level PubSub topic when none is supplied explicitly.
   */
  async linkAccount(input: LinkAccountInput): Promise<LinkAccountResult> {
    const { userId, email, refreshToken } = input;
    const pubSubTopicName = input.pubSubTopicName ?? process.env.GMAIL_PUBSUB_TOPIC ?? '';

    if (!pubSubTopicName) {
      throw new Error('Pub/Sub topic name is required. Set GMAIL_PUBSUB_TOPIC env var or pass pubSubTopicName explicitly.');
    }

    const workflowId = `${GMAIL_SUBSCRIPTION_WORKFLOW_PREFIX}${userId}`;
    const client = await getTemporalClient();

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

    logger.info('GmailProvider: started Gmail sync workflow', { userId, workflowId });

    return { userId, workflowId };
  }

  /**
   * Sends a stopSync signal to the running workflow, which will deactivate
   * the account and exit gracefully.
   */
  async unlinkAccount(userId: string): Promise<void> {
    const account = await GmailAccount.findOne({ userId });

    if (!account) {
      const err = new Error(`No Gmail account found for user: ${userId}`) as any;
      err.code = 'not_found';
      throw err;
    }

    const client = await getTemporalClient();
    const handle = client.workflow.getHandle(account.workflowId);
    await handle.signal(GMAIL_SIGNALS.STOP_SYNC);

    logger.info('GmailProvider: sent stopSync signal', {
      userId,
      workflowId: account.workflowId
    });
  }

  /**
   * Returns the current sync status by combining the MongoDB account record
   * with the live Temporal workflow status.
   */
  async getAccountStatus(userId: string): Promise<AccountStatus> {
    const account = await GmailAccount.findOne({ userId });

    if (!account) {
      const err = new Error(`No Gmail account found for user: ${userId}`) as any;
      err.code = 'not_found';
      throw err;
    }

    const client = await getTemporalClient();
    let workflowStatus = 'unknown';
    try {
      const handle = client.workflow.getHandle(account.workflowId);
      const description = await handle.describe();
      workflowStatus = description.status.name;
    } catch (err) {
      logger.warn('GmailProvider: could not fetch workflow status', { err });
    }

    return {
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
    };
  }
}
