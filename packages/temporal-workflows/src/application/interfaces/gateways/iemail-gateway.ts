/**
 * Email Gateway Interface (Layer 2 - Application)
 * Defines contract for email provider implementations
 * Follows Dependency Inversion Principle
 */
import { Email } from '../../../domain/entities/email.entity';

export interface IEmailGateway {
  /**
   * Search for emails matching given parameters
   */
  searchEmails(params: EmailSearchParams): Promise<Email[]>;

  /**
   * Get a specific email by ID
   */
  getEmail(emailId: string): Promise<Email>;

  /**
   * Mark an email as processed with a label
   */
  markEmailProcessed(emailId: string, label: string): Promise<void>;
}

export interface EmailSearchParams {
  query: string;
  maxResults?: number;
  afterDate?: Date;
  labels?: string[];
}
