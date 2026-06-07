/**
 * Service tests for the "fixed expense is debit-only" rule.
 *
 * Run with:
 *   npx tsx --test packages/backend-apis/src/services/__tests__/transaction.fixed-expense.test.ts
 *
 * Backed by mongodb-memory-server.
 */
import 'reflect-metadata';
import { after, before, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';

import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';

import { TransactionService, FixedExpenseOnIncomeError } from '../transaction.service';
import { Transaction } from '../../../../temporal-workflows/src/models';

const service = new TransactionService();
const USER = 'user-fx';

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

const baseDraft = {
  merchant: 'Rent',
  amount: 1200,
  category: 'housing',
  transactionDate: '2026-06-05',
};

test('create rejects isFixedExpense:true on a credit', async () => {
  await assert.rejects(
    () => service.create(USER, { ...baseDraft, transactionType: 'credit', isFixedExpense: true }),
    (err) => err instanceof FixedExpenseOnIncomeError,
  );
  assert.equal(await Transaction.countDocuments({ userId: USER }), 0, 'nothing persisted');
});

test('create allows isFixedExpense:true on a debit', async () => {
  const tx = await service.create(USER, { ...baseDraft, transactionType: 'debit', isFixedExpense: true });
  assert.equal(tx.isFixedExpense, true);
});

test('a new credit does not inherit the flag from a previous-month fixed debit', async () => {
  // Seed last month's fixed debit with the same signature.
  await Transaction.create({
    userId: USER,
    emailId: 'seed-1',
    transactionDate: new Date(2026, 4, 5), // May
    merchant: 'Rent',
    amount: 1200,
    currency: 'USD',
    category: 'housing',
    transactionType: 'debit',
    isFixedExpense: true,
  });

  const credit = await service.create(USER, {
    ...baseDraft,
    transactionType: 'credit', // same signature, but income
  });
  assert.equal(credit.isFixedExpense, false, 'income never inherits the flag');

  // sanity: a debit with the same signature DOES inherit
  const debit = await service.create(USER, { ...baseDraft, transactionType: 'debit' });
  assert.equal(debit.isFixedExpense, true);
});

test('update rejects marking a credit as fixed, but allows converting to debit + marking', async () => {
  const credit = await service.create(USER, { ...baseDraft, transactionType: 'credit' });

  await assert.rejects(
    () => service.update(USER, credit.id, { isFixedExpense: true }),
    (err) => err instanceof FixedExpenseOnIncomeError,
  );
  const after1 = await Transaction.findById(credit.id).lean();
  assert.equal(after1!.isFixedExpense ?? false, false, 'row unchanged');

  const converted = await service.update(USER, credit.id, { transactionType: 'debit', isFixedExpense: true });
  assert.equal(converted!.isFixedExpense, true);
  assert.equal(converted!.isIncome, false);
});

test('propagation skips income siblings', async () => {
  const debit = await service.create(USER, { ...baseDraft, transactionType: 'debit' });
  const credit = await service.create(USER, { ...baseDraft, transactionType: 'credit' });

  await service.update(USER, debit.id, { isFixedExpense: true });

  const creditRow = await Transaction.findById(credit.id).lean();
  assert.equal(creditRow!.isFixedExpense ?? false, false, 'credit sibling not flagged');
  const debitRow = await Transaction.findById(debit.id).lean();
  assert.equal(debitRow!.isFixedExpense, true);
});

test('getBalance.variableExpenses excludes fixed and respects the date range', async () => {
  const inRange = (day: number, over: Partial<Record<string, unknown>>) =>
    Transaction.create({
      userId: USER,
      emailId: `b-${day}-${Math.random()}`,
      transactionDate: new Date(2026, 5, day), // June
      merchant: 'X',
      amount: (over.amount as number) ?? 100,
      currency: 'USD',
      category: 'food',
      transactionType: 'debit',
      ...over,
    });

  await inRange(10, { amount: 600, isFixedExpense: false }); // variable
  await inRange(11, { amount: 1200, isFixedExpense: true }); // fixed -> excluded
  await inRange(12, { amount: 50, transactionType: 'credit', isFixedExpense: false }); // income -> excluded from debits
  await inRange(20, { amount: 999, isFixedExpense: false, transactionDate: new Date(2026, 6, 5) }); // July -> out of range

  const balance = await service.getBalance(USER, { startDate: '2026-06-01', endDate: '2026-06-30' });
  assert.equal(balance.debits, 1800, 'all June expenses');
  assert.equal(balance.variableExpenses, 600, 'June non-fixed expenses only');
});
