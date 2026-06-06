import { Transaction } from '../models/transaction.model';

/**
 * Identity of a transaction being ingested, used to decide whether it should
 * inherit the recurring fixed-expense flag. `merchant` MUST already be the
 * normalised value that will be persisted, and `amount` the stored (non-negative)
 * magnitude, so the lookup matches existing rows exactly.
 */
export interface FixedExpenseCandidate {
  userId: string;
  category: string;
  amount: number;
  merchant: string;
  /** May arrive as a Date or an ISO string (Temporal payload serialization). */
  transactionDate: Date | string;
}

/**
 * `[start, end)` covering the calendar month immediately before `date`'s month.
 * E.g. a date in June yields `[May 1 00:00, Jun 1 00:00)`.
 */
export function previousMonthRange(date: Date): { start: Date; end: Date } {
  const start = new Date(date.getFullYear(), date.getMonth() - 1, 1, 0, 0, 0, 0);
  const end = new Date(date.getFullYear(), date.getMonth(), 1, 0, 0, 0, 0);
  return { start, end };
}

/**
 * Whether a newly-ingested transaction should be auto-flagged as a fixed expense:
 * true when the user's previous calendar month already holds a transaction with
 * the same fixed-expense signature (category + amount + merchant) that is marked
 * `isFixedExpense`. Tenant-scoped by `userId`. Used by every ingestion path
 * (manual create and the pipeline store step) so the flag carries across months
 * without the user re-marking it.
 */
export async function findInheritedFixedExpense(c: FixedExpenseCandidate): Promise<boolean> {
  const date = c.transactionDate instanceof Date ? c.transactionDate : new Date(c.transactionDate);
  if (Number.isNaN(date.getTime())) return false;

  const { start, end } = previousMonthRange(date);
  const match = await Transaction.exists({
    userId: c.userId,
    category: c.category,
    amount: c.amount,
    merchant: c.merchant,
    isFixedExpense: true,
    transactionDate: { $gte: start, $lt: end },
  });
  return match != null;
}
