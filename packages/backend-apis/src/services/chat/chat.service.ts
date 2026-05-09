import type OpenAI from 'openai';
import { CHAT_BASE_URL, CHAT_MODEL, getAiClient } from './ai-gateway';
import { TOOL_EXECUTORS } from './chat.tools';
import { buildSystemPrompt } from './chat.prompts';
import { logger } from '../../utils/logger';
import {
  HISTORY_LIMIT,
  MAX_TOKENS,
  MAX_TOOL_RESULT_CHARS,
  MAX_TOOL_TURNS,
  MODE_DETECT_CHARS,
  type ChatStreamRequest,
  type ChatStreamEvent,
  type ChatTurn,
} from '../../types/chat.types';

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

      // Per-turn streaming state. While `mode` is 'unknown' we hold deltas
      // in `pending` until we have enough characters to tell whether the
      // model is starting a tool-call JSON or prose. Once decided, prose
      // is flushed and streamed live; tool calls accumulate silently.
      let assistantText = '';
      let pending = '';
      let mode: 'unknown' | 'tool_call' | 'prose' = 'unknown';
      let finishReason: string | null = null;

      try {
        for await (const chunk of stream) {
          const choice = chunk.choices?.[0];
          if (!choice) continue;
          const delta = choice.delta;

          if (typeof delta?.content === 'string' && delta.content) {
            assistantText += delta.content;

            if (mode === 'unknown') {
              pending += delta.content;
              const trimmed = pending.trimStart();
              if (trimmed.length >= MODE_DETECT_CHARS) {
                if (trimmed.startsWith('{')) {
                  mode = 'tool_call';
                } else {
                  mode = 'prose';
                  yield { type: 'delta', text: pending };
                  pending = '';
                }
              }
            } else if (mode === 'prose') {
              yield { type: 'delta', text: delta.content };
            }
            // mode === 'tool_call': accumulate silently in assistantText
          }

          if (choice.finish_reason) finishReason = choice.finish_reason;
        }
      } catch (err) {
        if (isAbort(err)) return;
        throw enrichLlmError(err);
      }

      // Stream ended while still undecided — short reply, classify now.
      if (mode === 'unknown') {
        const trimmed = pending.trimStart();
        if (trimmed.startsWith('{')) {
          mode = 'tool_call';
        } else {
          mode = 'prose';
          if (pending) yield { type: 'delta', text: pending };
        }
      }

      if (mode === 'prose') {
        yield { type: 'done', reason: finishReason ?? 'stop' };
        return;
      }

      const parsed = parseToolCall(assistantText);
      if (!parsed) {
        // Looked like JSON but didn't parse — surface the raw text so the
        // user isn't stuck with a silent reply, then end the turn.
        logger.warn('Chat tool-call JSON failed to parse', { raw: assistantText.slice(0, 300) });
        yield { type: 'delta', text: assistantText };
        yield { type: 'done', reason: finishReason ?? 'stop' };
        return;
      }

      const callId = `call_${turn}_${Date.now()}`;
      yield { type: 'tool_call', id: callId, name: parsed.name, input: parsed.arguments };

      const exec = TOOL_EXECUTORS[parsed.name];
      let resultPayload: unknown;
      let isError = false;
      try {
        if (!exec) throw new Error(`Unknown tool: ${parsed.name}`);
        resultPayload = await exec(req.userId, parsed.arguments);
      } catch (err) {
        isError = true;
        const message = (err as Error).message;
        resultPayload = { error: message };
        logger.warn('Chat tool execution failed', { name: parsed.name, message });
      }

      yield { type: 'tool_result', id: callId, output: resultPayload, isError };

      // Feed the call and result back to the model in the same shape the
      // system prompt advertises. The assistant message preserves the
      // exact JSON the model emitted; the user message wraps the result.
      messages.push({ role: 'assistant', content: assistantText.trim() });
      messages.push({
        role: 'user',
        content: capToolResult({ tool_result: parsed.name, data: resultPayload }),
      });
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

/**
 * Extracts the first balanced JSON object from a string and parses it
 * as a `{ name, arguments }` tool call. Tolerates leading/trailing
 * prose or markdown fences in case the model deviates from the prompt.
 */
function parseToolCall(raw: string): { name: string; arguments: Record<string, unknown> } | null {
  const jsonText = extractFirstJsonObject(raw);
  if (!jsonText) return null;
  let obj: unknown;
  try {
    obj = JSON.parse(jsonText);
  } catch {
    return null;
  }
  if (!obj || typeof obj !== 'object') return null;
  const o = obj as { name?: unknown; arguments?: unknown };
  if (typeof o.name !== 'string' || !o.name) return null;
  const args =
    o.arguments && typeof o.arguments === 'object' && !Array.isArray(o.arguments)
      ? (o.arguments as Record<string, unknown>)
      : {};
  return { name: o.name, arguments: args };
}

function extractFirstJsonObject(s: string): string | null {
  let depth = 0;
  let inString = false;
  let escaped = false;
  let start = -1;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (ch === '\\') {
      escaped = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (ch === '{') {
      if (depth === 0) start = i;
      depth++;
    } else if (ch === '}') {
      depth--;
      if (depth === 0 && start >= 0) return s.slice(start, i + 1);
    }
  }
  return null;
}
