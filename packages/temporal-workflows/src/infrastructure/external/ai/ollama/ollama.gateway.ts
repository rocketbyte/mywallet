/**
 * Ollama Gateway (Layer 4 - Frameworks & Drivers)
 * Implements IAIGateway interface for Ollama
 * Supports remote Ollama servers
 */
import { injectable, inject } from 'tsyringe';
import { IAIGateway, ExtractionRequest, ExtractionResult } from '../../../../application/interfaces/gateways/iai-gateway';
import { OllamaClient } from './ollama-client';

@injectable()
export class OllamaGateway implements IAIGateway {
  private client: OllamaClient;
  private modelName: string;
  private endpoint: string;

  constructor(
    @inject('OllamaConfig') config: { endpoint: string; model: string }
  ) {
    this.endpoint = config.endpoint; // e.g., http://192.168.1.100:11434
    this.modelName = config.model;   // e.g., phi3:mini
    this.client = new OllamaClient(this.endpoint, this.modelName);
  }

  /**
   * Extract structured data using Ollama
   */
  async extractStructuredData(request: ExtractionRequest): Promise<ExtractionResult> {
    const messages = [
      { role: 'system', content: request.systemPrompt },
      { role: 'user', content: request.userPrompt }
    ];

    // Ollama uses OpenAI-compatible API
    const response = await this.client.chat(messages, {
      temperature: request.temperature ?? 0.1,
      max_tokens: request.maxTokens ?? 500,
      response_format: request.responseFormat === 'json' ? { type: 'json_object' } : undefined
    });

    const content = response.choices[0].message.content;

    // Try to parse JSON, fallback to object if parsing fails
    let data: any;
    try {
      data = content ? JSON.parse(content) : {};
    } catch (error) {
      // If JSON parsing fails, wrap content in object
      data = { content, confidence: 0.6 };
    }

    return {
      data,
      confidence: data.confidence ?? 0.8,
      tokensUsed: response.usage?.total_tokens,
      rawResponse: response
    };
  }

  getProviderName(): string {
    return 'ollama';
  }

  getModelName(): string {
    return this.modelName;
  }

  getEndpoint(): string {
    return this.endpoint;
  }

  /**
   * Check if Ollama server is accessible
   */
  async isAvailable(): Promise<boolean> {
    return this.client.healthCheck();
  }
}
