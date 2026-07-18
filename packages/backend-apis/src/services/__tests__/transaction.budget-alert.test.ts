/**
 * Service test: a manually-created debit that crosses its category budget
 * raises an over-budget alert (same rule as the email-ingestion store step),
 * and respects the account's opt-out.
 *
 * Run with:
 *   npx tsx --test packages/backend-apis/src/services/__tests__/transaction.budget-alert.test.ts
 *
 * Backed by mongodb-memory-server.
 */
import 'reflect-metadata';
import { after, before, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';

import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';

import { TransactionService } from '../transaction.service';
import { Alert, Budget, Transaction, User } from '../../../../temporal-workflows/src/models';

const service = new TransactionService();
// Valid ObjectId — the alert gate does `User.findById(userId)`.
const USER = '507f1f77bcf86cd799439011';

let mongod: MongoMemoryServer;

before(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
  await Promise.all([Alert.init(), Budget.init(), Transaction.init()]);
});

after(async () => {
  await mongoose.disconnect();
  await mongod.stop();
});

beforeEach(async () => {
  await Promise.all([
    Alert.deleteMany({}), Budget.deleteMany({}), Transaction.deleteMany({}), User.deleteMany({}),
  ]);
});

async function shoppingBudget(limit: number) {
  await Budget.create({
    userId: USER, year: 2026, month: 6,
    categories: [{ category: 'shopping', budgetAmount: limit, spentAmount: 0, transactionCount: 0 }],
    totalBudget: limit,
  });
}

const draft = {
  merchant: 'Store',
  category: 'shopping',
  transactionType: 'debit' as const,
  transactionDate: '2026-06-10',
  currency: 'USD',
};

test('a manual debit that exceeds the category limit creates an over alert', async () => {
  await shoppingBudget(500);

  await service.create(USER, { ...draft, amount: 600 });

  const alerts = await Alert.find({ userId: USER, kind: 'over' }).lean();
  assert.equal(alerts.length, 1);
  assert.match(alerts[0].body ?? '', /600\.00.*500\.00/);
});

test('under-limit manual debit creates no alert', async () => {
  await shoppingBudget(500);

  await service.create(USER, { ...draft, amount: 100 });

  assert.equal(await Alert.countDocuments({ userId: USER }), 0);
});

test('manual debit respects the account overBudget opt-out', async () => {
  await shoppingBudget(500);
  await User.create({ _id: USER, authUid: 'a', email: 'u@e.com', alertPreferences: { overBudget: false } } as any);

  await service.create(USER, { ...draft, amount: 600 });

  assert.equal(await Alert.countDocuments({ userId: USER }), 0);
});
