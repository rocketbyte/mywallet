/**
 * Process Email Use Case (Layer 2 - Application)
 * Contains application-specific business logic
 * Orchestrates email processing workflow
 */
import { injectable, inject } from 'tsyringe';
import { Email } from '../../../domain/entities/email.entity';
import { Transaction } from '../../../domain/entities/transaction.entity';
import { IEmailGateway, EmailSearchParams } from '../../interfaces/gateways/iemail-gateway';
import { ITransactionExtractorGateway } from '../../interfaces/gateways/iai-gateway';
import { ITransactionRepository } from '../../interfaces/repositories/itransaction-repository';
import { IEmailRepository } from '../../interfaces/repositories/iemail-repository';
import { IPatternRepository } from '../../interfaces/repositories/ipattern-repository';

@injectable()
export class ProcessEmailUseCase {
  constructor(
    @inject('IEmailGateway') private emailGateway: IEmailGateway,
    @inject('ITransactionExtractorGateway') private transactionExtractor: ITransactionExtractorGateway,
    @inject('ITransactionRepository') private transactionRepo: ITransactionRepository,
    @inject('IEmailRepository') private emailRepo: IEmailRepository,
    @inject('IPatternRepository') private patternRepo: IPatternRepository
  ) {}

  /**
   * Execute the email processing use case
   */
  async execute(input: ProcessEmailInput): Promise<ProcessEmailOutput> {
    // 1. Fetch emails from gateway
    const emails = await this.emailGateway.searchEmails({
      query: input.searchQuery,
      maxResults: input.maxResults,
      afterDate: input.afterDate
    });

    const results: ProcessEmailOutput = {
      totalEmails: emails.length,
      processedCount: 0,
      failedCount: 0,
      skippedCount: 0,
      transactions: [],
      errors: []
    };

    // 2. Process each email
    for (const email of emails) {
      try {
        // Check if already processed (duplicate prevention)
        const exists = await this.emailRepo.exists(email.id);
        if (exists) {
          results.skippedCount++;
          continue;
        }

        // Save email first
        await this.emailRepo.save(email, {
          workflowId: input.workflowId,
          fetchedBy: 'ProcessEmailUseCase'
        });

        // Check if transaction already exists for this email
        const existingTransaction = await this.transactionRepo.findByEmailId(email.id);
        if (existingTransaction) {
          results.skippedCount++;
          continue; // Skip duplicates
        }

        // Find matching pattern
        const pattern = await this.patternRepo.findMatchingPattern(email);
        if (!pattern) {
          results.skippedCount++;
          continue; // No matching pattern
        }

        // Extract transaction using AI
        const transaction = await this.transactionExtractor.extractTransaction(email, {
          extractionPrompt: pattern.extractionPrompt,
          bankName: pattern.bankName
        });

        // Validate confidence using domain business rule
        if (!transaction.isHighConfidence()) {
          results.failedCount++;
          results.errors.push({
            emailId: email.id,
            error: `Low confidence: ${transaction.confidence}`,
            confidence: transaction.confidence
          });

          // Update email processing status with error
          await this.emailRepo.updateProcessingStatus(email.id, {
            isProcessed: false,
            processedAt: new Date(),
            workflowId: input.workflowId || '',
            confidence: transaction.confidence,
            error: 'Low confidence'
          });

          continue;
        }

        // Save transaction
        const savedTransaction = await this.transactionRepo.save(transaction);

        // Update email processing status as success
        await this.emailRepo.updateProcessingStatus(email.id, {
          isProcessed: true,
          processedAt: new Date(),
          workflowId: input.workflowId || '',
          transactionId: savedTransaction.id,
          confidence: transaction.confidence
        });

        // Update pattern statistics
        await this.patternRepo.updatePatternStats(pattern.id, true);

        results.processedCount++;
        results.transactions.push(transaction);

      } catch (error) {
        results.failedCount++;
        results.errors.push({
          emailId: email.id,
          error: error instanceof Error ? error.message : 'Unknown error'
        });

        // Try to update email with error status
        try {
          await this.emailRepo.updateProcessingStatus(email.id, {
            isProcessed: false,
            processedAt: new Date(),
            workflowId: input.workflowId || '',
            error: error instanceof Error ? error.message : 'Unknown error'
          });
        } catch (updateError) {
          // Ignore update errors
        }
      }
    }

    return results;
  }
}

/**
 * Input for ProcessEmailUseCase
 */
export interface ProcessEmailInput {
  searchQuery: string;
  maxResults?: number;
  afterDate?: Date;
  workflowId?: string;
  workflowRunId?: string;
}

/**
 * Output from ProcessEmailUseCase
 */
export interface ProcessEmailOutput {
  totalEmails: number;
  processedCount: number;
  failedCount: number;
  skippedCount: number;
  transactions: Transaction[];
  errors: Array<{
    emailId: string;
    error: string;
    confidence?: number;
  }>;
}
