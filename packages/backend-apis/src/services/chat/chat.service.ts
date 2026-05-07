import type OpenAI from 'openai';
import { CHAT_BASE_URL, CHAT_MODEL, getAiClient } from './ai-gateway';
import { CHAT_TOOLS, TOOL_EXECUTORS } from './chat.tools';
import { buildSystemPrompt } from './chat.prompts';
import { logger } from '../../utils/logger';

const MAX_TOOL_TURNS = 5;
const MAX_TOKENS = 800;
const HISTORY_LIMIT = 12;
// Hard cap on the JSON payload of any single tool result. Anything bigger
// is replaced with a short marker — keeps every follow-up model call's
// context bounded even if a tool returns more than expected.
const MAX_TOOL_RESULT_CHARS = 12_000;

export type ChatStreamEvent =
  | { type: 'delta'; text: string }
  | { type: 'tool_call'; id: string; name: string; input: unknown }
  | { type: 'tool_result'; id: string; output: unknown; isError?: boolean }
  | { type: 'done'; reason: string }
  | { type: 'error'; message: string };

export interface ChatTurn {
  role: 'user' | 'assistant';
  content: string;
}

export interface ChatStreamRequest {
  userId: string;
  message: string;
  history?: ChatTurn[];
  signal?: AbortSignal;
}

interface AccumulatedToolCall {
  id: string;
  name: string;
  arguments: string;
}

/**
 * Orchestrates a streaming OpenAI-compatible chat completion against the
 * LiteLLM gateway, looping on `tool_calls` until the model returns a
 * final text response. Yields incremental SSE-friendly events:
 *
 *   delta       — text chunk to append to the streaming bubble
 *   tool_call   — model invoked a tool (UI can show "looking up …")
 *   tool_result — backend executed it (UI can briefly surface)
 *   done        — final stop reason; close the stream
 *   error       — fatal error; close the stream
 *
 * Tool execution is scoped to the authed `userId` so the model never
 * sees data outside the caller's tenant — the database query *is* the
 * authorization boundary, not a prompt instruction.
 */
export class ChatService {
  async *stream(req: ChatStreamRequest): AsyncGenerator<ChatStreamEvent> {
    const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
      { role: 'system', content: buildSystemPrompt() },
      ...trimHistory(req.history ?? []).map((m) => ({ role: m.role, content: m.content }) as const),
      { role: 'user', content: req.message },
    ];

    for (let turn = 0; turn < MAX_TOOL_TURNS; turn++) {
      if (req.signal?.aborted) return;

      let stream;
      try {
        stream = await getAiClient().chat.completions.create(
          {
            model: CHAT_MODEL,
            max_tokens: MAX_TOKENS,
            temperature: 0.3,
            messages,
            stream: true,
          },
          { signal: req.signal },
        );
      } catch (err) {
        if (isAbort(err)) return;
        throw enrichLlmError(err);
      }

      let assistantText = '';
      const toolCalls = new Map<number, AccumulatedToolCall>();
      let finishReason: string | null = null;

      try {
        for await (const chunk of stream) {
          const choice = chunk.choices?.[0];
          if (!choice) continue;
          const delta = choice.delta;

        if (typeof delta?.content === 'string' && delta.content) {
          assistantText += delta.content;
          yield { type: 'delta', text: delta.content };
        }

        if (delta?.tool_calls) {
          for (const tc of delta.tool_calls) {
            const idx = tc.index;
            if (idx == null) continue;
            const acc = toolCalls.get(idx) ?? { id: '', name: '', arguments: '' };
            if (tc.id) acc.id = tc.id;
            if (tc.function?.name) acc.name = tc.function.name;
            if (tc.function?.arguments) acc.arguments += tc.function.arguments;
            toolCalls.set(idx, acc);
          }
        }

          if (choice.finish_reason) finishReason = choice.finish_reason;
        }
      } catch (err) {
        if (isAbort(err)) return;
        throw enrichLlmError(err);
      }

      if (toolCalls.size === 0) {
        yield { type: 'done', reason: finishReason ?? 'stop' };
        return;
      }

      // Append the assistant turn that requested tools (must precede the
      // matching tool messages per OpenAI's contract).
      const calls = [...toolCalls.values()];
      messages.push({
        role: 'assistant',
        content: assistantText || null,
        tool_calls: calls.map((c) => ({
          id: c.id,
          type: 'function',
          function: { name: c.name, arguments: c.arguments || '{}' },
        })),
      });

      // Execute each tool and append its result message. Errors are
      // serialised back to the model so it can recover instead of crashing.
      for (const call of calls) {
        if (req.signal?.aborted) return;

        let parsed: Record<string, unknown> = {};
        try {
          parsed = call.arguments ? JSON.parse(call.arguments) : {};
        } catch (err) {
          logger.warn('Chat tool arguments not valid JSON', { name: call.name, args: call.arguments });
        }

        yield { type: 'tool_call', id: call.id, name: call.name, input: parsed };

        const exec = TOOL_EXECUTORS[call.name];
        try {
          if (!exec) throw new Error(`Unknown tool: ${call.name}`);
          const output = await exec(req.userId, parsed);
          const serialized = capToolResult(output);
          yield { type: 'tool_result', id: call.id, output };
          messages.push({
            role: 'tool',
            tool_call_id: call.id,
            content: serialized,
          });
        } catch (err) {
          const message = (err as Error).message;
          logger.warn('Chat tool execution failed', { name: call.name, message });
          yield { type: 'tool_result', id: call.id, output: { error: message }, isError: true };
          messages.push({
            role: 'tool',
            tool_call_id: call.id,
            content: JSON.stringify({ error: message }),
          });
        }
      }
    }

    yield { type: 'error', message: 'Exceeded maximum tool-use iterations' };
  }
}

function trimHistory(history: ChatTurn[]): ChatTurn[] {
  return history
    .filter((m) => (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string' && m.content.trim())
    .slice(-HISTORY_LIMIT);
}

/** True for AbortError thrown by the OpenAI SDK or fetch when our signal fires. */
function isAbort(err: unknown): boolean {
  const name = (err as { name?: string })?.name;
  return name === 'AbortError' || name === 'APIUserAbortError';
}

/**
 * Wraps LLM-gateway errors with the resolved baseURL and model so the
 * cause is obvious from the response (and the logs) without trawling
 * env files. The original error is preserved as `cause`.
 */
function enrichLlmError(err: unknown): Error {
  const original = err instanceof Error ? err : new Error(String(err));
  const wrapped = new Error(
    `LLM gateway error (model="${CHAT_MODEL}", baseURL="${CHAT_BASE_URL || 'unset'}"): ${original.message}`,
    { cause: original },
  );
  wrapped.name = original.name;
  return wrapped;
}

/**
 * Caps the JSON content fed back into the next model call. Tools should
 * already self-limit their result size, but this is a safety net so a
 * surprising payload can't blow up downstream context.
 */
function capToolResult(output: unknown): string {
  const json = JSON.stringify(output);
  if (json.length <= MAX_TOOL_RESULT_CHARS) return json;
  return JSON.stringify({
    truncated: true,
    reason: `Result exceeded ${MAX_TOOL_RESULT_CHARS} chars; ask a narrower question or pass a smaller limit.`,
    preview: json.slice(0, MAX_TOOL_RESULT_CHARS - 200),
  });
}
