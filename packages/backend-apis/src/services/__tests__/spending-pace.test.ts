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
  const pace = computeSpendingPace({ variableExpenses: 300, debits: 300, budgetLimit: 1500, fixedExpenses: 0, now: NOW });
  assert.equal(pace.daysElapsed, 10);
  assert.equal(pace.daysInMonth, 30);
  assert.equal(pace.dailyAverage, 30); // 300 / 10
  assert.equal(pace.projectedExpenses, 900); // 30 * 30
});

test('status is under when projected is within the variable budget', () => {
  // budget 1500, no fixed -> variableBudget 1500; projected 900 < 1500.
  const pace = computeSpendingPace({ variableExpenses: 300, debits: 300, budgetLimit: 1500, fixedExpenses: 0, now: NOW });
  assert.equal(pace.variableBudget, 1500);
  assert.equal(pace.status, 'under');
});

test('fixed expenses reduce the variable budget', () => {
  // debits 800 (500 fixed + 300 variable), budget 1500 -> variableBudget 1000.
  const pace = computeSpendingPace({ variableExpenses: 300, debits: 800, budgetLimit: 1500, fixedExpenses: 0, now: NOW });
  assert.equal(pace.variableBudget, 1000);
});

test('status is near just over the variable budget (<=115%)', () => {
  // projected = dailyAvg*30. Want projected ~ 1.1 * variableBudget(1000) = 1100.
  // variableExpenses/10*30 = 1100 -> variableExpenses ~ 366.67
  const pace = computeSpendingPace({ variableExpenses: 366.67, debits: 866.67, budgetLimit: 1500, fixedExpenses: 0, now: NOW });
  assert.equal(pace.variableBudget, 1000);
  assert.ok(pace.projectedExpenses > 1000 && pace.projectedExpenses <= 1150, `projected ${pace.projectedExpenses}`);
  assert.equal(pace.status, 'near');
});

test('status is over well past the variable budget (>115%)', () => {
  // projected = 600/10*30 = 1800 vs variableBudget 1500 -> ratio 1.2 -> over.
  const pace = computeSpendingPace({ variableExpenses: 600, debits: 600, budgetLimit: 1500, fixedExpenses: 0, now: NOW });
  assert.equal(pace.projectedExpenses, 1800);
  assert.equal(pace.status, 'over');
});

test('status is none when no budget is set', () => {
  const pace = computeSpendingPace({ variableExpenses: 600, debits: 600, budgetLimit: 0, fixedExpenses: 0, now: NOW });
  assert.equal(pace.status, 'none');
  assert.equal(pace.projectedExpenses, 1800); // still projected
});

test('projection includes the fixed-expense total, but status stays variable-paced', () => {
  // projected variable = 300/10*30 = 900; + fixed 300 = 1200. variableBudget 1500.
  const pace = computeSpendingPace({
    variableExpenses: 300,
    debits: 300,
    budgetLimit: 1500,
    fixedExpenses: 300,
    now: NOW,
  });
  assert.equal(pace.projectedExpenses, 1200, 'projected variable (900) + fixed (300)');
  assert.equal(pace.status, 'under', 'colour reflects variable pace only (900 < 1500)');
});

test('fixed total is included even with no budget', () => {
  const pace = computeSpendingPace({
    variableExpenses: 600,
    debits: 600,
    budgetLimit: 0,
    fixedExpenses: 200,
    now: NOW,
  });
  assert.equal(pace.status, 'none');
  assert.equal(pace.projectedExpenses, 2000); // 1800 variable + 200 fixed
});

test('no room for variable spend marks any spend over', () => {
  // budget 500 fully consumed by fixed (debits 500 fixed, 0 variable budget left), but some variable spend.
  const pace = computeSpendingPace({ variableExpenses: 100, debits: 600, budgetLimit: 500, fixedExpenses: 0, now: NOW });
  assert.equal(pace.variableBudget, 0);
  assert.equal(pace.status, 'over');
});
