/**
 * Tests for the daily transaction analysis activities.
 *
 * Run with:
 *   npx tsx --test packages/temporal-workflows/src/infrastructure/temporal/activities/__tests__/analysis.activities.test.ts
 *
 * Uses mongodb-memory-server so no live Mongo is required. Pipeline-step
 * lookups go through a stub container so we don't need to seed the
 * pipeline_steps collection in the test database.
 */
import 'reflect-metadata';
import { after, before, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';

import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { container as rootContainer } from 'tsyringe';

// IMPORTANT: load mongoose before any model file so the connection is set up.
import { createAnalysisActivities } from '../analysis.activities';
import { Transaction } from '../../../../models/transaction.model';
import { Budget } from '../../../../models/budget.model';
import { Tenant } from '../../../../models/tenant.model';
import { TransactionAnalysis } from '../../../../models/transaction-analysis.model';
import { ToolsUnsupportedError } from '../../../../application/interfaces/gateways/ai-gateway.interface';
import { FinancialAnalyzerRegistry } from '../../../../application/interfaces/analysis/financial-analyzer.interface';
import { DailyFinancialAnalyzer } from '../../../analysis/daily-financial.analyzer';
import { MonthlyFinancialAnalyzer } from '../../../analysis/monthly-financial.analyzer';

// Activity Context.heartbeat needs a context — patch it with a no-op so the
// production code can call heartbeat() without a Temporal runtime.
import { Context } from '@temporalio/activity';
(Context as any).current = () => ({ heartbeat: () => {} });

// --- in-memory Mongo lifecycle ------------------------------------------------
let mongod: MongoMemoryServer;

before(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
});

after(async () => {
  await mongoose.disconnect();
  await mongod.stop();
});

beforeEach(async () => {
  await Promise.all([
    Transaction.deleteMany({}),
    Budget.deleteMany({}),
    Tenant.deleteMany({}),
    TransactionAnalysis.deleteMany({}),
  ]);
});

// --- container stub: AI gateway + pipeline-step repo -------------------------
function buildContainer(promptVersion = 1) {
  const c = rootContainer.createChildContainer();
  c.register('AIGatewayInterface', {
    useValue: {
      extractStructuredData: async () => ({
        data: {
          summary: 'stub summary',
          fullSummary: 'stub full summary',
          suggestions: [{ id: 'cap-dining', title: 'Cap dining', body: 'Try $50/wk', urgency: 'warn' }],
        },
        confidence: 1,
        tokensUsed: 0,
        rawResponse: {},
      }),
      // The stub model has no tool support — analyzers exercise the
      // single-shot fallback path in these tests.
      chatWithTools: async () => {
        throw new ToolsUnsupportedError('stub-model');
      },
      getProviderName: () => 'stub',
      getModelName: () => 'stub-model',
      getEndpoint: () => 'http://stub',
    },
  });
  c.register('PipelineStepRepositoryInterface', {
    useValue: {
      getActiveStep: async () => ({
        stepKey: 'analyze_day',
        systemPrompt: 'sys',
        userPromptTemplate: 'tmpl {{currency}}',
        temperature: 0.2,
        maxTokens: 100,
        version: promptVersion,
      }),
    },
  });
  c.register('FinancialAnalyzerRegistry', {
    useFactory: (dc) => {
      const registry = new FinancialAnalyzerRegistry();
      registry.register(new DailyFinancialAnalyzer(dc.resolve('AIGatewayInterface'), dc.resolve('PipelineStepRepositoryInterface')));
      registry.register(new MonthlyFinancialAnalyzer(dc.resolve('AIGatewayInterface'), dc.resolve('PipelineStepRepositoryInterface')));
      return registry;
    },
  });
  return c;
}

const USER = 'user-1';

async function seedTenant(currency = 'USD') {
  await Tenant.create({
    primaryUserId: new mongoose.Types.ObjectId(),
    type: 'individual',
    currency,
  });
  // The aggregate activity reads Tenant.findOne({ primaryUserId: userId }) —
  // tenants are stored with ObjectId primaryUserId, while userId is the
  // tenant's *primary user id* serialised as a string. For the test we set
  // tenant.primaryUserId to the same value so the lookup matches.
  const oid = new mongoose.Types.ObjectId();
  await Tenant.deleteMany({});
  await Tenant.create({ primaryUserId: oid, type: 'individual', currency });
  return String(oid);
}

function dayUTC(iso: string): Date {
  return new Date(`${iso}T00:00:00.000Z`);
}

// ---------------------------------------------------------------------------
// aggregateDailyContext
// ---------------------------------------------------------------------------

test('aggregateDailyContext returns only yesterday transactions, with totals', async () => {
  const userId = await seedTenant('USD');

  await Transaction.create([
    { userId, emailId: 'em-a', transactionDate: dayUTC('2026-05-28'), merchant: 'A', amount: 30, currency: 'USD', category: 'Food', transactionType: 'debit', processedAt: new Date() },
    { userId, emailId: 'em-b', transactionDate: new Date('2026-05-28T12:30:00.000Z'), merchant: 'B', amount: 10, currency: 'USD', category: 'Food', transactionType: 'debit', processedAt: new Date() },
    { userId, emailId: 'em-c', transactionDate: new Date('2026-05-28T23:59:59.000Z'), merchant: 'C', amount: 500, currency: 'USD', category: 'Salary', transactionType: 'credit', processedAt: new Date() },
    // outside window — next/prev calendar day
    { userId, emailId: 'em-d', transactionDate: dayUTC('2026-05-29'), merchant: 'D', amount: 999, currency: 'USD', category: 'Food', transactionType: 'debit', processedAt: new Date() },
    { userId, emailId: 'em-e', transactionDate: dayUTC('2026-05-27'), merchant: 'E', amount: 888, currency: 'USD', category: 'Food', transactionType: 'debit', processedAt: new Date() },
  ]);

  const { aggregateDailyContext } = createAnalysisActivities(buildContainer());
  const ctx = await aggregateDailyContext({ userId, analysisDate: '2026-05-28' });

  assert.equal(ctx.transactions.length, 3, 'only the three 2026-05-28 transactions');
  assert.deepEqual(ctx.totals, { income: 500, expenses: 40, net: 460 });
  assert.equal(ctx.currency, 'USD');
});

test('aggregateDailyContext budget snapshot uses current-month rows and computes daysRemainingInPeriod', async () => {
  const userId = await seedTenant();

  await Budget.create({
    userId,
    year: 2026,
    month: 5,
    categories: [{ category: 'Food', budgetAmount: 500, spentAmount: 300, transactionCount: 4 }],
    totalBudget: 1500,
    totalSpent: 900,
  });

  const { aggregateDailyContext } = createAnalysisActivities(buildContainer());
  const ctx = await aggregateDailyContext({ userId, analysisDate: '2026-05-15' });

  assert.ok(ctx.budgetSnapshot, 'snapshot present');
  assert.equal(ctx.budgetSnapshot!.totalBudget, 1500);
  assert.equal(ctx.budgetSnapshot!.totalSpent, 900);
  assert.equal(ctx.budgetSnapshot!.percentUsed, 60);
  assert.equal(ctx.budgetSnapshot!.daysRemainingInPeriod, 16, '31 - 15 = 16 days remaining');
});

test('aggregateDailyContext returns null budgetSnapshot when no budget configured', async () => {
  const userId = await seedTenant();
  const { aggregateDailyContext } = createAnalysisActivities(buildContainer());

  const ctx = await aggregateDailyContext({ userId, analysisDate: '2026-05-15' });
  assert.equal(ctx.budgetSnapshot, null);
  assert.equal(ctx.transactions.length, 0);
});

test('aggregateDailyContext defaults to yesterday-UTC when analysisDate is omitted or invalid', async () => {
  const userId = await seedTenant();
  const { aggregateDailyContext } = createAnalysisActivities(buildContainer());

  const expected = (() => {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() - 1);
    return d.toISOString().slice(0, 10);
  })();

  const a = await aggregateDailyContext({ userId });
  assert.equal(a.analysisDate, expected, 'omitted → yesterday UTC');

  const b = await aggregateDailyContext({ userId, analysisDate: '' });
  assert.equal(b.analysisDate, expected, 'empty string → yesterday UTC');

  const c = await aggregateDailyContext({ userId, analysisDate: 'not-a-date' });
  assert.equal(c.analysisDate, expected, 'malformed → yesterday UTC');

  const d = await aggregateDailyContext({ userId, analysisDate: '2026-13-99' });
  assert.equal(d.analysisDate, expected, 'shape-OK-but-impossible → yesterday UTC');
});

test('aggregateDailyContext bounds priorSummaries to last 7, oldest-first', async () => {
  const userId = await seedTenant();

  const rows = [];
  for (let i = 1; i <= 14; i++) {
    rows.push({
      userId,
      analysisDate: dayUTC(`2026-05-${String(i).padStart(2, '0')}`),
      currency: 'USD',
      inputs: { transactionCount: 0, totals: { income: 0, expenses: 0, net: 0 }, balance: 0, budgetSnapshot: null },
      summary: `day-${i}`,
      fullSummary: '',
      suggestions: [],
      modelMeta: { model: 'm', promptVersion: 1, tokensIn: 0, tokensOut: 0 },
      status: 'ready' as const,
      generatedAt: dayUTC(`2026-05-${String(i).padStart(2, '0')}`),
    });
  }
  await TransactionAnalysis.insertMany(rows);

  const { aggregateDailyContext } = createAnalysisActivities(buildContainer());
  const ctx = await aggregateDailyContext({ userId, analysisDate: '2026-05-15' });

  assert.equal(ctx.priorSummaries.length, 7);
  assert.deepEqual(ctx.priorSummaries, ['day-8', 'day-9', 'day-10', 'day-11', 'day-12', 'day-13', 'day-14'], 'oldest-first window over the 7 most recent');
});

// ---------------------------------------------------------------------------
// persistDailyAnalysis
// ---------------------------------------------------------------------------

test('persistDailyAnalysis upserts; second call for same day overwrites, no duplicate row', async () => {
  const userId = 'user-x';
  const { persistDailyAnalysis } = createAnalysisActivities(buildContainer());

  const baseInputs = {
    transactionCount: 1,
    totals: { income: 0, expenses: 10, net: -10 },
    balance: 100,
    budgetSnapshot: null,
  };
  const baseAi = {
    summary: 'first',
    fullSummary: 'full first',
    suggestions: [],
    modelMeta: { model: 'm', promptVersion: 1, tokensIn: 0, tokensOut: 0 },
  };

  const first = await persistDailyAnalysis({
    userId,
    analysisDate: '2026-05-20',
    currency: 'USD',
    language: 'en',
    inputs: baseInputs,
    ai: baseAi,
    status: 'ready',
  });

  const second = await persistDailyAnalysis({
    userId,
    analysisDate: '2026-05-20',
    currency: 'USD',
    language: 'es',
    inputs: baseInputs,
    ai: { ...baseAi, summary: 'second', fullSummary: 'full second' },
    status: 'ready',
  });

  assert.equal(first.analysisId, second.analysisId, 'same row id on upsert');

  const all = await TransactionAnalysis.find({ userId }).lean();
  assert.equal(all.length, 1, 'no duplicate row');
  assert.equal(all[0].summary, 'second');
  assert.equal(all[0].fullSummary, 'full second');
  assert.equal(all[0].language, 'es', 'row records the language it was written in');
});

test('persistDailyAnalysis writes a failed row with reason when ai is null', async () => {
  const userId = 'user-y';
  const { persistDailyAnalysis } = createAnalysisActivities(buildContainer());

  await persistDailyAnalysis({
    userId,
    analysisDate: '2026-05-20',
    currency: 'USD',
    language: 'en',
    inputs: { transactionCount: 0, totals: { income: 0, expenses: 0, net: 0 }, balance: 0, budgetSnapshot: null },
    ai: null,
    status: 'failed',
    failureReason: 'AI gateway timed out',
  });

  const row = await TransactionAnalysis.findOne({ userId }).lean();
  assert.ok(row, 'row persisted');
  assert.equal(row!.status, 'failed');
  assert.equal(row!.failureReason, 'AI gateway timed out');
  assert.equal(row!.summary, '');
  assert.equal(row!.fullSummary, '');
});
