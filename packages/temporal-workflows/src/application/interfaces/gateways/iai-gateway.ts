/**
 * AI Gateway Interfaces (Layer 2 - Application)
 * Defines contracts for AI provider implementations
 * Follows Dependency Inversion Principle
 */
import { Email } from '../../../domain/entities/email.entity';
import { Transaction } from '../../../domain/entities/transaction.entity';

/**
 * Base AI Gateway for generic AI operations
 */
export interface IAIGateway {
  /**
   * Extract structured data from unstructured text
   */
  extractStructuredData(request: ExtractionRequest): Promise<ExtractionResult>;

  /**
   * Get provider name (openai, ollama, etc.)
   */
  getProviderName(): string;

  /**
   * Get model name being used
   */
  getModelName(): string;

  /**
   * Get endpoint URL (for remote servers)
   */
  getEndpoint(): string;
}

export interface ExtractionRequest {
  systemPrompt: string;
  userPrompt: string;
  temperature?: number;
  maxTokens?: number;
  responseFormat?: 'json' | 'text';
}

export interface ExtractionResult {
  data: any;
  confidence: number;
  tokensUsed?: number;
  rawResponse: any;
}

/**
 * Specialized gateway for transaction extraction
 * Higher-level abstraction for domain-specific logic
 */
export interface ITransactionExtractorGateway {
  /**
   * Extract transaction from email using AI
   */
  extractTransaction(
    email: Email,
    context: ExtractionContext
  ): Promise<Transaction>;
}

export interface ExtractionContext {
  extractionPrompt: string;
  bankName: string;
}
