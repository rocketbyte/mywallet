/**
 * Email Repository Interface (Layer 2 - Application)
 * Defines contract for email persistence
 * Follows Dependency Inversion Principle
 */
import { Email } from '../../../domain/entities/email.entity';

export interface IEmailRepository {
  /**
   * Save an email to persistence
   */
  save(email: Email, metadata?: EmailMetadata): Promise<SavedEmail>;

  /**
   * Find email by its ID
   */
  findById(emailId: string): Promise<SavedEmail | null>;

  /**
   * Update processing status of an email
   */
  updateProcessingStatus(
    emailId: string,
    status: ProcessingStatus
  ): Promise<void>;

  /**
   * Mark email as processed
   */
  markAsProcessed(emailId: string): Promise<void>;

  /**
   * Find unprocessed emails
   */
  findUnprocessed(limit?: number): Promise<SavedEmail[]>;

  /**
   * Mark email as duplicate
   */
  markDuplicate(emailId: string): Promise<void>;

  /**
   * Check if email exists
   */
  exists(emailId: string): Promise<boolean>;
}

export interface EmailMetadata {
  fetchedBy?: string;
  workflowId?: string;
  matchedPatternId?: string;
  matchedPatternName?: string;
}

export interface SavedEmail {
  id: string;
  emailId: string;
  subject: string;
  from: string;
  date: Date;
  isProcessed: boolean;
  processedAt?: Date;
  processingWorkflowId?: string;
  transactionId?: string;
  confidence?: number;
  processingError?: string;
}

export interface ProcessingStatus {
  isProcessed: boolean;
  processedAt: Date;
  workflowId: string;
  transactionId?: string;
  confidence?: number;
  error?: string;
}
