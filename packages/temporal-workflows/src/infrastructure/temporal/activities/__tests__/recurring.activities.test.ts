/**
 * Tests for the recurring-transactions activities (monthly copy job).
 *
 * Run with:
 *   npx tsx --test packages/temporal-workflows/src/infrastructure/temporal/activities/__tests__/recurring.activities.test.ts
 *
 * Uses mongodb-memory-server so no live Mongo is required.
 */
import { after, before, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';

import { randomUUID } from 'node:crypto';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';

import { createRecurringActivities } from '../recurring.activities';
import { Transaction } from '../../../../models/transaction.model';

const acts = createRecurringActivities();

// May 2026 -> June 2026 window used by most cases.
const SOURCE_START = new Date(2026, 4, 1); // May 1
const SOURCE_END = new Date(2026, 5, 1); // June 1
const TARGET = { targetYear: 2026, targetMonth0: 5, targetYearMonth: '2026-06' };

let mongod: MongoMemoryServer;

before(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
  // Build indexes up front so the unique {userId, emailId} guard is in place for
  // the idempotency assertions (avoids racing async autoIndex).
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
  category?: string;
  transactionType?: 'debit' | 'credit';
  transactionDate?: Date;
  isRecurrent?: boolean;
  isFixedExpense?: boolean;
  note?: string;
}

async function insertTx(o: TxOverrides = {}) {
  return Transaction.create({
    userId: o.userId ?? 'user-a',
    // Every real transaction carries a unique emailId (manual rows use a synthetic
    // one); mirror that so the unique {userId, emailId} index behaves as in prod.
    emailId: `manual-${randomUUID()}`,
    transactionDate: o.transactionDate ?? new Date(2026, 4, 15),
    merchant: o.merchant ?? 'Rent',
    amount: o.amount ?? 1200,
    currency: 'USD',
    category: o.category ?? 'housing',
    transactionType: o.transactionType ?? 'debit',
    isRecurrent: o.isRecurrent ?? true,
    isFixedExpense: o.isFixedExpense ?? false,
    note: o.note,
  });
}

function copyPage(userId: string, extra: Record<string, unknown> = {}) {
  return acts.copyRecurringTransactionsForUserPage({
    userId,
    sourceStart: SOURCE_START,
    sourceEnd: SOURCE_END,
    ...TARGET,
    limit: 200,
    ...extra,
  });
}

test('copies a recurrent row into the target month, preserving attributes', async () => {
  const src = await insertTx({ isFixedExpense: true, note: 'lease', merchant: 'Rent', amount: 1200 });

  const res = await copyPage('user-a');
  assert.equal(res.scanned, 1);
  assert.equal(res.copied, 1);

  const copy = await Transaction.findOne({ userId: 'user-a', source: 'recurring' }).lean();
  assert.ok(copy, 'a recurring copy should exist');
  assert.equal(copy!.merchant, 'Rent');
  assert.equal(copy!.amount, 1200);
  assert.equal(copy!.category, 'housing');
  assert.equal(copy!.transactionType, 'debit');
  assert.equal(copy!.note, 'lease');
  assert.equal(copy!.isFixedExpense, true);
  assert.equal(copy!.isRecurrent, true, 'copy stays recurrent so the series perpetuates');
  assert.equal(copy!.emailId, `recurring:${String(src._id)}:2026-06`);
  // June, same day-of-month.
  assert.equal(new Date(copy!.transactionDate).getMonth(), 5);
  assert.equal(new Date(copy!.transactionDate).getDate(), 15);
});

test('is idempotent — re-running creates no duplicate', async () => {
  await insertTx();

  const first = await copyPage('user-a');
  assert.equal(first.copied, 1);

  const second = await copyPage('user-a');
  assert.equal(second.scanned, 1);
  assert.equal(second.copied, 0, 'second run inserts nothing');

  const copies = await Transaction.countDocuments({ userId: 'user-a', source: 'recurring' });
  assert.equal(copies, 1);
});

test('only copies the caller tenant’s rows', async () => {
  await insertTx({ userId: 'user-a' });
  await insertTx({ userId: 'user-b' });

  await copyPage('user-a');

  assert.equal(await Transaction.countDocuments({ userId: 'user-a', source: 'recurring' }), 1);
  assert.equal(await Transaction.countDocuments({ userId: 'user-b', source: 'recurring' }), 0);
});

test('ignores non-recurrent rows and rows outside the source month', async () => {
  await insertTx({ isRecurrent: false }); // not recurrent
  await insertTx({ transactionDate: new Date(2026, 3, 15) }); // April, before source window
  await insertTx({ transactionDate: new Date(2026, 5, 2) }); // June, after source window

  const res = await copyPage('user-a');
  assert.equal(res.scanned, 0);
  assert.equal(res.copied, 0);
});

test('clamps the day of month (Jan 31 -> Feb 28)', async () => {
  await insertTx({ transactionDate: new Date(2026, 0, 31) });

  const res = await acts.copyRecurringTransactionsForUserPage({
    userId: 'user-a',
    sourceStart: new Date(2026, 0, 1), // Jan
    sourceEnd: new Date(2026, 1, 1), // Feb
    targetYear: 2026,
    targetMonth0: 1, // Feb
    targetYearMonth: '2026-02',
    limit: 200,
  });
  assert.equal(res.copied, 1);

  const copy = await Transaction.findOne({ userId: 'user-a', source: 'recurring' }).lean();
  assert.equal(new Date(copy!.transactionDate).getMonth(), 1);
  assert.equal(new Date(copy!.transactionDate).getDate(), 28);
});

test('paginates by _id cursor', async () => {
  await insertTx({ merchant: 'A' });
  await insertTx({ merchant: 'B' });
  await insertTx({ merchant: 'C' });

  const page1 = await copyPage('user-a', { limit: 2 });
  assert.equal(page1.scanned, 2);
  assert.equal(page1.copied, 2);
  assert.ok(page1.nextCursor, 'full page returns a cursor');

  const page2 = await copyPage('user-a', { limit: 2, afterId: page1.nextCursor });
  assert.equal(page2.scanned, 1);
  assert.equal(page2.copied, 1);
  assert.equal(page2.nextCursor, null);

  assert.equal(await Transaction.countDocuments({ userId: 'user-a', source: 'recurring' }), 3);
});

test('listUsersWithRecurringTransactions returns distinct users, cursor-paginated, excluding non-recurrent', async () => {
  await insertTx({ userId: 'user-a' });
  await insertTx({ userId: 'user-a' }); // same user twice -> distinct
  await insertTx({ userId: 'user-b' });
  await insertTx({ userId: 'user-c' });
  await insertTx({ userId: 'user-d', isRecurrent: false }); // excluded

  const page1 = await acts.listUsersWithRecurringTransactions({
    sourceStart: SOURCE_START,
    sourceEnd: SOURCE_END,
    limit: 2,
  });
  assert.deepEqual(page1.userIds, ['user-a', 'user-b']);
  assert.equal(page1.nextCursor, 'user-b');

  const page2 = await acts.listUsersWithRecurringTransactions({
    sourceStart: SOURCE_START,
    sourceEnd: SOURCE_END,
    afterUserId: page1.nextCursor,
    limit: 2,
  });
  assert.deepEqual(page2.userIds, ['user-c']);
  assert.equal(page2.nextCursor, null, 'partial page ends the scan');
});
