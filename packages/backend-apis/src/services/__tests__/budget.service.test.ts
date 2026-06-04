/**
 * Service tests for the budget capability: carry-forward resolution, live
 * spent/balance computation, and tenant scoping.
 *
 * Run with:
 *   npx tsx --test packages/backend-apis/src/services/__tests__/budget.service.test.ts
 *
 * Backed by mongodb-memory-server. `getCurrent` resolves against the real
 * "now", so the fixtures are anchored relative to the current month.
 */
import 'reflect-metadata';
import { after, before, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';

import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';

import { BudgetService } from '../budget.service';
import { Budget, Transaction } from '../../../../temporal-workflows/src/models';

const service = new BudgetService();
const USER = 'user-budget';

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
  await Budget.deleteMany({});
  await Transaction.deleteMany({});
});

const now = new Date();
const CUR_YEAR = now.getFullYear();
const CUR_MONTH = now.getMonth() + 1; // 1-based
// Previous calendar month relative to now.
const prev = new Date(CUR_YEAR, CUR_MONTH - 2, 1);
const PREV_YEAR = prev.getFullYear();
const PREV_MONTH = prev.getMonth() + 1;

async function seedBudget(year: number, month: number, cats: Record<string, number>) {
  const categories = Object.entries(cats).map(([category, budgetAmount]) => ({
    category,
    budgetAmount,
    spentAmount: 0,
    transactionCount: 0,
  }));
  const totalBudget = categories.reduce((s, c) => s + c.budgetAmount, 0);
  await Budget.create({ userId: USER, year, month, totalBudget, categories });
}

async function seedDebit(year: number, month: number, category: string, amount: number) {
  await Transaction.create({
    userId: USER,
    transactionDate: new Date(year, month - 1, 15, 12, 0, 0),
    merchant: 'Test',
    amount,
    currency: 'USD',
    category,
    transactionType: 'debit',
    emailId: `e-${Math.random()}`,
  });
}

test('getCurrent returns null when the user has never set a budget', async () => {
  assert.equal(await service.getCurrent(USER), null);
});

test('getCurrent carries last month forward with current-month spent', async () => {
  await seedBudget(PREV_YEAR, PREV_MONTH, { Food: 500, Travel: 300 });
  // Spending lands in the CURRENT month, not the budget's month.
  await seedDebit(CUR_YEAR, CUR_MONTH, 'Food', 220);
  await seedDebit(CUR_YEAR, CUR_MONTH, 'Travel', 80);

  const dto = await service.getCurrent(USER);
  assert.ok(dto);
  assert.equal(dto.isCarriedForward, true);
  assert.equal(dto.year, CUR_YEAR);
  assert.equal(dto.month, CUR_MONTH);
  assert.equal(dto.totalBudget, 800);
  assert.equal(dto.totalSpent, 300);
  assert.equal(dto.balance, 500);
  const food = dto.categories.find((c) => c.category === 'Food');
  assert.equal(food!.budget, 500);
  assert.equal(food!.spent, 220);
  assert.equal(food!.transactionCount, 1);
});

test('persisting the current month replaces the carried base', async () => {
  await seedBudget(PREV_YEAR, PREV_MONTH, { Food: 500 });
  const carried = await service.getCurrent(USER);
  assert.equal(carried!.isCarriedForward, true);

  await service.upsert(USER, {
    year: CUR_YEAR,
    month: CUR_MONTH,
    categories: [{ category: 'Food', budget: 700 }],
  });

  const fresh = await service.getCurrent(USER);
  assert.equal(fresh!.isCarriedForward, false);
  assert.equal(fresh!.totalBudget, 700);
});

test('balance goes negative when overspent', async () => {
  await seedBudget(CUR_YEAR, CUR_MONTH, { Food: 500 });
  await seedDebit(CUR_YEAR, CUR_MONTH, 'Food', 530);

  const dto = await service.getCurrent(USER);
  assert.equal(dto!.totalSpent, 530);
  assert.equal(dto!.balance, -30);
});

test('upsert backfills spent for the target month', async () => {
  await seedDebit(CUR_YEAR, CUR_MONTH, 'Food', 200);
  const dto = await service.upsert(USER, {
    year: CUR_YEAR,
    month: CUR_MONTH,
    categories: [{ category: 'Food', budget: 500 }],
  });
  const food = dto.categories.find((c) => c.category === 'Food');
  assert.equal(food!.spent, 200);
  assert.equal(dto.balance, 300);
});

test('getCurrent is scoped to the caller (no cross-tenant leak)', async () => {
  await seedBudget(CUR_YEAR, CUR_MONTH, { Food: 500 });
  assert.equal(await service.getCurrent('someone-else'), null);
});

test('totalSpent counts unbudgeted categories so remaining money is correct', async () => {
  await seedBudget(CUR_YEAR, CUR_MONTH, { Food: 500 });
  await seedDebit(CUR_YEAR, CUR_MONTH, 'Food', 100);
  await seedDebit(CUR_YEAR, CUR_MONTH, 'Travel', 250); // not in the budget

  const dto = await service.getCurrent(USER);
  assert.equal(dto!.totalSpent, 350);
  assert.equal(dto!.balance, 150);
});
