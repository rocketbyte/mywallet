/**
 * OpenAI Gateway (Layer 4 - Frameworks & Drivers)
 * Implements AIGatewayInterface interface for OpenAI
 * Handles OpenAI-specific API interactions
 */
import { injectable, inject } from 'tsyringe';
import OpenAI from 'openai';
import { AIGatewayInterface, ExtractionRequest, ExtractionResult } from '../../../../application/interfaces/gateways/ai-gateway.interface';

@injectable()
export class OpenAIGateway implements AIGatewayInterface {
  private client: OpenAI;
  private modelName: string;
  private endpoint: string;

  constructor(
    @inject('OpenAIConfig') config: { apiKey: string; model: string; endpoint?: string }
  ) {
    this.modelName = config.model || 'gpt-4o-mini';
    this.endpoint = config.endpoint || 'https://api.openai.com/v1';
    this.client = new OpenAI({
      apiKey: config.apiKey,
      baseURL: this.endpoint
    });
  }

  /**
   * Extract structured data using OpenAI
   */
  async extractStructuredData(request: ExtractionRequest): Promise<ExtractionResult> {
    const completion = await this.client.chat.completions.create({
      model: this.modelName,
      messages: [
        { role: 'system', content: request.systemPrompt },
        { role: 'user', content: request.userPrompt }
      ],
      ...(request.responseFormat === 'json' && !this.modelName.startsWith('cf/')
        ? { response_format: { type: 'json_object' as const } }
        : {}),
      temperature: request.temperature ?? 0.1,
      max_tokens: request.maxTokens ?? 500
    });

    const content = completion.choices[0].message.content;
    const data = content ? JSON.parse(content) : {};

    return {
      data,
      confidence: data.confidence ?? 0.8,
      tokensUsed: completion.usage?.total_tokens,
      rawResponse: completion
    };
  }

  getProviderName(): string {
    return 'openai';
  }

  getModelName(): string {
    return this.modelName;
  }

  getEndpoint(): string {
    return this.endpoint;
  }
}
