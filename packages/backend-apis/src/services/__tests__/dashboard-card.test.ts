/**
 * End-to-end check of the "Spent this period" card: seeds real transactions and a
 * budget, then verifies that getBalance, getFixedExpensesSummary and
 * getSpendingPace reconcile — i.e. the whole chain (DB aggregation -> pace math)
 * is internally consistent. Anchored on the real current month so it is robust
 * regardless of when it runs.
 *
 * Run with:
 *   npx tsx --test packages/backend-apis/src/services/__tests__/dashboard-card.test.ts
 */
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';

import { randomUUID } from 'node:crypto';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';

import { TransactionService } from '../transaction.service';
import { Transaction } from '../../../../temporal-workflows/src/models';

const service = new TransactionService();
const USER = 'user-card';
const BUDGET = 3000;

const now = new Date();
const cy = now.getFullYear();
const cm = now.getMonth();
const curMonth = (day: number) => new Date(cy, cm, day, 12, 0, 0);
const prevMonth = (day: number) => new Date(cy, cm - 1, day, 12, 0, 0);
const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

const periodStart = iso(new Date(cy, cm, 1));
const periodEnd = iso(new Date(cy, cm + 1, 0)); // last day of current month

let mongod: MongoMemoryServer;

before(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
  await Transaction.init();

  const seed = (o: Record<string, unknown>) =>
    Transaction.create({
      userId: USER,
      emailId: `seed-${randomUUID()}`,
      currency: 'USD',
      ...o,
    });

  await Promise.all([
    // Current month — counts toward the period balance.
    seed({ merchant: 'Rent', amount: 1200, category: 'housing', transactionType: 'debit', isFixedExpense: true, transactionDate: curMonth(1) }),
    seed({ merchant: 'Groceries', amount: 300, category: 'groceries', transactionType: 'debit', isFixedExpense: false, transactionDate: curMonth(5) }),
    seed({ merchant: 'Shopping', amount: 200, category: 'shopping', transactionType: 'debit', isFixedExpense: false, transactionDate: curMonth(5) }),
    seed({ merchant: 'Salary', amount: 5000, category: 'income', transactionType: 'credit', isFixedExpense: false, transactionDate: curMonth(1) }),
    // Previous month — drives the rolling fixed total (Rent dedups with current; Gym is extra).
    seed({ merchant: 'Rent', amount: 1200, category: 'housing', transactionType: 'debit', isFixedExpense: true, transactionDate: prevMonth(1) }),
    seed({ merchant: 'Gym', amount: 50, category: 'health', transactionType: 'debit', isFixedExpense: true, transactionDate: prevMonth(5) }),
  ]);
});

after(async () => {
  await mongoose.disconnect();
  await mongod.stop();
});

test('balance aggregates the period: debits, variable, income', async () => {
  const balance = await service.getBalance(USER, { startDate: periodStart, endDate: periodEnd });
  assert.equal(balance.debits, 1700); // 1200 rent + 300 + 200
  assert.equal(balance.variableExpenses, 500); // 300 + 200 (non-fixed)
  assert.equal(balance.credits, 5000); // salary
});

test('fixed summary is the deduped rolling total (Rent counted once + Gym)', async () => {
  const fixed = await service.getFixedExpensesSummary(USER);
  assert.equal(fixed.total, 1250); // Rent 1200 (dedup across both months) + Gym 50
});

test('spending pace reconciles with balance + fixed', async () => {
  const balance = await service.getBalance(USER, { startDate: periodStart, endDate: periodEnd });
  const fixed = await service.getFixedExpensesSummary(USER);
  const pace = await service.getSpendingPace(USER, { startDate: periodStart, endDate: periodEnd }, BUDGET);

  // variableBudget = budget − rolling fixed total.
  assert.equal(pace.variableBudget, BUDGET - fixed.total); // 3000 - 1250 = 1750

  // Fixed still pending = commitment − fixed posted this period (1200 rent posted) = 50 (the Gym).
  const fixedPosted = balance.debits - balance.variableExpenses; // 1200
  assert.equal(pace.reservedForFixed, Math.max(0, fixed.total - fixedPosted)); // 50

  // Discretionary money left this month.
  assert.equal(pace.safeToSpendRemaining, round2(pace.variableBudget - balance.variableExpenses)); // 1250

  // Daily average and projection use the period's variable spend + the fixed total.
  // (Computed from raw inputs — the service projects from the UNROUNDED average.)
  const rawDaily = balance.variableExpenses / pace.daysElapsed;
  const rawExpected = pace.variableBudget / pace.daysInMonth;
  assert.equal(pace.dailyAverage, round2(rawDaily));
  assert.equal(pace.projectedExpenses, round2(rawDaily * pace.daysInMonth + fixed.total));

  // safeToSpendPerDay spreads the remaining over the days left (today included).
  assert.equal(pace.safeToSpendPerDay, round2(pace.safeToSpendRemaining / Math.max(1, pace.daysInMonth - pace.daysElapsed + 1)));

  // variancePct is the signed % vs the expected daily average.
  assert.equal(pace.expectedDailyAverage, round2(rawExpected));
  assert.equal(pace.variancePct, Math.round(((rawDaily - rawExpected) / rawExpected) * 100));
});

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
