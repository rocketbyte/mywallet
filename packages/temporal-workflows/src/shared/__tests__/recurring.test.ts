/**
 * Unit tests for the pure recurring-transactions helpers (no DB).
 *
 * Run with:
 *   npx tsx --test packages/temporal-workflows/src/shared/__tests__/recurring.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  yearMonthKey,
  targetDateInMonth,
  recurringDedupKey,
  lastDayOfMonth,
  recurringSourceWindow,
} from '../recurring';
import { previousMonthRange } from '../fixed-expense';

test('yearMonthKey zero-pads month', () => {
  assert.equal(yearMonthKey(new Date(2026, 0, 15)), '2026-01');
  assert.equal(yearMonthKey(new Date(2026, 5, 1)), '2026-06');
  assert.equal(yearMonthKey(new Date(2026, 11, 31)), '2026-12');
});

test('previousMonthRange is [first of prev month, first of this month)', () => {
  const { start, end } = previousMonthRange(new Date(2026, 5, 1)); // June
  assert.equal(start.getFullYear(), 2026);
  assert.equal(start.getMonth(), 4); // May
  assert.equal(start.getDate(), 1);
  assert.equal(end.getMonth(), 5); // June
  assert.equal(end.getDate(), 1);
});

test('previousMonthRange crosses the year boundary', () => {
  const { start, end } = previousMonthRange(new Date(2026, 0, 1)); // January
  assert.equal(start.getFullYear(), 2025);
  assert.equal(start.getMonth(), 11); // December
  assert.equal(end.getFullYear(), 2026);
  assert.equal(end.getMonth(), 0);
});

test('targetDateInMonth keeps the day when it fits', () => {
  const out = targetDateInMonth(new Date(2026, 4, 15), 2026, 5); // May 15 -> June
  assert.equal(out.getMonth(), 5);
  assert.equal(out.getDate(), 15);
});

test('targetDateInMonth clamps Jan 31 -> Feb 28 (non-leap)', () => {
  const out = targetDateInMonth(new Date(2026, 0, 31), 2026, 1);
  assert.equal(out.getMonth(), 1);
  assert.equal(out.getDate(), 28);
});

test('targetDateInMonth clamps Jan 31 -> Feb 29 (leap year)', () => {
  const out = targetDateInMonth(new Date(2024, 0, 31), 2024, 1);
  assert.equal(out.getMonth(), 1);
  assert.equal(out.getDate(), 29);
});

test('targetDateInMonth preserves time-of-day', () => {
  const out = targetDateInMonth(new Date(2026, 4, 10, 9, 30, 15, 250), 2026, 5);
  assert.equal(out.getHours(), 9);
  assert.equal(out.getMinutes(), 30);
  assert.equal(out.getSeconds(), 15);
  assert.equal(out.getMilliseconds(), 250);
});

test('recurringDedupKey is stable and namespaced', () => {
  assert.equal(recurringDedupKey('abc123', '2026-06'), 'recurring:abc123:2026-06');
  assert.equal(
    recurringDedupKey('abc123', '2026-06'),
    recurringDedupKey('abc123', '2026-06'),
  );
  assert.notEqual(
    recurringDedupKey('abc123', '2026-06'),
    recurringDedupKey('abc123', '2026-07'),
  );
});

test('lastDayOfMonth handles 30/31/28/29-day months', () => {
  assert.equal(lastDayOfMonth(2026, 0), 31); // Jan
  assert.equal(lastDayOfMonth(2026, 1), 28); // Feb 2026
  assert.equal(lastDayOfMonth(2024, 1), 29); // Feb 2024 (leap)
  assert.equal(lastDayOfMonth(2026, 3), 30); // Apr
});

// --- recurringSourceWindow: the daily day-matching crux -----------------------

test('recurringSourceWindow on a normal day matches just that day last month', () => {
  // Jun 5 2026 -> previous month May, day 5 only.
  const win = recurringSourceWindow(new Date(2026, 5, 5))!;
  assert.ok(win, 'should have a window');
  assert.equal(win.sourceStart.getMonth(), 4); // May
  assert.equal(win.sourceStart.getDate(), 5);
  assert.equal(win.sourceEnd.getMonth(), 4);
  assert.equal(win.sourceEnd.getDate(), 6); // exclusive end = next day
});

test('recurringSourceWindow on the target last day collapses later source days', () => {
  // Feb 28 2026 (last day) -> previous month January, days 28..31.
  const win = recurringSourceWindow(new Date(2026, 1, 28))!;
  assert.equal(win.sourceStart.getMonth(), 0); // Jan
  assert.equal(win.sourceStart.getDate(), 28);
  // exclusive end = first of the target month (Feb 1), i.e. through end of Jan.
  assert.equal(win.sourceEnd.getMonth(), 1); // Feb
  assert.equal(win.sourceEnd.getDate(), 1);
});

test('recurringSourceWindow: 31-day prev month, all of 28..31 fall in the last-day window', () => {
  // March 31 2026 (last day, L=31) -> previous month Feb has only 28 days.
  // day 31 > prev length 28 -> nothing to copy.
  assert.equal(recurringSourceWindow(new Date(2026, 2, 31)), null);
  // March 28 (not last day) -> Feb 28 exact.
  const win = recurringSourceWindow(new Date(2026, 2, 28))!;
  assert.equal(win.sourceStart.getMonth(), 1); // Feb
  assert.equal(win.sourceStart.getDate(), 28);
});

test('recurringSourceWindow returns null when the previous month lacks the day', () => {
  // March 30 -> previous month Feb (28 days); no Feb 30.
  assert.equal(recurringSourceWindow(new Date(2026, 2, 30)), null);
  // March 29 -> no Feb 29 in 2026.
  assert.equal(recurringSourceWindow(new Date(2026, 2, 29)), null);
});

test('recurringSourceWindow crosses the year boundary', () => {
  // Jan 5 2026 -> previous month December 2025, day 5.
  const win = recurringSourceWindow(new Date(2026, 0, 5))!;
  assert.equal(win.sourceStart.getFullYear(), 2025);
  assert.equal(win.sourceStart.getMonth(), 11); // December
  assert.equal(win.sourceStart.getDate(), 5);
});

test('recurringSourceWindow last day of a 30-day month collapses 30/31', () => {
  // April 30 2026 (last day, L=30) -> previous month March (31 days): days 30,31.
  const win = recurringSourceWindow(new Date(2026, 3, 30))!;
  assert.equal(win.sourceStart.getMonth(), 2); // March
  assert.equal(win.sourceStart.getDate(), 30);
  assert.equal(win.sourceEnd.getMonth(), 3); // April 1 exclusive
  assert.equal(win.sourceEnd.getDate(), 1);
});
