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

  /**
   * Recursively extracts readable text from a Gmail message payload.
   * Priority: text/plain > text/html (stripped). Recurses into multipart parts
   * so nested structures like multipart/mixed > multipart/alternative > text/html work.
   */
  private extractBody(payload: import('googleapis').gmail_v1.Schema$MessagePart | undefined): string {
    if (!payload) return '';

    // Leaf node — check for data directly on this part
    if (!payload.parts || payload.parts.length === 0) {
      if (!payload.body?.data) return '';
      const raw = Buffer.from(payload.body.data, 'base64url').toString('utf-8');
      return payload.mimeType === 'text/html' ? this.stripHtml(raw) : raw;
    }

    // Prefer text/plain at this level
    const plainPart = payload.parts.find(p => p.mimeType === 'text/plain');
    if (plainPart?.body?.data) {
      return Buffer.from(plainPart.body.data, 'base64url').toString('utf-8');
    }

    // Fall back to text/html at this level
    const htmlPart = payload.parts.find(p => p.mimeType === 'text/html');
    if (htmlPart?.body?.data) {
      return this.stripHtml(Buffer.from(htmlPart.body.data, 'base64url').toString('utf-8'));
    }

    // Recurse into multipart/* children (e.g. multipart/alternative inside multipart/mixed)
    for (const part of payload.parts) {
      const result = this.extractBody(part);
      if (result) return result;
    }

    return '';
  }

  private stripHtml(html: string): string {
    return html
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/\s+/g, ' ')
      .trim();
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

    const body = this.extractBody(message.payload);

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
