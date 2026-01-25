/**
 * Email Activities (Layer 3 - Interface Adapters / Controllers)
 * Activities are Controllers in Clean Architecture
 * They orchestrate use cases and handle framework-specific concerns (Temporal)
 */
import { Context } from '@temporalio/activity';
import { DependencyContainer } from 'tsyringe';

// Use Cases (Application Layer)
import { ProcessEmailUseCase } from '../../../application/use-cases/process-email/process-email.use-case';

// Gateways (Application Layer Interfaces)
import { IEmailGateway } from '../../../application/interfaces/gateways/iemail-gateway';
import { IPatternRepository } from '../../../application/interfaces/repositories/ipattern-repository';
import { IEmailRepository } from '../../../application/interfaces/repositories/iemail-repository';

// Domain Entities
import { Email } from '../../../domain/entities/email.entity';
import { EmailPattern } from '../../../domain/entities/email-pattern.entity';

// Shared Types (for Temporal compatibility)
import {
  FetchEmailsInput,
  MatchEmailPatternInput,
  MatchedPattern,
  SaveEmailInput,
  SavedEmail as SavedEmailType,
  UpdateEmailProcessingInput
} from '../../../shared/types';

/**
 * Create Email Activities using DI Container
 * Activities orchestrate use cases and domain logic
 */
export function createEmailActivities(container: DependencyContainer) {
  // Resolve dependencies from DI Container
  const emailGateway = container.resolve<IEmailGateway>('IEmailGateway');
  const patternRepository = container.resolve<IPatternRepository>('IPatternRepository');
  const emailRepository = container.resolve<IEmailRepository>('IEmailRepository');
  const processEmailUseCase = container.resolve(ProcessEmailUseCase);

  return {
    /**
     * Fetch emails from email provider (Gmail)
     * Delegates to email gateway
     */
    async fetchEmails(input: FetchEmailsInput) {
      Context.current().heartbeat();

      const emails = await emailGateway.searchEmails({
        query: input.query,
        maxResults: input.maxResults,
        afterDate: input.afterDate
      });

      // Map domain Email entities to Temporal-compatible format (Presenter pattern)
      return emails.map(email => ({
        id: email.id,
        threadId: email.threadId,
        from: email.from,
        subject: email.subject,
        date: email.date,
        body: email.body,
        snippet: email.snippet || ''
      }));
    },

    /**
     * Match email against patterns
     * Uses domain logic through repository
     */
    async matchEmailPattern(input: MatchEmailPatternInput): Promise<MatchedPattern | null> {
      Context.current().heartbeat();

      // Create domain Email entity (minimal - just for pattern matching)
      const email = new Email(
        '',  // ID not needed for pattern matching
        input.from,
        input.subject,
        input.body,
        new Date(),
        ''   // ThreadId not needed
      );

      // Use repository to find matching pattern (domain logic)
      const pattern = await patternRepository.findMatchingPattern(email);

      if (!pattern) {
        return null;
      }

      // Map domain EmailPattern to Temporal-compatible format
      return {
        id: pattern.id,
        name: pattern.name,
        bankName: pattern.bankName,
        extractionPrompt: pattern.extractionPrompt
      };
    },

    /**
     * Save email to repository
     * Maps from Temporal types to domain entities
     */
    async saveEmail(input: SaveEmailInput): Promise<SavedEmailType> {
      Context.current().heartbeat();

      // Create domain Email entity from input
      const email = new Email(
        input.emailId,
        input.from,
        input.subject,
        input.body || '',
        input.date,
        input.threadId || '',
        input.to,
        input.snippet
      );

      // Save through repository
      const savedEmail = await emailRepository.save(email, {
        fetchedBy: input.fetchedBy,
        workflowId: undefined,
        matchedPatternId: undefined,
        matchedPatternName: undefined
      });

      // Map to Temporal-compatible format
      return {
        id: savedEmail.id,
        emailId: savedEmail.emailId,
        subject: savedEmail.subject,
        from: savedEmail.from,
        date: savedEmail.date,
        isProcessed: savedEmail.isProcessed
      };
    },

    /**
     * Update email processing status
     * Delegates to repository
     */
    async updateEmailProcessingStatus(input: UpdateEmailProcessingInput): Promise<void> {
      Context.current().heartbeat();

      await emailRepository.updateProcessingStatus(input.emailId, {
        isProcessed: input.isProcessed,
        processedAt: input.processedAt,
        workflowId: input.processingWorkflowId,
        transactionId: input.transactionId,
        confidence: input.confidence,
        error: input.processingError
      });
    },

    /**
     * Mark email as processed
     * Simple delegation to repository
     */
    async markEmailAsProcessed(emailId: string): Promise<void> {
      Context.current().heartbeat();
      await emailRepository.markAsProcessed(emailId);
    },

    /**
     * Check if email exists
     * Delegates to repository
     */
    async emailExists(emailId: string): Promise<boolean> {
      Context.current().heartbeat();
      return emailRepository.exists(emailId);
    },

    /**
     * Mark email as processed with label in email provider
     * Delegates to email gateway
     */
    async markEmailProcessedInProvider(emailId: string, label: string): Promise<void> {
      Context.current().heartbeat();
      await emailGateway.markEmailProcessed(emailId, label);
    }
  };
}
