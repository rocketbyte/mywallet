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
export interface AIGatewayInterface {
  /**
   * Extract structured data from unstructured text
   */
  extractStructuredData(request: ExtractionRequest): Promise<ExtractionResult>;

  /**
   * One chat round with OpenAI-format tool calling. Returns either the
   * model's tool-call requests or its final message — the caller owns the
   * loop (executing tools, appending results, bounding rounds).
   * Throws ToolsUnsupportedError when the provider/model rejects tools,
   * so callers can fall back to extractStructuredData.
   */
  chatWithTools(request: ToolChatRequest): Promise<ToolChatResult>;

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

/**
 * Thrown by chatWithTools when the active provider/model does not support
 * tool calling. Callers degrade to the single-shot extractStructuredData
 * path — this error must therefore never be treated as fatal.
 */
export class ToolsUnsupportedError extends Error {
  constructor(model: string, cause?: string) {
    super(`Model ${model} does not support tool calling${cause ? `: ${cause}` : ''}`);
    this.name = 'ToolsUnsupportedError';
  }
}

/** OpenAI-format tool (function) definition. */
export interface ToolDefinition {
  name: string;
  description: string;
  /** JSON Schema for the arguments object. */
  parameters: Record<string, unknown>;
}

export type ToolChatMessage =
  | { role: 'system' | 'user'; content: string }
  | { role: 'assistant'; content: string | null; toolCalls?: ToolCallRequest[] }
  | { role: 'tool'; toolCallId: string; content: string };

export interface ToolCallRequest {
  id: string;
  name: string;
  /** Raw JSON string of arguments as produced by the model. */
  arguments: string;
}

export interface ToolChatRequest {
  messages: ToolChatMessage[];
  tools: ToolDefinition[];
  temperature?: number;
  maxTokens?: number;
  responseFormat?: 'json' | 'text';
}

export interface ToolChatResult {
  /** Non-empty when the model wants tools executed before answering. */
  toolCalls: ToolCallRequest[];
  /** Final message content when the model answered directly (toolCalls empty). */
  content: string | null;
  tokensUsed?: number;
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
export interface TransactionExtractorGatewayInterface {
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
