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
  const pace = computeSpendingPace({ variableExpenses: 300, debits: 300, budgetLimit: 1500, fixedExpenses: 0, now: NOW });
  assert.equal(pace.variableBudget, 1500);
  assert.equal(pace.status, 'under');
});

test('variable budget subtracts the recurring fixed-expense total', () => {
  const pace = computeSpendingPace({ variableExpenses: 300, debits: 300, budgetLimit: 1500, fixedExpenses: 500, now: NOW });
  assert.equal(pace.variableBudget, 1000);
  assert.equal(pace.expectedDailyAverage, round2(1000 / 30));
});

test('status is near just over the variable budget (<=115%)', () => {
  const pace = computeSpendingPace({ variableExpenses: 366.67, debits: 366.67, budgetLimit: 1500, fixedExpenses: 500, now: NOW });
  assert.equal(pace.variableBudget, 1000);
  assert.equal(pace.status, 'near');
});

test('status is over well past the variable budget (>115%)', () => {
  const pace = computeSpendingPace({ variableExpenses: 600, debits: 600, budgetLimit: 1500, fixedExpenses: 0, now: NOW });
  assert.equal(pace.projectedExpenses, 1800);
  assert.equal(pace.status, 'over');
});

test('status is none when no budget is set', () => {
  const pace = computeSpendingPace({ variableExpenses: 600, debits: 600, budgetLimit: 0, fixedExpenses: 0, now: NOW });
  assert.equal(pace.status, 'none');
  assert.equal(pace.projectedExpenses, 1800); // still projected
});

test('projection includes the fixed-expense total; status stays variable-paced', () => {
  const pace = computeSpendingPace({ variableExpenses: 300, debits: 300, budgetLimit: 1500, fixedExpenses: 300, now: NOW });
  assert.equal(pace.variableBudget, 1200);
  assert.equal(pace.projectedExpenses, 1200, 'projected variable (900) + fixed (300)');
  assert.equal(pace.status, 'under', 'colour reflects variable pace only (900 <= 1200)');
});

test('fixed total is included even with no budget', () => {
  const pace = computeSpendingPace({ variableExpenses: 600, debits: 600, budgetLimit: 0, fixedExpenses: 200, now: NOW });
  assert.equal(pace.status, 'none');
  assert.equal(pace.projectedExpenses, 2000); // 1800 variable + 200 fixed
});

test('no room for variable spend marks any spend over', () => {
  const pace = computeSpendingPace({ variableExpenses: 100, debits: 100, budgetLimit: 500, fixedExpenses: 500, now: NOW });
  assert.equal(pace.variableBudget, 0);
  assert.equal(pace.status, 'over');
});

test('variancePct is the signed % vs the expected daily average', () => {
  const over = computeSpendingPace({ variableExpenses: 600, debits: 600, budgetLimit: 1500, fixedExpenses: 0, now: NOW });
  assert.equal(over.variancePct, 20); // dailyAvg 60 vs expected 50

  const under = computeSpendingPace({ variableExpenses: 300, debits: 300, budgetLimit: 1500, fixedExpenses: 0, now: NOW });
  assert.equal(under.variancePct, -40); // dailyAvg 30 vs expected 50
});

test('variancePct is null when there is no target', () => {
  const noBudget = computeSpendingPace({ variableExpenses: 600, debits: 600, budgetLimit: 0, fixedExpenses: 0, now: NOW });
  assert.equal(noBudget.variancePct, null);
  const noRoom = computeSpendingPace({ variableExpenses: 100, debits: 100, budgetLimit: 500, fixedExpenses: 500, now: NOW });
  assert.equal(noRoom.variancePct, null);
});

test('safeToSpend: remaining this month and per remaining day (today included)', () => {
  // budget 1500, fixed 600 -> variableBudget 900; spent 270; day 10 of 30 -> 21 days remain.
  const pace = computeSpendingPace({ variableExpenses: 270, debits: 270, budgetLimit: 1500, fixedExpenses: 600, now: NOW });
  assert.equal(pace.variableBudget, 900);
  assert.equal(pace.safeToSpendRemaining, 630); // 900 - 270
  assert.equal(pace.safeToSpendPerDay, 30); // 630 / 21
});

test('safeToSpendPerDay equals the flat target on day 1 with nothing spent', () => {
  const day1 = new Date(2026, 8, 1); // Sept 1
  const pace = computeSpendingPace({ variableExpenses: 0, debits: 0, budgetLimit: 1500, fixedExpenses: 600, now: day1 });
  assert.equal(pace.safeToSpendPerDay, 30); // variableBudget 900 / 30 days
  assert.equal(pace.expectedDailyAverage, 30);
});

test('safeToSpend is 0/empty when the variable budget is exhausted', () => {
  const pace = computeSpendingPace({ variableExpenses: 1000, debits: 1000, budgetLimit: 1500, fixedExpenses: 600, now: NOW });
  assert.equal(pace.safeToSpendRemaining, 0);
  assert.equal(pace.safeToSpendPerDay, 0);
});

test('safeToSpend is null with no budget; reservedForFixed is still computed', () => {
  const pace = computeSpendingPace({ variableExpenses: 300, debits: 300, budgetLimit: 0, fixedExpenses: 0, now: NOW });
  assert.equal(pace.safeToSpendRemaining, null);
  assert.equal(pace.safeToSpendPerDay, null);
  assert.equal(pace.reservedForFixed, 0); // budget-independent
});

test('reservedForFixed is reported even with no budget', () => {
  // no budget, fixed commitment 600, posted = 700 - 200 = 500 -> pending 100.
  const pace = computeSpendingPace({ variableExpenses: 200, debits: 700, budgetLimit: 0, fixedExpenses: 600, now: NOW });
  assert.equal(pace.safeToSpendRemaining, null);
  assert.equal(pace.reservedForFixed, 100);
});

test('reservedForFixed is the fixed commitment not yet posted in range', () => {
  // fixed commitment 600; fixed posted = debits(700) - variable(200) = 500; reserved = 100.
  const pace = computeSpendingPace({ variableExpenses: 200, debits: 700, budgetLimit: 1500, fixedExpenses: 600, now: NOW });
  assert.equal(pace.reservedForFixed, 100);
  assert.equal(pace.variableBudget, 900); // 1500 - 600
  assert.equal(pace.safeToSpendRemaining, 700); // 900 - 200
});

test('reservedForFixed is 0 when all fixed has already posted', () => {
  // fixed commitment 600; fixed posted = 800 - 200 = 600; reserved = 0.
  const pace = computeSpendingPace({ variableExpenses: 200, debits: 800, budgetLimit: 1500, fixedExpenses: 600, now: NOW });
  assert.equal(pace.reservedForFixed, 0);
});

test('FULL CARD scenario — every "Spent this period" figure reconciles', () => {
  // Mirrors the dashboard card: day 7 of a 30-day month (23d left), big budget,
  // overspending. variable spend 31,535 -> daily avg exactly 4,505.
  const now = new Date(2026, 5, 7); // June 7
  const pace = computeSpendingPace({
    variableExpenses: 31535,
    debits: 124447,
    budgetLimit: 162500,
    fixedExpenses: 99672,
    now,
  });

  assert.equal(pace.daysElapsed, 7);
  assert.equal(pace.daysInMonth, 30); // -> "23d left"
  assert.equal(pace.dailyAverage, 4505); // 31535 / 7  (DAILY AVG)
  assert.equal(pace.variableBudget, 62828); // 162500 - 99672 (fixed total)
  assert.equal(pace.expectedDailyAverage, round2(62828 / 30)); // 2094.27
  assert.equal(pace.projectedExpenses, 234822); // 4505*30 + 99672 (PROJECTED)
  assert.equal(pace.variancePct, 115); // (4505 - 2094.27)/2094.27*100  (+115%)
  assert.equal(pace.status, 'over'); // 135150/62828 = 2.15  -> red
  assert.equal(pace.safeToSpendRemaining, 31293); // 62828 - 31535
  assert.equal(pace.reservedForFixed, 6760); // 99672 - (124447 - 31535)
  assert.equal(pace.safeToSpendPerDay, round2(31293 / 24)); // remaining / (30-7+1)

  // Cross-checks: the relationships that MUST hold for any inputs.
  assert.equal(pace.projectedExpenses, round2(pace.dailyAverage * pace.daysInMonth + 99672));
  assert.equal(pace.variancePct, Math.round(((pace.dailyAverage - pace.expectedDailyAverage) / pace.expectedDailyAverage) * 100));
});

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
