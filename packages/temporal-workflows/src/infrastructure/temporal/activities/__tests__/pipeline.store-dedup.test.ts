/**
 * Tests for the storeTransaction activity's deduplication orchestration.
 *
 * Run with:
 *   npx tsx --test packages/temporal-workflows/src/infrastructure/temporal/activities/__tests__/pipeline.store-dedup.test.ts
 *
 * Exercises the REAL storeTransaction activity (createPipelineActivities) over
 * mongodb-memory-server. The transaction repo fake is a thin, faithful mirror of
 * MongoDBTransactionRepository: findRecentDuplicate delegates to the same shared
 * `buildRecentDuplicateMongoFilter` production uses, and save inserts a real row.
 * This verifies the activity's branching — same-email idempotency, the ±30-min
 * recent-duplicate skip, and a genuine insert — end to end.
 */
import 'reflect-metadata';
import { after, before, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';

import { randomUUID } from 'node:crypto';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { container as rootContainer } from 'tsyringe';

import { createPipelineActivities } from '../pipeline.activities';
import { Transaction } from '../../../../models/transaction.model';
import { buildRecentDuplicateMongoFilter } from '../../../../shared/recent-duplicate';
import { RecentDuplicateCriteria } from '../../../../application/interfaces/repositories/transaction-repository.interface';
import { StoreTransactionInput, RawTransactionData } from '../../../../shared/types';

// Activity Context.heartbeat needs a context — patch it with a no-op so the
// production code can call heartbeat() without a Temporal runtime.
import { Context } from '@temporalio/activity';
(Context as any).current = () => ({ heartbeat: () => {} });

const NEAR = new Date('2026-06-10T12:00:00.000Z');

let mongod: MongoMemoryServer;

before(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
  await Transaction.init();
});

after(async () => {
  await mongoose.disconnect();
  await mongod.stop();
});

beforeEach(async () => {
  await Transaction.deleteMany({});
});

// --- faithful repo fakes (no DI decorators) ---------------------------------
// transactionRepo mirrors MongoDBTransactionRepository over the in-memory model.
function buildContainer() {
  const c = rootContainer.createChildContainer();

  c.register('AIGatewayInterface', { useValue: {} });
  c.register('PipelineStepRepositoryInterface', { useValue: {} });

  c.register('TransactionRepositoryInterface', {
    useValue: {
      findByEmailId: async (userId: string, emailId: string) => {
        const doc = await Transaction.findOne({ userId, emailId });
        return doc ? { id: String(doc._id), merchant: doc.merchant, amount: doc.amount, currency: doc.currency } : null;
      },
      findRecentDuplicate: async (cr: RecentDuplicateCriteria) => {
        const doc = await Transaction.findOne(buildRecentDuplicateMongoFilter(cr)).sort({ transactionDate: -1 });
        return doc ? { id: String(doc._id), merchant: doc.merchant, amount: doc.amount, currency: doc.currency } : null;
      },
      save: async (t: any) => {
        const doc = await Transaction.create({
          userId: t.userId,
          emailId: t.emailId,
          transactionDate: t.transactionDate,
          merchant: t.merchant,
          amount: t.amount,
          currency: t.currency,
          category: t.category ?? 'Other',
          transactionType: t.transactionType,
          isFixedExpense: t.isFixedExpense ?? false,
        });
        return { id: String(doc._id), merchant: doc.merchant, amount: doc.amount, currency: doc.currency };
      },
    },
  });

  c.register('EmailRepositoryInterface', {
    useValue: {
      findById: async (_userId: string, emailId: string) => ({
        id: emailId, emailId, subject: 'Purchase', from: 'bank@example.com', date: NEAR, body: 'You spent $5.75',
      }),
      updateProcessingStatus: async () => {},
    },
  });

  return c;
}

function rawData(o: Partial<RawTransactionData> = {}): RawTransactionData {
  return {
    merchant: o.merchant ?? 'Starbucks',
    amount: o.amount ?? 5.75,
    currency: o.currency ?? 'USD',
    transactionDate: o.transactionDate ?? NEAR,
    transactionType: o.transactionType ?? 'debit',
    bankName: o.bankName ?? 'Bank',
    category: o.category ?? 'food',
    confidence: o.confidence ?? 0.9,
  };
}

function storeInput(o: { emailId?: string; userId?: string; raw?: Partial<RawTransactionData> } = {}): StoreTransactionInput {
  return {
    userId: o.userId ?? 'user-a',
    emailId: o.emailId ?? `email-${randomUUID()}`,
    rawData: rawData(o.raw),
    workflowId: 'wf-1',
    workflowRunId: 'run-1',
  };
}

// Seed a row directly (the "already stored" transaction).
async function seedTx(o: { userId?: string; emailId?: string; merchant?: string; amount?: number; transactionType?: 'debit' | 'credit'; transactionDate?: Date } = {}) {
  return Transaction.create({
    userId: o.userId ?? 'user-a',
    emailId: o.emailId ?? `email-${randomUUID()}`,
    transactionDate: o.transactionDate ?? NEAR,
    merchant: o.merchant ?? 'Starbucks',
    amount: o.amount ?? 5.75,
    currency: 'USD',
    category: 'food',
    transactionType: o.transactionType ?? 'debit',
  });
}

function nearPlus(minutes: number): Date {
  return new Date(NEAR.getTime() + minutes * 60 * 1000);
}

// ---------------------------------------------------------------------------

test('skips a same-merchant/amount re-notification within ±30 min and persists nothing', async () => {
  await seedTx({ transactionDate: NEAR });
  const { storeTransaction } = createPipelineActivities(buildContainer());

  const res = await storeTransaction(storeInput({ raw: { transactionDate: nearPlus(18) } }));

  assert.equal(res.isDuplicate, true);
  assert.equal(res.duplicateReason, 'recent-same-amount');
  assert.equal(await Transaction.countDocuments({}), 1, 'no second row should be created');
});

test('returns same-email duplicate when the email was already stored', async () => {
  const emailId = `email-${randomUUID()}`;
  await seedTx({ emailId, transactionDate: NEAR });
  const { storeTransaction } = createPipelineActivities(buildContainer());

  const res = await storeTransaction(storeInput({ emailId }));

  assert.equal(res.isDuplicate, true);
  assert.equal(res.duplicateReason, 'same-email');
  assert.equal(await Transaction.countDocuments({}), 1);
});

test('persists a genuine insert when no duplicate exists', async () => {
  const { storeTransaction } = createPipelineActivities(buildContainer());

  const res = await storeTransaction(storeInput({ raw: { transactionDate: NEAR } }));

  assert.ok(!res.isDuplicate, 'should not be flagged a duplicate');
  assert.equal(res.merchant, 'Starbucks');
  assert.equal(await Transaction.countDocuments({}), 1);
});

test('merchant is NOT part of the key — same amount, different merchant, within window IS a duplicate', async () => {
  await seedTx({ merchant: 'Cafe Aroma', amount: 12, transactionDate: NEAR });
  const { storeTransaction } = createPipelineActivities(buildContainer());

  // Same amount, same window — the recent-duplicate key ignores merchant, so a
  // re-notification carrying different merchant text is still caught. This locks
  // in the deliberate choice to exclude merchant from the key.
  const res = await storeTransaction(storeInput({ raw: { merchant: 'Walgreens', amount: 12, transactionDate: nearPlus(10) } }));

  assert.equal(res.isDuplicate, true, 'merchant is intentionally not part of the dedup key');
  assert.equal(res.duplicateReason, 'recent-same-amount');
});

test('a same-amount charge beyond ±30 min IS persisted', async () => {
  await seedTx({ amount: 12, transactionDate: NEAR });
  const { storeTransaction } = createPipelineActivities(buildContainer());

  const res = await storeTransaction(storeInput({ raw: { amount: 12, transactionDate: nearPlus(45) } }));

  assert.ok(!res.isDuplicate, 'beyond the window it is a genuine second charge');
  assert.equal(await Transaction.countDocuments({ amount: 12 }), 2);
});

test('a same-amount opposite-direction charge (refund) within the window IS persisted', async () => {
  await seedTx({ amount: 30, transactionType: 'debit', transactionDate: NEAR });
  const { storeTransaction } = createPipelineActivities(buildContainer());

  const res = await storeTransaction(storeInput({ raw: { amount: 30, transactionType: 'credit', transactionDate: nearPlus(15) } }));

  assert.ok(!res.isDuplicate, 'opposite transactionType is not a duplicate');
  assert.equal(await Transaction.countDocuments({ amount: 30 }), 2);
});
