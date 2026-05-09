import type OpenAI from 'openai';
import { z } from 'zod';

// ─── Controller / SSE ────────────────────────────────────────────────────

export const SSE_RETRY_MS = 2000;
export const SSE_HEARTBEAT_MS = 15_000;

export const MAX_MESSAGE_CHARS = 4_000;
export const MAX_HISTORY_TURNS = 40;
export const MAX_TURN_CHARS = 8_000;

export const ChatTurnSchema = z.object({
  role: z.enum(['user', 'assistant']),
  content: z.string().trim().min(1).max(MAX_TURN_CHARS),
});

export const ChatRequestSchema = z.object({
  message: z.string().trim().min(1).max(MAX_MESSAGE_CHARS),
  history: z.array(ChatTurnSchema).max(MAX_HISTORY_TURNS).optional(),
});

// ─── Service ─────────────────────────────────────────────────────────────

export const MAX_TOOL_TURNS = 5;
export const MAX_TOKENS = 800;
export const HISTORY_LIMIT = 12;
// Hard cap on the JSON payload of any single tool result. Anything bigger
// is replaced with a short marker — keeps every follow-up model call's
// context bounded even if a tool returns more than expected.
export const MAX_TOOL_RESULT_CHARS = 12_000;
// Number of non-whitespace chars to inspect before deciding whether the
// model is emitting a tool-call JSON or starting prose.
export const MODE_DETECT_CHARS = 8;

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

// ─── Tools ───────────────────────────────────────────────────────────────

export const CATEGORY_ENUM = [
  'food', 'groceries', 'transport', 'services', 'home',
  'health', 'entertainment', 'shopping', 'income', 'other',
] as const;

export type ToolExecutor = (userId: string, input: Record<string, unknown>) => Promise<unknown>;

/**
 * Tool catalog exposed to the model. Keeping this list intentionally
 * small — each call to the model carries the full schema, so every tool
 * we add is a permanent context tax. Add a tool only when an existing
 * one cannot answer the question.
 */
export const CHAT_TOOLS: OpenAI.Chat.Completions.ChatCompletionTool[] = [
  {
    type: 'function',
    function: {
      name: 'query_transactions',
      description:
        'Search the user\'s transactions. Use this whenever the user asks about specific spending, merchants, recent activity, or anything that requires looking at concrete records. Resolve relative dates (e.g. "last week", "this month") to ISO YYYY-MM-DD before calling.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          startDate: { type: 'string', description: 'Inclusive ISO date (YYYY-MM-DD).' },
          endDate: { type: 'string', description: 'Inclusive ISO date (YYYY-MM-DD).' },
          category: { type: 'string', enum: [...CATEGORY_ENUM] },
          merchantContains: { type: 'string', description: 'Case-insensitive substring match.' },
          type: { type: 'string', enum: ['income', 'expense'] },
          limit: { type: 'integer', minimum: 1, maximum: 20, default: 10, description: 'Hard-capped at 20 to keep context small. Use get_spending_summary for totals over many transactions.' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_spending_summary',
      description:
        'Aggregate spending over a date range, optionally grouped by category, merchant, or day. Use this for totals, comparisons, or "where did my money go" questions — much cheaper than listing every transaction.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        required: ['startDate', 'endDate'],
        properties: {
          startDate: { type: 'string' },
          endDate: { type: 'string' },
          groupBy: { type: 'string', enum: ['category', 'merchant', 'day'] },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_budget',
      description: 'Returns the user\'s current monthly budget limit and the amount spent so far this month.',
      parameters: { type: 'object', additionalProperties: false, properties: {} },
    },
  },
];
