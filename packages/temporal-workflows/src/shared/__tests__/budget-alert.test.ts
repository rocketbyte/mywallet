/**
 * Tests for over-budget alert generation (evaluateBudgetAlert) over
 * mongodb-memory-server, exercising the real Budget/Transaction/Alert models
 * and the shared carry-forward limit resolver.
 *
 * Run with:
 *   npx tsx --test packages/temporal-workflows/src/shared/__tests__/budget-alert.test.ts
 */
import { after, before, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';

import { randomUUID } from 'node:crypto';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';

import { Alert } from '../../models/alert.model';
import { Budget } from '../../models/budget.model';
import { Transaction } from '../../models/transaction.model';
import { User } from '../../models/user.model';
import { evaluateBudgetAlert, overBudgetDedupeKey } from '../budget-alert';

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

// A valid ObjectId string — the gate does `User.findById(userId)`, so a
// non-ObjectId would cast-error. No User row needs to exist: a missing user is
// treated as opted in (switches default on).
const USER = '507f1f77bcf86cd799439011';
const MAY = new Date('2026-05-15T12:00:00.000Z');

/** Insert a debit and return it, so month-to-date reflects real rows. */
async function debit(category: string, amount: number, date = MAY): Promise<void> {
  await Transaction.create({
    id: randomUUID(),
    emailId: randomUUID(),
    userId: USER,
    transactionDate: date,
    merchant: 'M',
    amount,
    currency: 'USD',
    category,
    transactionType: 'debit',
  } as any);
}

async function setBudget(category: string, budgetAmount: number, year = 2026, month = 5): Promise<void> {
  await Budget.create({
    userId: USER,
    year,
    month,
    categories: [{ category, budgetAmount, spentAmount: 0, transactionCount: 0 }],
    totalBudget: budgetAmount,
  });
}

test('creates one over alert when a debit reaches the category limit', async () => {
  await setBudget('Shopping', 500);
  await debit('Shopping', 480);
  await debit('Shopping', 50); // month-to-date 530 >= 500

  await evaluateBudgetAlert({
    userId: USER, category: 'Shopping', transactionType: 'debit', transactionDate: MAY, currency: 'USD',
  });

  const alerts = await Alert.find({ userId: USER }).lean();
  assert.equal(alerts.length, 1);
  assert.equal(alerts[0].kind, 'over');
  assert.equal(alerts[0].dedupeKey, overBudgetDedupeKey('Shopping', 2026, 5));
  assert.match(alerts[0].title ?? '', /Shopping/);
  assert.match(alerts[0].body ?? '', /530\.00.*500\.00.*106%/);
});

test('is idempotent across retries, replays, and later same-category debits', async () => {
  await setBudget('Shopping', 500);
  await debit('Shopping', 520);

  const evalOnce = () => evaluateBudgetAlert({
    userId: USER, category: 'Shopping', transactionType: 'debit', transactionDate: MAY, currency: 'USD',
  });
  await evalOnce();       // first crossing
  await evalOnce();       // retry / replay
  await debit('Shopping', 30);
  await evalOnce();       // still over, later transaction

  const count = await Alert.countDocuments({ userId: USER });
  assert.equal(count, 1);
});

test('uses the carried-forward limit when no budget exists for the month', async () => {
  await setBudget('Shopping', 500, 2026, 4); // April only
  await debit('Shopping', 520, MAY);         // spending in May

  await evaluateBudgetAlert({
    userId: USER, category: 'Shopping', transactionType: 'debit', transactionDate: MAY, currency: 'USD',
  });

  const count = await Alert.countDocuments({ userId: USER, kind: 'over' });
  assert.equal(count, 1);
});

test('does not alert for credits, unbudgeted categories, or under-limit spend', async () => {
  await setBudget('Shopping', 500);

  // credit ignored (even if it were over)
  await evaluateBudgetAlert({ userId: USER, category: 'Shopping', transactionType: 'credit', transactionDate: MAY });
  // unbudgeted category
  await debit('Travel', 999);
  await evaluateBudgetAlert({ userId: USER, category: 'Travel', transactionType: 'debit', transactionDate: MAY });
  // under limit
  await debit('Shopping', 100);
  await evaluateBudgetAlert({ userId: USER, category: 'Shopping', transactionType: 'debit', transactionDate: MAY });

  const count = await Alert.countDocuments({ userId: USER });
  assert.equal(count, 0);
});

test('does not alert when the category limit is zero', async () => {
  await setBudget('Shopping', 0);
  await debit('Shopping', 50);

  await evaluateBudgetAlert({ userId: USER, category: 'Shopping', transactionType: 'debit', transactionDate: MAY });

  assert.equal(await Alert.countDocuments({ userId: USER }), 0);
});

test('respects the account overBudget preference: false suppresses, true/unset generates', async () => {
  await setBudget('Shopping', 500);
  await debit('Shopping', 600); // over

  // Explicit opt-out — no alert.
  await User.create({ _id: USER, authUid: 'a', email: 'u@e.com', alertPreferences: { overBudget: false } } as any);
  await evaluateBudgetAlert({ userId: USER, category: 'Shopping', transactionType: 'debit', transactionDate: MAY, currency: 'USD' });
  assert.equal(await Alert.countDocuments({ userId: USER }), 0, 'suppressed when overBudget is false');

  // Flip to enabled — alert now generates.
  await User.updateOne({ _id: USER }, { $set: { 'alertPreferences.overBudget': true } });
  await evaluateBudgetAlert({ userId: USER, category: 'Shopping', transactionType: 'debit', transactionDate: MAY, currency: 'USD' });
  assert.equal(await Alert.countDocuments({ userId: USER }), 1, 'generates when overBudget is true');
});
