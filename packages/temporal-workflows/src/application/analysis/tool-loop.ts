/**
 * Bounded tool-calling loop (Layer 2 - Application)
 *
 * Pure orchestration over the AIGatewayInterface and AnalysisToolInterface
 * contracts — no Temporal, no mongoose. The loop:
 *
 *   1. sends the conversation with the tool definitions;
 *   2. executes every requested tool (tenant scope injected server-side);
 *   3. appends the results and repeats, at most `maxRounds` times;
 *   4. past the budget, re-asks WITHOUT tools so the model must answer.
 *
 * Every tool is read-only, so a Temporal retry that restarts the loop from
 * scratch is always safe. ToolsUnsupportedError is NOT caught here — callers
 * own the fallback to the single-shot path.
 */
import {
  AIGatewayInterface,
  ToolChatMessage,
} from '../interfaces/gateways/ai-gateway.interface';
import {
  AnalysisToolCallRecord,
  AnalysisToolInterface,
  AnalysisToolScope,
} from '../interfaces/analysis/financial-analyzer.interface';

/** Max tool rounds per analysis — past this the model must answer. */
export const MAX_TOOL_ROUNDS = 6;

export interface ToolLoopRequest {
  systemPrompt: string;
  userPrompt: string;
  tools: AnalysisToolInterface[];
  scope: AnalysisToolScope;
  temperature?: number;
  maxTokens?: number;
  maxRounds?: number;
  heartbeat?: () => void;
}

export interface ToolLoopResult {
  content: string;
  toolCalls: AnalysisToolCallRecord[];
  tokensUsed: number;
}

function parseArgs(raw: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

export async function runToolLoop(
  aiGateway: AIGatewayInterface,
  request: ToolLoopRequest
): Promise<ToolLoopResult> {
  const byName = new Map(request.tools.map((t) => [t.definition.name, t]));
  const messages: ToolChatMessage[] = [
    { role: 'system', content: request.systemPrompt },
    { role: 'user', content: request.userPrompt },
  ];
  const records: AnalysisToolCallRecord[] = [];
  const maxRounds = request.maxRounds ?? MAX_TOOL_ROUNDS;
  let tokensUsed = 0;

  for (let round = 0; round <= maxRounds; round++) {
    request.heartbeat?.();

    // Budget exhausted: drop the tools so the model must produce its answer.
    const exhausted = round === maxRounds;
    const result = await aiGateway.chatWithTools({
      messages,
      tools: exhausted ? [] : request.tools.map((t) => t.definition),
      temperature: request.temperature,
      maxTokens: request.maxTokens,
      responseFormat: 'json',
    });
    tokensUsed += result.tokensUsed ?? 0;

    if (result.toolCalls.length === 0) {
      return { content: result.content ?? '', toolCalls: records, tokensUsed };
    }

    messages.push({ role: 'assistant', content: null, toolCalls: result.toolCalls });

    for (const call of result.toolCalls) {
      request.heartbeat?.();
      const args = parseArgs(call.arguments);
      const tool = byName.get(call.name);
      const started = Date.now();
      let output: unknown;
      if (!tool) {
        output = { error: `Unknown tool: ${call.name}` };
      } else {
        try {
          output = await tool.execute(args, request.scope);
        } catch (err: any) {
          output = { error: err?.message ?? 'tool execution failed' };
        }
      }
      records.push({ name: call.name, args, ms: Date.now() - started });
      messages.push({ role: 'tool', toolCallId: call.id, content: JSON.stringify(output) });
    }
  }

  // Unreachable: the exhausted round sends no tools, so the gateway cannot
  // return tool calls for it — but keep a hard stop for misbehaving providers.
  throw new Error('tool loop did not converge to a final answer');
}
