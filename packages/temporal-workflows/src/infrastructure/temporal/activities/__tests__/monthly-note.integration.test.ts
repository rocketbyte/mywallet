/**
 * Integration test for the monthly financial note.
 *
 * Run with:
 *   npx tsx --test packages/temporal-workflows/src/infrastructure/temporal/activities/__tests__/monthly-note.integration.test.ts
 *
 * Drives the three activities in the exact order `monthlyFinancialNoteWorkflow`
 * does (including the `shouldSkipMonthlyNote` guard) against mongodb-memory-server
 * with a call-counting AI stub. This exercises everything the workflow does
 * except Temporal's orchestration glue: aggregation, the skip-when-unchanged
 * decision, the AI step, persistence, and the failed-status path.
 */
import 'reflect-metadata';
import { after, before, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';

import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { container as rootContainer } from 'tsyringe';

import { createMonthlyAnalysisActivities, type MonthlyAnalysisActivities } from '../monthly-analysis.activities';
import { shouldSkipMonthlyNote } from '../../../../shared/monthly-note';
import { Transaction } from '../../../../models/transaction.model';
import { Budget } from '../../../../models/budget.model';
import { Tenant } from '../../../../models/tenant.model';
import { TransactionAnalysis } from '../../../../models/transaction-analysis.model';
import { MonthlyAnalysis } from '../../../../models/monthly-analysis.model';
import type { MonthlyNoteWorkflowInput, MonthlyNoteWorkflowResult } from '../../../../shared/types';

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

// Call-counting AI stub so we can assert the skip path spends no AI call.
function buildContainer(opts: { note?: string; fail?: boolean; counter: { calls: number } }) {
  const c = rootContainer.createChildContainer();
  c.register('AIGatewayInterface', {
    useValue: {
      extractStructuredData: async () => {
        opts.counter.calls++;
        if (opts.fail) throw new Error('AI gateway down');
        return { data: { note: opts.note ?? 'monthly note' }, confidence: 1, tokensUsed: 5, rawResponse: {} };
      },
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
        userPromptTemplate: 'tmpl {{daily_summaries_json}}',
        temperature: 0.2,
        maxTokens: 180,
        version: 1,
      }),
    },
  });
  return c;
}

/** Mirrors `monthlyFinancialNoteWorkflow`'s control flow exactly. */
async function runMonthlyNote(
  acts: MonthlyAnalysisActivities,
  input: MonthlyNoteWorkflowInput
): Promise<MonthlyNoteWorkflowResult> {
  const ctx = await acts.aggregateMonthlyContext(input);
  const inputs = {
    dailyCount: ctx.dailyCount,
    totals: ctx.totals,
    balance: ctx.balance,
    budgetSnapshot: ctx.budgetSnapshot,
    sourceHash: ctx.sourceHash,
  };

  if (shouldSkipMonthlyNote(ctx.existing, ctx.sourceHash)) {
    return { status: 'skipped', analysisId: ctx.existing!.analysisId };
  }

  try {
    const ai = await acts.analyzeMonthlyContext(ctx);
    const { analysisId } = await acts.persistMonthlyAnalysis({
      userId: input.userId, year: ctx.year, month: ctx.month, currency: ctx.currency, inputs, ai, status: 'ready',
    });
    return { status: 'ready', analysisId };
  } catch (err: any) {
    const reason = err?.message ?? 'analyze step failed';
    const { analysisId } = await acts.persistMonthlyAnalysis({
      userId: input.userId, year: ctx.year, month: ctx.month, currency: ctx.currency, inputs, ai: null, status: 'failed', failureReason: reason,
    });
    return { status: 'failed', analysisId, reason };
  }
}

function dayUTC(iso: string): Date {
  return new Date(`${iso}T00:00:00.000Z`);
}

async function seedTenant(): Promise<string> {
  const oid = new mongoose.Types.ObjectId();
  await Tenant.create({ primaryUserId: oid, type: 'individual', currency: 'USD' });
  return String(oid);
}

async function seedDailySummary(userId: string, isoDate: string, summary: string) {
  await TransactionAnalysis.create({
    userId, analysisDate: dayUTC(isoDate), currency: 'USD',
    inputs: { transactionCount: 0, totals: { income: 0, expenses: 0, net: 0 }, balance: 0, budgetSnapshot: null },
    summary, fullSummary: '', suggestions: [],
    modelMeta: { model: 'm', promptVersion: 1, tokensIn: 0, tokensOut: 0 },
    status: 'ready' as const, generatedAt: dayUTC(isoDate),
  });
}

// ---------------------------------------------------------------------------

test('end-to-end: first run writes a ready note, unchanged rerun skips the AI, new data recomputes', async () => {
  const userId = await seedTenant();
  await seedDailySummary(userId, '2026-05-01', 'spent on groceries');
  const counter = { calls: 0 };
  const acts = createMonthlyAnalysisActivities(buildContainer({ note: 'May is on track.', counter }));

  // 1) First run → ready, exactly one AI call, exactly one row.
  const first = await runMonthlyNote(acts, { userId, year: 2026, month: 5 });
  assert.equal(first.status, 'ready');
  assert.equal(counter.calls, 1, 'one AI call on the first run');
  const rows1 = await MonthlyAnalysis.find({ userId }).lean();
  assert.equal(rows1.length, 1);
  assert.equal(rows1[0].note, 'May is on track.');

  // 2) Rerun with nothing changed → skipped, NO additional AI call, row untouched.
  const second = await runMonthlyNote(acts, { userId, year: 2026, month: 5 });
  assert.equal(second.status, 'skipped');
  assert.equal(second.analysisId, first.analysisId);
  assert.equal(counter.calls, 1, 'skip path spends no AI call');
  const rows2 = await MonthlyAnalysis.find({ userId }).lean();
  assert.equal(rows2.length, 1, 'no duplicate row');

  // 3) A new daily summary changes the inputs → recompute (second AI call).
  await seedDailySummary(userId, '2026-05-02', 'big electronics purchase');
  const third = await runMonthlyNote(acts, { userId, year: 2026, month: 5 });
  assert.equal(third.status, 'ready');
  assert.equal(third.analysisId, first.analysisId, 'same row, overwritten');
  assert.equal(counter.calls, 2, 'changed month triggers exactly one more AI call');
});

test('end-to-end: AI failure persists a failed row and still spends only the attempted call', async () => {
  const userId = await seedTenant();
  await seedDailySummary(userId, '2026-05-01', 'something');
  const counter = { calls: 0 };
  const acts = createMonthlyAnalysisActivities(buildContainer({ fail: true, counter }));

  const result = await runMonthlyNote(acts, { userId, year: 2026, month: 5 });
  assert.equal(result.status, 'failed');
  assert.match(result.reason ?? '', /AI gateway down/);

  const row = await MonthlyAnalysis.findOne({ userId }).lean();
  assert.ok(row);
  assert.equal(row!.status, 'failed');
  assert.equal(row!.note, '');
  assert.match(row!.failureReason ?? '', /AI gateway down/);
});

test('shouldSkipMonthlyNote truth table', () => {
  assert.equal(shouldSkipMonthlyNote(null, 'h'), false, 'no existing row → never skip');
  assert.equal(shouldSkipMonthlyNote({ analysisId: 'a', sourceHash: 'h', status: 'ready' }, 'h'), true, 'ready + matching hash → skip');
  assert.equal(shouldSkipMonthlyNote({ analysisId: 'a', sourceHash: 'h', status: 'ready' }, 'other'), false, 'hash differs → recompute');
  assert.equal(shouldSkipMonthlyNote({ analysisId: 'a', sourceHash: 'h', status: 'failed' }, 'h'), false, 'failed row → recompute even if hash matches');
});
