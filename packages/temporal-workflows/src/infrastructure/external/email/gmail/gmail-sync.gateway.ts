import { google } from 'googleapis';
import { OAuth2Client } from 'google-auth-library';
import { injectable, inject } from 'tsyringe';
import { IMailSyncGateway } from '../../../../application/interfaces/gateways/imail-sync-gateway';
import {
  FetchGmailChangesInput,
  FetchGmailChangesOutput,
  RefreshGmailTokenInput,
  RefreshGmailTokenOutput,
  RenewGmailWatchInput,
  RenewGmailWatchOutput,
  GmailMessage
} from '../../../../shared/types';

/**
 * Gmail Sync Gateway (Layer 3 & 4)
 * Implements IMailSyncGateway for Gmail specifically.
 */
@injectable()
export class GmailSyncGateway implements IMailSyncGateway {
  constructor(
    @inject('OAuth2Client') private oauth2Client: OAuth2Client
  ) {}

  async refreshAccessToken(input: RefreshGmailTokenInput): Promise<RefreshGmailTokenOutput> {
    this.oauth2Client.setCredentials({
      refresh_token: input.refreshToken
    });

    const { credentials } = await this.oauth2Client.refreshAccessToken();

    if (!credentials.access_token) {
      throw new Error('Failed to refresh access token');
    }

    const expiresAt = new Date(credentials.expiry_date || Date.now() + 3600 * 1000);

    return {
      accessToken: credentials.access_token,
      expiresAt
    };
  }

  async renewWatch(input: RenewGmailWatchInput): Promise<RenewGmailWatchOutput> {
    this.oauth2Client.setCredentials({ access_token: input.accessToken });

    const gmail = google.gmail({ version: 'v1', auth: this.oauth2Client });

    const response = await gmail.users.watch({
      userId: 'me',
      requestBody: {
        topicName: input.topicName,
        labelIds: ['INBOX']
      }
    });

    if (!response.data.historyId || !response.data.expiration) {
      throw new Error('Invalid watch response from Gmail API');
    }

    return {
      historyId: response.data.historyId,
      expiration: new Date(parseInt(response.data.expiration))
    };
  }

  async stopWatch(accessToken: string): Promise<void> {
    this.oauth2Client.setCredentials({ access_token: accessToken });

    const gmail = google.gmail({ version: 'v1', auth: this.oauth2Client });

    await gmail.users.stop({ userId: 'me' });
  }

  async fetchChanges(input: FetchGmailChangesInput): Promise<FetchGmailChangesOutput> {
    this.oauth2Client.setCredentials({ access_token: input.accessToken });

    const gmail = google.gmail({ version: 'v1', auth: this.oauth2Client });

    const response = await gmail.users.history.list({
      userId: 'me',
      startHistoryId: input.startHistoryId,
      historyTypes: ['messageAdded']
    });

    const messages: GmailMessage[] = [];
    const history = response.data.history || [];

    const messageIds = new Set<string>();
    for (const record of history) {
      if (record.messagesAdded) {
        for (const msgAdded of record.messagesAdded) {
          if (msgAdded.message?.id) {
            messageIds.add(msgAdded.message.id);
          }
        }
      }
    }

    for (const messageId of messageIds) {
      try {
        const message = await this.fetchMessage(input.accessToken, messageId);
        messages.push(message);
      } catch (error) {
        console.error(`Failed to fetch message ${messageId}:`, error);
      }
    }

    return {
      messages,
      newHistoryId: response.data.historyId || input.startHistoryId,
      changesCount: messages.length
    };
  }

  private async fetchMessage(
    accessToken: string,
    messageId: string
  ): Promise<GmailMessage> {
    this.oauth2Client.setCredentials({ access_token: accessToken });

    const gmail = google.gmail({ version: 'v1', auth: this.oauth2Client });

    const response = await gmail.users.messages.get({
      userId: 'me',
      id: messageId,
      format: 'full'
    });

    const message = response.data;

    const headers = message.payload?.headers || [];
    const getHeader = (name: string) =>
      headers.find(h => h.name?.toLowerCase() === name.toLowerCase())?.value || '';

    let body = '';
    if (message.payload?.parts) {
      const textPart = message.payload.parts.find(
        part => part.mimeType === 'text/plain'
      );
      if (textPart?.body?.data) {
        body = Buffer.from(textPart.body.data, 'base64').toString('utf-8');
      }
    } else if (message.payload?.body?.data) {
      body = Buffer.from(message.payload.body.data, 'base64').toString('utf-8');
    }

    return {
      id: message.id!,
      threadId: message.threadId!,
      historyId: message.historyId!,
      internalDate: message.internalDate!,
      from: getHeader('From'),
      to: getHeader('To'),
      subject: getHeader('Subject'),
      snippet: message.snippet || '',
      body,
      labels: message.labelIds || []
    };
  }
}
