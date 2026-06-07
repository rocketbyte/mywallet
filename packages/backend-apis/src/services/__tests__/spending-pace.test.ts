/**
 * Pure unit tests for computeSpendingPace (no DB).
 *
 * Run with:
 *   npx tsx --test packages/backend-apis/src/services/__tests__/spending-pace.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { computeSpendingPace } from '../transaction.service';

// Anchor on a 30-day month, day 10, so daysInMonth=30, daysElapsed=10.
const NOW = new Date(2026, 8, 10); // September 10 (Sep has 30 days)

test('daily average and projection use month progress', () => {
  const pace = computeSpendingPace({ variableExpenses: 300, budgetLimit: 1500, fixedExpenses: 0, now: NOW });
  assert.equal(pace.daysElapsed, 10);
  assert.equal(pace.daysInMonth, 30);
  assert.equal(pace.dailyAverage, 30); // 300 / 10
  assert.equal(pace.projectedExpenses, 900); // 30 * 30
});

test('status is under when projected is within the variable budget', () => {
  // budget 1500, no fixed -> variableBudget 1500; projected 900 < 1500.
  const pace = computeSpendingPace({ variableExpenses: 300, budgetLimit: 1500, fixedExpenses: 0, now: NOW });
  assert.equal(pace.variableBudget, 1500);
  assert.equal(pace.status, 'under');
});

test('variable budget subtracts the recurring fixed-expense total', () => {
  // budget 1500, fixed total 500 -> variableBudget 1000 (regardless of in-range debits).
  const pace = computeSpendingPace({ variableExpenses: 300, budgetLimit: 1500, fixedExpenses: 500, now: NOW });
  assert.equal(pace.variableBudget, 1000);
  assert.equal(pace.expectedDailyAverage, round2(1000 / 30));
});

test('status is near just over the variable budget (<=115%)', () => {
  // variableBudget = 1500 - 500 = 1000; projected variable = 366.67/10*30 ≈ 1100 -> ratio 1.1 -> near.
  const pace = computeSpendingPace({ variableExpenses: 366.67, budgetLimit: 1500, fixedExpenses: 500, now: NOW });
  assert.equal(pace.variableBudget, 1000);
  assert.equal(pace.status, 'near');
});

test('status is over well past the variable budget (>115%)', () => {
  // variableBudget 1500; projected variable = 600/10*30 = 1800 -> ratio 1.2 -> over.
  const pace = computeSpendingPace({ variableExpenses: 600, budgetLimit: 1500, fixedExpenses: 0, now: NOW });
  assert.equal(pace.projectedExpenses, 1800);
  assert.equal(pace.status, 'over');
});

test('status is none when no budget is set', () => {
  const pace = computeSpendingPace({ variableExpenses: 600, budgetLimit: 0, fixedExpenses: 0, now: NOW });
  assert.equal(pace.status, 'none');
  assert.equal(pace.projectedExpenses, 1800); // still projected
});

test('projection includes the fixed-expense total; status stays variable-paced', () => {
  // projected variable = 300/10*30 = 900; + fixed 300 = 1200. variableBudget = 1500-300 = 1200.
  const pace = computeSpendingPace({ variableExpenses: 300, budgetLimit: 1500, fixedExpenses: 300, now: NOW });
  assert.equal(pace.variableBudget, 1200);
  assert.equal(pace.projectedExpenses, 1200, 'projected variable (900) + fixed (300)');
  assert.equal(pace.status, 'under', 'colour reflects variable pace only (900 <= 1200)');
});

test('fixed total is included even with no budget', () => {
  const pace = computeSpendingPace({ variableExpenses: 600, budgetLimit: 0, fixedExpenses: 200, now: NOW });
  assert.equal(pace.status, 'none');
  assert.equal(pace.projectedExpenses, 2000); // 1800 variable + 200 fixed
});

test('no room for variable spend marks any spend over', () => {
  // budget 500 fully consumed by the fixed total -> variableBudget 0; any variable spend is over.
  const pace = computeSpendingPace({ variableExpenses: 100, budgetLimit: 500, fixedExpenses: 500, now: NOW });
  assert.equal(pace.variableBudget, 0);
  assert.equal(pace.status, 'over');
});

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
