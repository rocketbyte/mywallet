/**
 * Gmail Gateway (Layer 4 - Frameworks & Drivers)
 * Implements IEmailGateway interface for Gmail
 * Handles Gmail-specific API interactions
 */
import { injectable, inject } from 'tsyringe';
import { google, gmail_v1 } from 'googleapis';
import { OAuth2Client } from 'google-auth-library';
import { IEmailGateway, EmailSearchParams } from '../../../../application/interfaces/gateways/iemail-gateway';
import { Email } from '../../../../domain/entities/email.entity';
import { GmailMapper } from './gmail.mapper';

@injectable()
export class GmailGateway implements IEmailGateway {
  private gmail: gmail_v1.Gmail;

  constructor(
    @inject('OAuth2Client') private oauth2Client: OAuth2Client,
    @inject('GmailMapper') private mapper: GmailMapper
  ) {
    this.gmail = google.gmail({ version: 'v1', auth: this.oauth2Client });
  }

  /**
   * Search for emails matching parameters
   */
  async searchEmails(params: EmailSearchParams): Promise<Email[]> {
    const query = this.buildQuery(params);

    // List messages
    const response = await this.gmail.users.messages.list({
      userId: 'me',
      q: query,
      maxResults: params.maxResults || 50
    });

    const messages = response.data.messages || [];
    const emails: Email[] = [];

    // Fetch full message details for each message
    for (const message of messages) {
      const fullMessage = await this.gmail.users.messages.get({
        userId: 'me',
        id: message.id!,
        format: 'full'
      });

      // Convert Gmail message to Domain entity using mapper
      emails.push(this.mapper.toDomain(fullMessage.data));
    }

    return emails;
  }

  /**
   * Get a specific email by ID
   */
  async getEmail(emailId: string): Promise<Email> {
    const response = await this.gmail.users.messages.get({
      userId: 'me',
      id: emailId,
      format: 'full'
    });

    return this.mapper.toDomain(response.data);
  }

  /**
   * Mark email as processed with a label
   */
  async markEmailProcessed(emailId: string, label: string): Promise<void> {
    const labelId = await this.getOrCreateLabel(label);

    await this.gmail.users.messages.modify({
      userId: 'me',
      id: emailId,
      requestBody: {
        addLabelIds: [labelId]
      }
    });
  }

  /**
   * Build Gmail query string from parameters
   */
  private buildQuery(params: EmailSearchParams): string {
    let query = params.query;

    // Add date filter if provided
    if (params.afterDate) {
      const dateStr = this.formatDate(params.afterDate);
      query += ` after:${dateStr}`;
    }

    // Add label filters if provided
    if (params.labels && params.labels.length > 0) {
      const labelQuery = params.labels.map(l => `label:${l}`).join(' OR ');
      query += ` (${labelQuery})`;
    }

    return query;
  }

  /**
   * Format date for Gmail query (YYYY/MM/DD)
   */
  private formatDate(date: Date): string {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}/${month}/${day}`;
  }

  /**
   * Get or create a Gmail label
   */
  private async getOrCreateLabel(labelName: string): Promise<string> {
    // List existing labels
    const labels = await this.gmail.users.labels.list({ userId: 'me' });
    let labelId = labels.data.labels?.find(l => l.name === labelName)?.id;

    // Create label if it doesn't exist
    if (!labelId) {
      const newLabel = await this.gmail.users.labels.create({
        userId: 'me',
        requestBody: {
          name: labelName,
          labelListVisibility: 'labelShow',
          messageListVisibility: 'show'
        }
      });
      labelId = newLabel.data.id!;
    }

    return labelId;
  }
}
