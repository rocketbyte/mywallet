/**
 * Tests for the isFixedExpense / isRecurrent list filters
 * (expand-transaction-list-filters).
 *
 * Run with:
 *   npx tsx --test packages/backend-apis/src/services/__tests__/transaction.flag-filters.test.ts
 *
 * Backed by mongodb-memory-server.
 */
import 'reflect-metadata';
import { after, before, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';

import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';

import { TransactionService } from '../transaction.service';
import { boolParam } from '../../utils/request.utils';
import { Transaction } from '../../../../temporal-workflows/src/models';

const service = new TransactionService();
const USER = 'user-flag-filters';
const OTHER_USER = 'user-flag-filters-other';
const PAGE = { limit: 50, offset: 0 };

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

let seq = 0;
function seed(overrides: Record<string, unknown> = {}) {
  seq += 1;
  return Transaction.create({
    userId: USER,
    emailId: `seed-${seq}`,
    transactionDate: new Date(2026, 5, 10), // June
    merchant: 'Shop',
    amount: 20,
    currency: 'USD',
    category: 'other',
    transactionType: 'debit',
    ...overrides,
  });
}

test('boolParam: absent, true, false, and invalid values', () => {
  assert.equal(boolParam(undefined), undefined);
  assert.equal(boolParam('true'), true);
  assert.equal(boolParam('false'), false);
  assert.equal(boolParam('yes'), 'invalid');
  assert.equal(boolParam('1'), 'invalid');
  assert.equal(boolParam(['true']), 'invalid');
  assert.equal(boolParam({ $ne: 'x' }), 'invalid');
});

test('isFixedExpense=true returns only fixed rows with a filtered total', async () => {
  await seed({ merchant: 'Rent', isFixedExpense: true });
  await seed({ merchant: 'Netflix', isFixedExpense: true });
  await seed({ merchant: 'Groceries' });
  await seed({ merchant: 'Legacy row (no flag fields)' });

  const result = await service.list(USER, { ...PAGE, isFixedExpense: true });
  assert.equal(result.pagination.total, 2);
  assert.deepEqual(
    result.transactions.map((t) => t.merchant).sort(),
    ['Netflix', 'Rent'],
  );
  assert.ok(result.transactions.every((t) => t.isFixedExpense));
});

test('isFixedExpense=false matches rows persisted before the flag existed', async () => {
  await seed({ merchant: 'Rent', isFixedExpense: true });
  const legacy = await seed({ merchant: 'Legacy' });
  await Transaction.updateOne({ _id: legacy._id }, { $unset: { isFixedExpense: '', isRecurrent: '' } });

  const result = await service.list(USER, { ...PAGE, isFixedExpense: false });
  assert.equal(result.pagination.total, 1);
  assert.equal(result.transactions[0].merchant, 'Legacy');
});

test('isRecurrent=true returns only recurrent rows', async () => {
  await seed({ merchant: 'Gym', isRecurrent: true });
  await seed({ merchant: 'One-off' });

  const result = await service.list(USER, { ...PAGE, isRecurrent: true });
  assert.equal(result.pagination.total, 1);
  assert.equal(result.transactions[0].merchant, 'Gym');
});

test('flag filter combines with category and date range', async () => {
  await seed({ merchant: 'Netflix', category: 'subscriptions', isFixedExpense: true });
  await seed({ merchant: 'Spotify', category: 'subscriptions' }); // not fixed
  await seed({ merchant: 'Rent', category: 'housing', isFixedExpense: true }); // other category
  await seed({
    merchant: 'Netflix May',
    category: 'subscriptions',
    isFixedExpense: true,
    transactionDate: new Date(2026, 4, 10), // outside range
  });

  const result = await service.list(USER, {
    ...PAGE,
    isFixedExpense: true,
    category: 'subscriptions',
    startDate: '2026-06-01',
    endDate: '2026-06-30',
  });
  assert.equal(result.pagination.total, 1);
  assert.equal(result.transactions[0].merchant, 'Netflix');
});

test('flag filters are tenant-scoped', async () => {
  await seed({ merchant: 'Mine', isRecurrent: true });
  await seed({ userId: OTHER_USER, merchant: 'Theirs', isRecurrent: true });

  const result = await service.list(USER, { ...PAGE, isRecurrent: true });
  assert.equal(result.pagination.total, 1);
  assert.equal(result.transactions[0].merchant, 'Mine');
});
