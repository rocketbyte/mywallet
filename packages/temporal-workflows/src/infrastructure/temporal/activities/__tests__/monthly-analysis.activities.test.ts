/**
 * Tests for the monthly financial note activities.
 *
 * Run with:
 *   npx tsx --test packages/temporal-workflows/src/infrastructure/temporal/activities/__tests__/monthly-analysis.activities.test.ts
 *
 * Uses mongodb-memory-server so no live Mongo is required. Pipeline-step
 * lookups and the AI gateway go through a stub container.
 */
import 'reflect-metadata';
import { after, before, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';

import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { container as rootContainer } from 'tsyringe';

import { createMonthlyAnalysisActivities } from '../monthly-analysis.activities';
import { Transaction } from '../../../../models/transaction.model';
import { Budget } from '../../../../models/budget.model';
import { Tenant } from '../../../../models/tenant.model';
import { TransactionAnalysis } from '../../../../models/transaction-analysis.model';
import { MonthlyAnalysis } from '../../../../models/monthly-analysis.model';

import { Context } from '@temporalio/activity';
(Context as any).current = () => ({ heartbeat: () => {} });

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
    MonthlyAnalysis.deleteMany({}),
  ]);
});

// --- container stub: AI gateway + pipeline-step repo -------------------------
function buildContainer(opts: { note?: string; promptVersion?: number } = {}) {
  const note = opts.note ?? 'stub monthly note';
  const c = rootContainer.createChildContainer();
  c.register('AIGatewayInterface', {
    useValue: {
      extractStructuredData: async () => ({ data: { note }, confidence: 1, tokensUsed: 0, rawResponse: {} }),
      getProviderName: () => 'stub',
      getModelName: () => 'stub-model',
      getEndpoint: () => 'http://stub',
    },
  });
  c.register('PipelineStepRepositoryInterface', {
    useValue: {
      getActiveStep: async () => ({
        stepKey: 'analyze_month',
        systemPrompt: 'sys',
        userPromptTemplate: 'tmpl {{currency}} {{daily_summaries_json}}',
        temperature: 0.2,
        maxTokens: 180,
        version: opts.promptVersion ?? 1,
      }),
    },
  });
  return c;
}

function dayUTC(iso: string): Date {
  return new Date(`${iso}T00:00:00.000Z`);
}

async function seedTenant(currency = 'USD'): Promise<string> {
  const oid = new mongoose.Types.ObjectId();
  await Tenant.create({ primaryUserId: oid, type: 'individual', currency });
  return String(oid);
}

async function seedDailySummary(userId: string, isoDate: string, summary: string) {
  await TransactionAnalysis.create({
    userId,
    analysisDate: dayUTC(isoDate),
    currency: 'USD',
    inputs: { transactionCount: 0, totals: { income: 0, expenses: 0, net: 0 }, balance: 0, budgetSnapshot: null },
    summary,
    fullSummary: 'full text that must NOT be sent to the model',
    suggestions: [],
    modelMeta: { model: 'm', promptVersion: 1, tokensIn: 0, tokensOut: 0 },
    status: 'ready' as const,
    generatedAt: dayUTC(isoDate),
  });
}

// ---------------------------------------------------------------------------
// aggregateMonthlyContext
// ---------------------------------------------------------------------------

test('aggregateMonthlyContext sums only the target month and collects its daily summaries oldest-first', async () => {
  const userId = await seedTenant('USD');

  await Transaction.create([
    { userId, emailId: 'a', transactionDate: dayUTC('2026-05-02'), merchant: 'A', amount: 100, currency: 'USD', category: 'Food', transactionType: 'debit', processedAt: new Date() },
    { userId, emailId: 'b', transactionDate: dayUTC('2026-05-20'), merchant: 'B', amount: 400, currency: 'USD', category: 'Salary', transactionType: 'credit', processedAt: new Date() },
    // outside the month — must be excluded
    { userId, emailId: 'c', transactionDate: dayUTC('2026-04-30'), merchant: 'C', amount: 999, currency: 'USD', category: 'Food', transactionType: 'debit', processedAt: new Date() },
    { userId, emailId: 'd', transactionDate: dayUTC('2026-06-01'), merchant: 'D', amount: 999, currency: 'USD', category: 'Food', transactionType: 'debit', processedAt: new Date() },
  ]);

  await seedDailySummary(userId, '2026-05-03', 'day-3');
  await seedDailySummary(userId, '2026-05-01', 'day-1');
  await seedDailySummary(userId, '2026-04-15', 'april-should-not-appear');

  const { aggregateMonthlyContext } = createMonthlyAnalysisActivities(buildContainer());
  const ctx = await aggregateMonthlyContext({ userId, year: 2026, month: 5 });

  assert.deepEqual(ctx.totals, { income: 400, expenses: 100, net: 300 });
  assert.deepEqual(ctx.dailySummaries, ['day-1', 'day-3'], 'only May summaries, oldest-first');
  assert.equal(ctx.dailyCount, 2);
  assert.equal(ctx.currency, 'USD');
  assert.equal(ctx.existing, null, 'no monthly row yet');
  assert.ok(ctx.sourceHash.length > 0);
});

test('aggregateMonthlyContext builds budget snapshot and loads the prior-month note', async () => {
  const userId = await seedTenant();

  await Budget.create({
    userId, year: 2026, month: 5,
    categories: [{ category: 'Food', budgetAmount: 500, spentAmount: 300, transactionCount: 4 }],
    totalBudget: 1500, totalSpent: 900,
  });
  await MonthlyAnalysis.create({
    userId, year: 2026, month: 4, currency: 'USD',
    inputs: { dailyCount: 3, totals: { income: 0, expenses: 0, net: 0 }, balance: 0, budgetSnapshot: null, sourceHash: 'x' },
    note: 'April was tight on dining.',
    modelMeta: { model: 'm', promptVersion: 1, tokensIn: 0, tokensOut: 0 },
    status: 'ready',
  });

  const { aggregateMonthlyContext } = createMonthlyAnalysisActivities(buildContainer());
  const ctx = await aggregateMonthlyContext({ userId, year: 2026, month: 5 });

  assert.ok(ctx.budgetSnapshot);
  assert.equal(ctx.budgetSnapshot!.totalBudget, 1500);
  assert.equal(ctx.budgetSnapshot!.percentUsed, 60);
  assert.equal(ctx.priorMonthNote, 'April was tight on dining.');
});

test('aggregateMonthlyContext sourceHash is stable for equal inputs and detects an existing row', async () => {
  const userId = await seedTenant();
  await seedDailySummary(userId, '2026-05-01', 'day-1');

  const { aggregateMonthlyContext, persistMonthlyAnalysis } = createMonthlyAnalysisActivities(buildContainer());
  const a = await aggregateMonthlyContext({ userId, year: 2026, month: 5 });
  const b = await aggregateMonthlyContext({ userId, year: 2026, month: 5 });
  assert.equal(a.sourceHash, b.sourceHash, 'hash stable for identical inputs');

  await persistMonthlyAnalysis({
    userId, year: 2026, month: 5, currency: 'USD',
    inputs: { dailyCount: a.dailyCount, totals: a.totals, balance: a.balance, budgetSnapshot: a.budgetSnapshot, sourceHash: a.sourceHash },
    ai: { note: 'n', modelMeta: { model: 'm', promptVersion: 1, tokensIn: 0, tokensOut: 0 } },
    status: 'ready',
  });

  const c = await aggregateMonthlyContext({ userId, year: 2026, month: 5 });
  assert.ok(c.existing, 'existing row detected');
  assert.equal(c.existing!.status, 'ready');
  assert.equal(c.existing!.sourceHash, a.sourceHash, 'stored hash matches → workflow would skip');
});

test('aggregateMonthlyContext defaults to the current month when year/month omitted', async () => {
  const userId = await seedTenant();
  const { aggregateMonthlyContext } = createMonthlyAnalysisActivities(buildContainer());
  const now = new Date();
  const ctx = await aggregateMonthlyContext({ userId });
  assert.equal(ctx.year, now.getUTCFullYear());
  assert.equal(ctx.month, now.getUTCMonth() + 1);
});

// ---------------------------------------------------------------------------
// analyzeMonthlyContext
// ---------------------------------------------------------------------------

test('analyzeMonthlyContext truncates an oversized note on a word boundary', async () => {
  const longNote = 'word '.repeat(200).trim(); // ~1000 chars
  const { analyzeMonthlyContext } = createMonthlyAnalysisActivities(buildContainer({ note: longNote }));

  const ctx: any = {
    userId: 'u', year: 2026, month: 5, currency: 'USD', dailyCount: 0,
    dailySummaries: [], totals: { income: 0, expenses: 0, net: 0 }, balance: 0,
    budgetSnapshot: null, priorMonthNote: null, sourceHash: 'h', existing: null, promptVersion: 1,
  };
  const out = await analyzeMonthlyContext(ctx);
  assert.ok(out.note.length <= 320, 'note capped at 320');
  assert.ok(!out.note.endsWith(' '), 'no trailing space after word-boundary cut');
});

test('analyzeMonthlyContext rejects an empty note', async () => {
  const { analyzeMonthlyContext } = createMonthlyAnalysisActivities(buildContainer({ note: '   ' }));
  const ctx: any = {
    userId: 'u', year: 2026, month: 5, currency: 'USD', dailyCount: 0,
    dailySummaries: [], totals: { income: 0, expenses: 0, net: 0 }, balance: 0,
    budgetSnapshot: null, priorMonthNote: null, sourceHash: 'h', existing: null, promptVersion: 1,
  };
  await assert.rejects(() => analyzeMonthlyContext(ctx), /empty payload/);
});

// ---------------------------------------------------------------------------
// persistMonthlyAnalysis
// ---------------------------------------------------------------------------

test('persistMonthlyAnalysis upserts; second call for same month overwrites, no duplicate', async () => {
  const userId = 'user-x';
  const { persistMonthlyAnalysis } = createMonthlyAnalysisActivities(buildContainer());
  const inputs = { dailyCount: 1, totals: { income: 0, expenses: 10, net: -10 }, balance: 100, budgetSnapshot: null, sourceHash: 'h1' };
  const baseAi = { note: 'first', modelMeta: { model: 'm', promptVersion: 1, tokensIn: 0, tokensOut: 0 } };

  const first = await persistMonthlyAnalysis({ userId, year: 2026, month: 5, currency: 'USD', inputs, ai: baseAi, status: 'ready' });
  const second = await persistMonthlyAnalysis({ userId, year: 2026, month: 5, currency: 'USD', inputs, ai: { ...baseAi, note: 'second' }, status: 'ready' });

  assert.equal(first.analysisId, second.analysisId, 'same row id on upsert');
  const all = await MonthlyAnalysis.find({ userId }).lean();
  assert.equal(all.length, 1, 'no duplicate row');
  assert.equal(all[0].note, 'second');
});

test('persistMonthlyAnalysis writes a failed row with reason and empty note when ai is null', async () => {
  const userId = 'user-y';
  const { persistMonthlyAnalysis } = createMonthlyAnalysisActivities(buildContainer());

  await persistMonthlyAnalysis({
    userId, year: 2026, month: 5, currency: 'USD',
    inputs: { dailyCount: 0, totals: { income: 0, expenses: 0, net: 0 }, balance: 0, budgetSnapshot: null, sourceHash: 'h' },
    ai: null, status: 'failed', failureReason: 'AI gateway timed out',
  });

  const row = await MonthlyAnalysis.findOne({ userId }).lean();
  assert.ok(row);
  assert.equal(row!.status, 'failed');
  assert.equal(row!.failureReason, 'AI gateway timed out');
  assert.equal(row!.note, '');
});
