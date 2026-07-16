/**
 * Tests for the financial analyzer strategy layer:
 *   - FinancialAnalyzerRegistry resolution
 *   - the bounded tool loop (execution, unknown tools, round budget)
 *   - server-side tenant scoping of tools
 *   - localized deterministic output + language directive in prompts
 *   - single-shot fallback when the model has no tool support
 *
 * Run with:
 *   npx tsx --test packages/temporal-workflows/src/infrastructure/analysis/__tests__/financial-analyzer.test.ts
 *
 * All AI gateways here are in-memory stubs — no Mongo, no network.
 */
import 'reflect-metadata';
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  AIGatewayInterface,
  ToolChatRequest,
  ToolChatResult,
  ToolsUnsupportedError,
} from '../../../application/interfaces/gateways/ai-gateway.interface';
import {
  AnalysisToolInterface,
  FinancialAnalyzerRegistry,
} from '../../../application/interfaces/analysis/financial-analyzer.interface';
import { runToolLoop, MAX_TOOL_ROUNDS } from '../../../application/analysis/tool-loop';
import { isToolsUnsupportedError } from '../../external/ai/openai/tools-support';
import { DailyFinancialAnalyzer } from '../daily-financial.analyzer';
import { MonthlyFinancialAnalyzer } from '../monthly-financial.analyzer';
import { DailyAnalysisContext, MonthlyAnalysisContext } from '../../../shared/types';

// --- stubs -------------------------------------------------------------------

function gatewayFromScript(
  script: (round: number, request: ToolChatRequest) => ToolChatResult
): AIGatewayInterface {
  let round = 0;
  return {
    extractStructuredData: async () => {
      throw new Error('extractStructuredData must not be called on the tool path');
    },
    chatWithTools: async (request) => script(round++, request),
    getProviderName: () => 'stub',
    getModelName: () => 'stub-model',
    getEndpoint: () => 'http://stub',
  };
}

const stepRepo = {
  getActiveStep: async () => ({
    stepKey: 'analyze_day',
    systemPrompt: 'sys — write in {{language}}',
    userPromptTemplate: 'analyze {{currency}} in {{language}}',
    temperature: 0.1,
    maxTokens: 200,
    version: 3,
  }),
} as any;

function dailyContext(overrides: Partial<DailyAnalysisContext> = {}): DailyAnalysisContext {
  return {
    userId: 'tenant-a',
    analysisDate: '2026-07-15',
    currency: 'USD',
    language: 'en',
    transactions: [
      {
        id: 't1', merchant: 'Cafe', amount: 12, currency: 'USD',
        transactionType: 'debit', category: 'Food', transactionDate: '2026-07-15T10:00:00.000Z',
      },
    ],
    totals: { income: 0, expenses: 12, net: -12 },
    balance: 100,
    budgetSnapshot: null,
    priorSummaries: [],
    promptVersion: 3,
    ...overrides,
  };
}

// --- gateway helpers -------------------------------------------------------------

test('isToolsUnsupportedError treats 4xx schema rejections as no-tool-support, never auth/rate/server errors', () => {
  assert.ok(isToolsUnsupportedError({ status: 400, message: "'tools' is not supported by this model" }));
  assert.ok(isToolsUnsupportedError({ status: 422, message: 'function calling unavailable' }));
  assert.ok(isToolsUnsupportedError({ status: 400, message: "required properties at '/messages/2' are 'role,content'" }), 'tool-conversation shape rejection (Cloudflare) triggers fallback');
  assert.ok(!isToolsUnsupportedError({ status: 401, message: 'invalid api key' }), 'auth failure must surface');
  assert.ok(!isToolsUnsupportedError({ status: 429, message: 'rate limited' }), 'rate limit must surface for retry/backoff');
  assert.ok(!isToolsUnsupportedError({ status: 500, message: 'tools exploded' }), '5xx is a real failure, not lack of support');
  assert.ok(!isToolsUnsupportedError(new Error('network down')));
});

// --- registry ------------------------------------------------------------------

test('registry resolves analyzers by kind and rejects unknown kinds and duplicates', () => {
  const gw = gatewayFromScript(() => ({ toolCalls: [], content: '{}' }));
  const registry = new FinancialAnalyzerRegistry();
  const daily = new DailyFinancialAnalyzer(gw, stepRepo);
  registry.register(daily);
  registry.register(new MonthlyFinancialAnalyzer(gw, stepRepo));

  assert.equal(registry.get('daily'), daily);
  assert.deepEqual(registry.kinds().sort(), ['daily', 'monthly']);
  assert.throws(() => registry.get('weekly'), /No analyzer registered/);
  assert.throws(() => registry.register(new DailyFinancialAnalyzer(gw, stepRepo)), /already registered/);
});

// --- tool loop -----------------------------------------------------------------

test('runToolLoop executes requested tools with the server-side scope and feeds results back', async () => {
  const seen: Array<{ args: any; scopedUser: string }> = [];
  const echoTool: AnalysisToolInterface = {
    definition: {
      name: 'echo',
      description: 'echoes',
      parameters: { type: 'object', properties: {} },
    },
    // Args from the model may claim any userId — the scope must win.
    execute: async (args, scope) => {
      seen.push({ args, scopedUser: scope.userId });
      return { rowsFor: scope.userId };
    },
  };

  const gw = gatewayFromScript((round) =>
    round === 0
      ? { toolCalls: [{ id: 'c1', name: 'echo', arguments: '{"userId":"tenant-EVIL","x":1}' }], content: null }
      : { toolCalls: [], content: '{"ok":true}' }
  );

  const result = await runToolLoop(gw, {
    systemPrompt: 's', userPrompt: 'u',
    tools: [echoTool],
    scope: { userId: 'tenant-a' },
  });

  assert.equal(seen.length, 1);
  assert.equal(seen[0].scopedUser, 'tenant-a', 'tool executed for the scoped tenant, not the model-claimed one');
  assert.equal(result.content, '{"ok":true}');
  assert.equal(result.toolCalls.length, 1);
  assert.equal(result.toolCalls[0].name, 'echo');
  assert.ok(result.toolCalls[0].ms >= 0);
});

test('runToolLoop answers an unknown tool with an error message instead of crashing', async () => {
  const gw = gatewayFromScript((round) =>
    round === 0
      ? { toolCalls: [{ id: 'c1', name: 'nope', arguments: '{}' }], content: null }
      : { toolCalls: [], content: '{"ok":true}' }
  );
  const result = await runToolLoop(gw, {
    systemPrompt: 's', userPrompt: 'u', tools: [], scope: { userId: 'tenant-a' },
  });
  assert.equal(result.content, '{"ok":true}');
});

test('runToolLoop drops the tools after the round budget so the model must answer', async () => {
  const chatty: AnalysisToolInterface = {
    definition: { name: 'more', description: 'more', parameters: { type: 'object', properties: {} } },
    execute: async () => ({}),
  };
  let sawEmptyToolsRound = false;
  const gw = gatewayFromScript((_round, request) => {
    if (request.tools.length === 0) {
      sawEmptyToolsRound = true;
      return { toolCalls: [], content: '{"forced":true}' };
    }
    return { toolCalls: [{ id: 'c', name: 'more', arguments: '{}' }], content: null };
  });

  const result = await runToolLoop(gw, {
    systemPrompt: 's', userPrompt: 'u', tools: [chatty], scope: { userId: 'tenant-a' },
  });

  assert.ok(sawEmptyToolsRound, 'final round was sent without tools');
  assert.equal(result.content, '{"forced":true}');
  assert.equal(result.toolCalls.length, MAX_TOOL_ROUNDS, 'one tool call per budgeted round');
});

// --- analyzers -----------------------------------------------------------------

test('daily analyzer returns localized deterministic empty-day result without any AI call', async () => {
  let called = 0;
  const gw = gatewayFromScript(() => {
    called++;
    return { toolCalls: [], content: '{}' };
  });
  const analyzer = new DailyFinancialAnalyzer(gw, stepRepo);

  const es = await analyzer.analyze(dailyContext({ transactions: [], language: 'es' }));
  assert.equal(es.summary, 'Sin transacciones ayer.');
  assert.match(es.fullSummary, /No se registraron transacciones/);

  const en = await analyzer.analyze(dailyContext({ transactions: [], language: 'en' }));
  assert.equal(en.summary, 'No transactions yesterday.');

  assert.equal(called, 0, 'no AI call for an empty day');
});

test('daily analyzer renders the language directive into system and user prompts', async () => {
  let capturedSystem = '';
  let capturedUser = '';
  const gw = gatewayFromScript((_round, request) => {
    const sys = request.messages.find((m) => m.role === 'system');
    const user = request.messages.find((m) => m.role === 'user');
    capturedSystem = sys && 'content' in sys ? String(sys.content) : '';
    capturedUser = user && 'content' in user ? String(user.content) : '';
    return { toolCalls: [], content: '{"summary":"resumen","fullSummary":"texto","suggestions":[]}' };
  });
  const analyzer = new DailyFinancialAnalyzer(gw, stepRepo);

  const out = await analyzer.analyze(dailyContext({ language: 'es' }));
  assert.match(capturedSystem, /Spanish/);
  assert.match(capturedUser, /Spanish/);
  assert.equal(out.summary, 'resumen');
  assert.equal(out.modelMeta.promptVersion, 3);
});

test('daily analyzer falls back to the single-shot path when the model rejects tools', async () => {
  let extractCalls = 0;
  const gw: AIGatewayInterface = {
    chatWithTools: async () => {
      throw new ToolsUnsupportedError('stub-model');
    },
    extractStructuredData: async () => {
      extractCalls++;
      return {
        data: { summary: 'fallback ok', fullSummary: 'text', suggestions: [] },
        confidence: 1, tokensUsed: 7, rawResponse: {},
      };
    },
    getProviderName: () => 'stub',
    getModelName: () => 'stub-model',
    getEndpoint: () => 'http://stub',
  };
  const analyzer = new DailyFinancialAnalyzer(gw, stepRepo);

  const out = await analyzer.analyze(dailyContext());
  assert.equal(extractCalls, 1);
  assert.equal(out.summary, 'fallback ok');
  assert.equal(out.modelMeta.tokensOut, 7);
  assert.equal(out.modelMeta.toolCalls, undefined, 'no tool calls recorded on the fallback path');
});

test('monthly analyzer records tool calls in modelMeta and truncates the note', async () => {
  // The requested tool name is deliberately NOT in the monthly toolset: the
  // loop answers it with an error result and records it — no database needed.
  const gw = gatewayFromScript((round) =>
    round === 0
      ? { toolCalls: [{ id: 'c1', name: 'notARealTool', arguments: '{"year":2026,"month":6}' }], content: null }
      : { toolCalls: [], content: JSON.stringify({ note: 'nota '.repeat(200).trim() }) }
  );
  const analyzer = new MonthlyFinancialAnalyzer(gw, stepRepo);

  const ctx: MonthlyAnalysisContext = {
    userId: 'tenant-a', year: 2026, month: 7, currency: 'USD', language: 'es',
    dailyCount: 2, dailySummaries: ['d1', 'd2'],
    totals: { income: 100, expenses: 50, net: 50 }, balance: 500,
    budgetSnapshot: null, priorMonthNote: null, sourceHash: 'h', existing: null, promptVersion: 3,
  };
  const out = await analyzer.analyze(ctx);

  assert.ok(out.note.length <= 480);
  assert.ok(out.modelMeta.toolCalls);
  assert.equal(out.modelMeta.toolCalls!.length, 1);
  assert.equal(out.modelMeta.toolCalls![0].name, 'notARealTool');
  assert.deepEqual(out.modelMeta.toolCalls![0].args, { year: 2026, month: 6 });
});
