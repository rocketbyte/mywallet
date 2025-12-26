/**
 * Gmail Mapper (Layer 4 - Frameworks & Drivers)
 * Maps Gmail API types to Domain entities
 * Handles framework-specific details
 */
import { injectable } from 'tsyringe';
import { gmail_v1 } from 'googleapis';
import { Email } from '../../../../domain/entities/email.entity';

@injectable()
export class GmailMapper {
  /**
   * Maps Gmail API message to Domain Email entity
   */
  toDomain(message: gmail_v1.Schema$Message): Email {
    return new Email(
      message.id!,
      this.getHeader(message, 'From'),
      this.getHeader(message, 'Subject'),
      this.extractBody(message),
      new Date(this.getHeader(message, 'Date')),
      message.threadId!,
      this.getHeader(message, 'To'),
      message.snippet || undefined
    );
  }

  /**
   * Get header value from Gmail message
   */
  private getHeader(message: gmail_v1.Schema$Message, headerName: string): string {
    const header = message.payload?.headers?.find(
      h => h.name?.toLowerCase() === headerName.toLowerCase()
    );
    return header?.value || '';
  }

  /**
   * Extract body text from Gmail message
   * Handles multipart messages and nested parts
   */
  private extractBody(message: gmail_v1.Schema$Message): string {
    const parts = message.payload?.parts;

    // If no parts, body is directly in payload.body
    if (!parts) {
      const body = message.payload?.body?.data;
      return body ? this.decodeBase64(body) : '';
    }

    // Find text/plain or text/html part
    const textPart = parts.find(p => p.mimeType === 'text/plain') ||
                     parts.find(p => p.mimeType === 'text/html');

    if (textPart?.body?.data) {
      return this.stripHtml(this.decodeBase64(textPart.body.data));
    }

    // Check for nested parts (multipart messages)
    for (const part of parts) {
      if (part.parts) {
        const nestedText = part.parts.find(p => p.mimeType === 'text/plain') ||
                          part.parts.find(p => p.mimeType === 'text/html');
        if (nestedText?.body?.data) {
          return this.stripHtml(this.decodeBase64(nestedText.body.data));
        }
      }
    }

    return '';
  }

  /**
   * Decode base64-encoded data from Gmail API
   */
  private decodeBase64(data: string): string {
    try {
      return Buffer.from(data, 'base64').toString('utf-8');
    } catch (error) {
      return '';
    }
  }

  /**
   * Strip HTML tags and decode HTML entities
   */
  private stripHtml(html: string): string {
    return html
      .replace(/<style[^>]*>.*?<\/style>/gis, '') // Remove style tags
      .replace(/<script[^>]*>.*?<\/script>/gis, '') // Remove script tags
      .replace(/<[^>]*>/g, ' ') // Remove all HTML tags
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/\s+/g, ' ') // Replace multiple spaces with single space
      .trim();
  }
}
