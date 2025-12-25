import { google } from 'googleapis';
import { OAuth2Client } from 'google-auth-library';
import { GmailMessage } from '../../shared/types';

export class GmailSyncClient {
  private oauth2Client: OAuth2Client;

  constructor() {
    this.oauth2Client = new google.auth.OAuth2(
      process.env.GMAIL_CLIENT_ID,
      process.env.GMAIL_CLIENT_SECRET,
      process.env.GMAIL_REDIRECT_URI
    );
  }

  /**
   * Refresh access token using refresh token
   */
  async refreshAccessToken(refreshToken: string): Promise<{
    accessToken: string;
    expiresAt: Date;
  }> {
    this.oauth2Client.setCredentials({
      refresh_token: refreshToken
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

  /**
   * Set up Gmail watch() to receive push notifications
   */
  async setupWatch(
    accessToken: string,
    pubSubTopicName: string
  ): Promise<{ historyId: string; expiration: Date }> {
    this.oauth2Client.setCredentials({ access_token: accessToken });

    const gmail = google.gmail({ version: 'v1', auth: this.oauth2Client });

    const response = await gmail.users.watch({
      userId: 'me',
      requestBody: {
        topicName: pubSubTopicName,
        labelIds: ['INBOX']  // Watch INBOX only (adjust as needed)
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

  /**
   * Stop Gmail watch subscription
   */
  async stopWatch(accessToken: string): Promise<void> {
    this.oauth2Client.setCredentials({ access_token: accessToken });

    const gmail = google.gmail({ version: 'v1', auth: this.oauth2Client });

    await gmail.users.stop({ userId: 'me' });
  }

  /**
   * Fetch history changes since last historyId
   */
  async fetchHistory(
    accessToken: string,
    startHistoryId: string
  ): Promise<{ messages: GmailMessage[]; newHistoryId: string }> {
    this.oauth2Client.setCredentials({ access_token: accessToken });

    const gmail = google.gmail({ version: 'v1', auth: this.oauth2Client });

    const response = await gmail.users.history.list({
      userId: 'me',
      startHistoryId,
      historyTypes: ['messageAdded']  // Only new messages
    });

    const messages: GmailMessage[] = [];
    const history = response.data.history || [];

    // Extract message IDs from history
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

    // Fetch full message details
    for (const messageId of messageIds) {
      try {
        const message = await this.fetchMessage(accessToken, messageId);
        messages.push(message);
      } catch (error) {
        console.error(`Failed to fetch message ${messageId}:`, error);
      }
    }

    return {
      messages,
      newHistoryId: response.data.historyId || startHistoryId
    };
  }

  /**
   * Fetch a single message by ID
   */
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

    // Parse headers
    const headers = message.payload?.headers || [];
    const getHeader = (name: string) =>
      headers.find(h => h.name?.toLowerCase() === name.toLowerCase())?.value || '';

    // Parse body
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
