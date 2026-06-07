/**
 * Pure helpers for the monthly recurring-transactions job. Kept free of DB/IO so
 * they are trivially unit-testable and safe to import from workflows.
 */

// `previousMonthRange` lives in ./fixed-expense (single source of truth) and is
// re-used here for the source-month window.

/** Zero-padded `YYYY-MM` for a date's year and month (local time). */
export function yearMonthKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

/** Last day-of-month number for a year + 0-based month. */
export function lastDayOfMonth(year: number, month0: number): number {
  return new Date(year, month0 + 1, 0).getDate();
}

/**
 * The slice of the previous month whose recurrent transactions should be copied
 * **on `today`**, for the daily recurring job. A source transaction is copied on
 * the day-of-month it falls on; on the target month's last day, any later source
 * days (29/30/31 that don't exist this month) collapse onto it.
 *
 * Given `today` (day `D` of a target month whose last day is `L`, previous month
 * length `P`):
 * - `D < L`  → just the previous month's day `D`  → `[prev D, prev D+1)`.
 * - `D === L` → the previous month's days `D…end`  → `[prev D, end of prev month)`.
 * - `D > P`   → the previous month has no such day → `null` (nothing to copy).
 *
 * Returns local-time `[sourceStart, sourceEnd)` bounds, or `null` to skip the day.
 */
export function recurringSourceWindow(today: Date): { sourceStart: Date; sourceEnd: Date } | null {
  const day = today.getDate();
  const targetYear = today.getFullYear();
  const targetMonth0 = today.getMonth();
  const lastDayTarget = lastDayOfMonth(targetYear, targetMonth0);

  const prevFirst = new Date(targetYear, targetMonth0 - 1, 1);
  const prevYear = prevFirst.getFullYear();
  const prevMonth0 = prevFirst.getMonth();
  const lastDayPrev = lastDayOfMonth(prevYear, prevMonth0);

  if (day > lastDayPrev) return null;

  const sourceStart = new Date(prevYear, prevMonth0, day, 0, 0, 0, 0);
  const sourceEnd =
    day === lastDayTarget
      ? new Date(prevYear, prevMonth0 + 1, 1, 0, 0, 0, 0) // first of the target month = end of prev month (exclusive)
      : new Date(prevYear, prevMonth0, day + 1, 0, 0, 0, 0); // start of the next day (exclusive)
  return { sourceStart, sourceEnd };
}

/**
 * Places `sourceDate`'s day-of-month into (`targetYear`, `targetMonth0`),
 * clamping to the target month's last valid day so e.g. Jan 31 → Feb 28/29.
 * Time-of-day is preserved.
 */
export function targetDateInMonth(sourceDate: Date, targetYear: number, targetMonth0: number): Date {
  const lastDay = new Date(targetYear, targetMonth0 + 1, 0).getDate();
  const day = Math.min(sourceDate.getDate(), lastDay);
  return new Date(
    targetYear,
    targetMonth0,
    day,
    sourceDate.getHours(),
    sourceDate.getMinutes(),
    sourceDate.getSeconds(),
    sourceDate.getMilliseconds(),
  );
}

/**
 * Deterministic idempotency key for a generated copy. Stored as the copy's
 * `emailId` so the existing unique `{ userId, emailId }` index guarantees at most
 * one copy per source transaction per target month — re-runs are no-ops.
 */
export function recurringDedupKey(sourceTransactionId: string, targetYearMonth: string): string {
  return `recurring:${sourceTransactionId}:${targetYearMonth}`;
}
