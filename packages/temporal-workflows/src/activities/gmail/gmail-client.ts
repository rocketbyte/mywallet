import { google, gmail_v1 } from 'googleapis';
import { OAuth2Client } from 'google-auth-library';

export class GmailClient {
  private gmail: gmail_v1.Gmail;

  constructor(oauth2Client: OAuth2Client) {
    this.gmail = google.gmail({ version: 'v1', auth: oauth2Client });
  }

  /**
   * Search for messages matching a query
   */
  async searchMessages(query: string, maxResults: number = 50): Promise<gmail_v1.Schema$Message[]> {
    const response = await this.gmail.users.messages.list({
      userId: 'me',
      q: query,
      maxResults
    });

    return response.data.messages || [];
  }

  /**
   * Get full message details
   */
  async getMessage(messageId: string): Promise<gmail_v1.Schema$Message> {
    const response = await this.gmail.users.messages.get({
      userId: 'me',
      id: messageId,
      format: 'full'
    });

    return response.data;
  }

  /**
   * Get a specific header value from a message
   */
  getHeader(message: gmail_v1.Schema$Message, headerName: string): string {
    const header = message.payload?.headers?.find(
      h => h.name?.toLowerCase() === headerName.toLowerCase()
    );
    return header?.value || '';
  }

  /**
   * Extract message body text (plain text or HTML)
   */
  getMessageBody(message: gmail_v1.Schema$Message): string {
    const parts = message.payload?.parts;

    if (!parts) {
      // Message body is directly in payload.body
      const body = message.payload?.body?.data;
      return body ? Buffer.from(body, 'base64').toString('utf-8') : '';
    }

    // Find text/plain or text/html part
    const textPart = parts.find(p => p.mimeType === 'text/plain') ||
                     parts.find(p => p.mimeType === 'text/html');

    if (textPart?.body?.data) {
      return Buffer.from(textPart.body.data, 'base64').toString('utf-8');
    }

    // Check for nested parts (multipart messages)
    for (const part of parts) {
      if (part.parts) {
        const nestedText = part.parts.find(p => p.mimeType === 'text/plain') ||
                          part.parts.find(p => p.mimeType === 'text/html');
        if (nestedText?.body?.data) {
          return Buffer.from(nestedText.body.data, 'base64').toString('utf-8');
        }
      }
    }

    return '';
  }

  /**
   * Add a label to a message
   */
  async addLabel(messageId: string, labelName: string): Promise<void> {
    // First get or create the label
    const labels = await this.gmail.users.labels.list({ userId: 'me' });
    let labelId = labels.data.labels?.find(l => l.name === labelName)?.id;

    if (!labelId) {
      const newLabel = await this.gmail.users.labels.create({
        userId: 'me',
        requestBody: { name: labelName }
      });
      labelId = newLabel.data.id!;
    }

    await this.gmail.users.messages.modify({
      userId: 'me',
      id: messageId,
      requestBody: {
        addLabelIds: [labelId]
      }
    });
  }

  /**
   * Remove HTML tags from message body
   */
  stripHtml(html: string): string {
    return html.replace(/<[^>]*>/g, ' ')
               .replace(/&nbsp;/g, ' ')
               .replace(/&amp;/g, '&')
               .replace(/&lt;/g, '<')
               .replace(/&gt;/g, '>')
               .replace(/\s+/g, ' ')
               .trim();
  }
}
