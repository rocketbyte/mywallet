/**
 * OpenAI Gateway (Layer 4 - Frameworks & Drivers)
 * Implements AIGatewayInterface interface for OpenAI
 * Handles OpenAI-specific API interactions
 */
import { injectable, inject } from 'tsyringe';
import OpenAI from 'openai';
import {
  AIGatewayInterface,
  ExtractionRequest,
  ExtractionResult,
  ToolChatMessage,
  ToolChatRequest,
  ToolChatResult,
  ToolsUnsupportedError,
} from '../../../../application/interfaces/gateways/ai-gateway.interface';
import { parseJsonContent } from './parse-json-content';
import { isToolsUnsupportedError } from './tools-support';

function toOpenAIMessage(m: ToolChatMessage): any {
  if (m.role === 'assistant') {
    return {
      role: 'assistant',
      // Empty string, not null: some OpenAI-compatible providers (e.g.
      // Cloudflare Workers AI) reject assistant messages without a content
      // string even when tool_calls are present.
      content: m.content ?? '',
      ...(m.toolCalls && m.toolCalls.length > 0
        ? {
            tool_calls: m.toolCalls.map((c) => ({
              id: c.id,
              type: 'function' as const,
              function: { name: c.name, arguments: c.arguments },
            })),
          }
        : {}),
    };
  }
  if (m.role === 'tool') {
    return { role: 'tool', tool_call_id: m.toolCallId, content: m.content };
  }
  return { role: m.role, content: m.content };
}

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

  /**
   * One tool-calling chat round. The caller owns the loop; this method only
   * translates between the neutral ToolChat types and the OpenAI wire format.
   */
  async chatWithTools(request: ToolChatRequest): Promise<ToolChatResult> {
    let completion;
    try {
      completion = await this.client.chat.completions.create({
        model: this.modelName,
        messages: request.messages.map(toOpenAIMessage),
        tools: request.tools.map((t) => ({
          type: 'function' as const,
          function: { name: t.name, description: t.description, parameters: t.parameters },
        })),
        ...(request.responseFormat === 'json' && supportsStrictJsonObject(this.modelName)
          ? { response_format: { type: 'json_object' as const } }
          : {}),
        temperature: request.temperature ?? 0.1,
        max_tokens: request.maxTokens ?? 500
      });
    } catch (err: any) {
      if (isToolsUnsupportedError(err)) {
        throw new ToolsUnsupportedError(this.modelName, err?.message);
      }
      throw err;
    }

    const message = completion.choices[0].message;
    const toolCalls = (message.tool_calls ?? [])
      .filter((c: any) => c.type === 'function')
      .map((c: any) => ({ id: c.id, name: c.function.name, arguments: c.function.arguments }));

    return {
      toolCalls,
      content: toolCalls.length > 0 ? null : message.content,
      tokensUsed: completion.usage?.total_tokens
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
