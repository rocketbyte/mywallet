/**
 * Tests for the recent-duplicate guard used by the transaction pipeline's
 * storeTransaction step.
 *
 * Run with:
 *   npx tsx --test packages/temporal-workflows/src/infrastructure/persistence/mongodb/repositories/__tests__/transaction.repository.dedup.test.ts
 *
 * Exercises the REAL Mongo filter (`buildRecentDuplicateMongoFilter`, also used
 * by MongoDBTransactionRepository.findRecentDuplicate) against mongodb-memory-server,
 * plus the pure window math (`recentDuplicateWindow`). The DI-decorated repository
 * class itself can't be imported under tsx, so the match logic lives in the shared
 * decorator-free helper that both the repo and this test consume.
 *
 * Match key: (userId, amount, currency, transactionType) within a symmetric
 * ±windowMinutes window around `near`. Merchant is intentionally NOT in the key.
 */
import { after, before, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';

import { randomUUID } from 'node:crypto';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';

import { Transaction } from '../../../../../models/transaction.model';
import {
  buildRecentDuplicateMongoFilter,
  recentDuplicateWindow,
} from '../../../../../shared/recent-duplicate';
import { RecentDuplicateCriteria } from '../../../../../application/interfaces/repositories/transaction-repository.interface';

// Anchor used by every case. The window is applied symmetrically around `near`.
const NEAR = new Date('2026-06-10T12:00:00.000Z');
const WINDOW_MINUTES = 30;

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

interface TxOverrides {
  userId?: string;
  merchant?: string;
  amount?: number;
  currency?: string;
  transactionType?: 'debit' | 'credit';
  transactionDate?: Date;
}

async function insertTx(o: TxOverrides = {}) {
  return Transaction.create({
    userId: o.userId ?? 'user-a',
    emailId: `email-${randomUUID()}`,
    transactionDate: o.transactionDate ?? NEAR,
    merchant: o.merchant ?? 'Starbucks',
    amount: o.amount ?? 5.75,
    currency: o.currency ?? 'USD',
    category: 'food',
    transactionType: o.transactionType ?? 'debit',
  });
}

function criteria(o: Partial<RecentDuplicateCriteria> = {}): RecentDuplicateCriteria {
  return {
    userId: o.userId ?? 'user-a',
    amount: o.amount ?? 5.75,
    currency: o.currency ?? 'USD',
    transactionType: o.transactionType ?? 'debit',
    near: o.near ?? NEAR,
    windowMinutes: o.windowMinutes ?? WINDOW_MINUTES,
  };
}

// Mirrors MongoDBTransactionRepository.findRecentDuplicate using the shared filter.
async function findRecentDuplicate(c: RecentDuplicateCriteria) {
  return Transaction.findOne(buildRecentDuplicateMongoFilter(c)).sort({ transactionDate: -1 });
}

// Minutes offset from NEAR → Date.
function nearPlus(minutes: number): Date {
  return new Date(NEAR.getTime() + minutes * 60 * 1000);
}

// ---- recentDuplicateWindow (pure window math) -----------------------------

test('recentDuplicateWindow spans ±windowMinutes symmetrically around `near`', () => {
  const { from, to } = recentDuplicateWindow(NEAR, 30);
  assert.equal(from.toISOString(), '2026-06-10T11:30:00.000Z');
  assert.equal(to.toISOString(), '2026-06-10T12:30:00.000Z');
});

test('recentDuplicateWindow coerces an ISO-string `near` (Temporal serialization)', () => {
  const { from, to } = recentDuplicateWindow(NEAR.toISOString(), 30);
  assert.equal(from.toISOString(), '2026-06-10T11:30:00.000Z');
  assert.equal(to.toISOString(), '2026-06-10T12:30:00.000Z');
});

// ---- match key + window (real Mongo filter) -------------------------------

test('matches same amount/currency/type within ±30 min (re-notification 18 min later)', async () => {
  await insertTx({ transactionDate: NEAR });

  const dup = await findRecentDuplicate(criteria({ near: nearPlus(18) }));

  assert.ok(dup, 'a duplicate should be found within the window');
  assert.equal(dup!.amount, 5.75);
  assert.equal(dup!.currency, 'USD');
});

test('matches symmetrically — existing row 25 min AFTER the new transaction', async () => {
  await insertTx({ transactionDate: nearPlus(25) });

  const dup = await findRecentDuplicate(criteria({ near: NEAR }));

  assert.ok(dup, 'the window applies on both sides of `near`');
});

test('returns null at >30 min from `near` (genuine second charge)', async () => {
  await insertTx({ transactionDate: nearPlus(31) });

  const dup = await findRecentDuplicate(criteria({ near: NEAR }));

  assert.equal(dup, null);
});

test('returns null for same amount but opposite transactionType (a refund)', async () => {
  await insertTx({ transactionType: 'debit', transactionDate: NEAR });

  const dup = await findRecentDuplicate(criteria({ transactionType: 'credit' }));

  assert.equal(dup, null);
});

test('returns null when only the amount differs within the window', async () => {
  await insertTx({ amount: 5.75, transactionDate: NEAR });

  const dup = await findRecentDuplicate(criteria({ amount: 6.0 }));

  assert.equal(dup, null);
});

test('returns null for a different tenant (isolation)', async () => {
  await insertTx({ userId: 'user-a', transactionDate: NEAR });

  const dup = await findRecentDuplicate(criteria({ userId: 'user-b' }));

  assert.equal(dup, null);
});

test('matches regardless of merchant — same amount/currency/type, different merchant text', async () => {
  // A re-notification may carry slightly different merchant text; the guard must
  // still treat it as the same purchase, so merchant is NOT part of the key.
  await insertTx({ merchant: 'STARBUCKS #1234', transactionDate: NEAR });

  const dup = await findRecentDuplicate(criteria({ near: nearPlus(5) }));

  assert.ok(dup, 'merchant differences must not prevent a duplicate match');
});

test('tolerates an ISO-string `near` end to end (Temporal payload serialization)', async () => {
  await insertTx({ transactionDate: NEAR });

  const dup = await findRecentDuplicate(
    criteria({ near: nearPlus(10).toISOString() as unknown as Date }),
  );

  assert.ok(dup, 'a string `near` should be coerced to a Date');
});
