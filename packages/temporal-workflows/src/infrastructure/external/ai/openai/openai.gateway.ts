/**
 * OpenAI Gateway (Layer 4 - Frameworks & Drivers)
 * Implements AIGatewayInterface interface for OpenAI
 * Handles OpenAI-specific API interactions
 */
import { injectable, inject } from 'tsyringe';
import OpenAI from 'openai';
import { AIGatewayInterface, ExtractionRequest, ExtractionResult } from '../../../../application/interfaces/gateways/ai-gateway.interface';
import { parseJsonContent } from './parse-json-content';

/**
 * Models that must NOT be sent OpenAI-style strict `response_format:
 * json_object`. Reasoning models (e.g. gpt-oss on Groq) emit hidden reasoning
 * before the final answer; under strict server-side JSON validation the
 * validated channel can come back empty, yielding Groq's
 * `json_validate_failed` with an empty `failed_generation`. For these we skip
 * the constraint and rely on `parseJsonContent` to recover the JSON instead.
 * `cf/` (Cloudflare Workers AI) also doesn't support the param.
 */
function supportsStrictJsonObject(modelName: string): boolean {
  const m = modelName.toLowerCase();
  if (m.startsWith('cf/')) return false;
  if (m.includes('gpt-oss')) return false;
  return true;
}

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
      ...(request.responseFormat === 'json' && supportsStrictJsonObject(this.modelName)
        ? { response_format: { type: 'json_object' as const } }
        : {}),
      temperature: request.temperature ?? 0.1,
      max_tokens: request.maxTokens ?? 500
    });

    const content = completion.choices[0].message.content;
    const data = content ? parseJsonContent(content) : {};

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
