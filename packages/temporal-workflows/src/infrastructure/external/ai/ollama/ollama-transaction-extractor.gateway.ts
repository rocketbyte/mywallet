/**
 * Ollama Transaction Extractor Gateway (Layer 4 - Frameworks & Drivers)
 * Implements ITransactionExtractorGateway interface using Ollama
 * Handles transaction extraction logic with Ollama models
 */
import { injectable, inject } from 'tsyringe';
import { ITransactionExtractorGateway, ExtractionContext } from '../../../../application/interfaces/gateways/iai-gateway';
import { Email } from '../../../../domain/entities/email.entity';
import { Transaction } from '../../../../domain/entities/transaction.entity';
import { OllamaGateway } from './ollama.gateway';

@injectable()
export class OllamaTransactionExtractorGateway implements ITransactionExtractorGateway {
  constructor(
    @inject(OllamaGateway) private aiGateway: OllamaGateway
  ) {}

  /**
   * Extract transaction from email using Ollama
   */
  async extractTransaction(email: Email, context: ExtractionContext): Promise<Transaction> {
    // Check if Ollama server is available
    const isAvailable = await this.aiGateway.isAvailable();
    if (!isAvailable) {
      throw new Error(`Ollama server at ${this.aiGateway.getEndpoint()} is not available`);
    }

    const result = await this.aiGateway.extractStructuredData({
      systemPrompt: context.extractionPrompt,
      userPrompt: this.buildPrompt(email),
      temperature: 0.1,
      maxTokens: 500,
      responseFormat: 'json'
    });

    // Map AI response to Transaction domain entity
    return new Transaction(
      this.generateId(),
      email.id,
      new Date(result.data.transactionDate),
      result.data.merchant,
      result.data.amount,
      result.data.currency || 'USD',
      result.data.category || 'Uncategorized',
      result.data.transactionType || 'debit',
      result.data.accountNumber || '',
      result.confidence,
      context.bankName,
      result.data.subcategory,
      result.rawResponse
    );
  }

  /**
   * Build prompt for AI extraction
   */
  private buildPrompt(email: Email): string {
    return `Extract transaction details from the following email:

Subject: ${email.subject}
From: ${email.from}
Date: ${email.date.toISOString()}

Body:
${email.body}

Please extract the transaction information and return it in JSON format with the following fields:
- transactionDate (ISO format)
- merchant (string)
- amount (number)
- currency (string, default: USD)
- category (string)
- subcategory (string, optional)
- transactionType (either "debit" or "credit")
- accountNumber (string, last 4 digits if available)
- confidence (number between 0 and 1)`;
  }

  /**
   * Generate unique transaction ID
   */
  private generateId(): string {
    return `txn_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }
}
