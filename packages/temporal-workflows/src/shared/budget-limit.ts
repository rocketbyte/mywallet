import { Budget, BudgetInterface } from '../models/budget.model';
import { Transaction } from '../models/transaction.model';

/**
 * Resolves the **effective** budget row for `(userId, year, month)` using the
 * carry-forward rule shared across the system:
 *   1. the exact row for that month, else
 *   2. the most recent row at or before that month (limits carried forward), else
 *   3. null (the user has never set any budget).
 *
 * This is the single source of truth for "which budget applies to month M";
 * both the read-time budget API and the store-time alert evaluation use it so
 * their notion of the effective limit can never diverge.
 */
export async function resolveEffectiveBudget(
  userId: string,
  year: number,
  month: number,
): Promise<BudgetInterface | null> {
  const exact = await Budget.findOne({ userId, year, month }).lean<BudgetInterface>();
  if (exact) return exact;

  const prior = await Budget.findOne({
    userId,
    $or: [{ year: { $lt: year } }, { year, month: { $lte: month } }],
  })
    .sort({ year: -1, month: -1 })
    .lean<BudgetInterface>();
  return prior ?? null;
}

/**
 * The effective budget limit for a single category in `(year, month)`, or `null`
 * when the category is not budgeted (or the user has no budget at all). A limit
 * of `0` is returned as `0` — callers decide whether a zero limit is actionable.
 */
export async function resolveCategoryLimit(
  userId: string,
  category: string,
  year: number,
  month: number,
): Promise<number | null> {
  const budget = await resolveEffectiveBudget(userId, year, month);
  if (!budget) return null;
  const entry = (budget.categories ?? []).find((c) => c.category === category);
  if (!entry) return null;
  return entry.budgetAmount ?? 0;
}

/**
 * Month-to-date **debit** total for a category in the calendar month containing
 * `date`, scoped to the tenant. Matches the aggregation the budget API uses to
 * compute live `spent`, so store-time evaluation sees the same figure the user
 * sees. Includes any transaction already persisted for that month.
 */
export async function monthToDateCategorySpend(
  userId: string,
  category: string,
  date: Date,
): Promise<number> {
  const start = new Date(date.getFullYear(), date.getMonth(), 1, 0, 0, 0, 0);
  const end = new Date(date.getFullYear(), date.getMonth() + 1, 0, 23, 59, 59, 999);
  const rows = await Transaction.aggregate<{ _id: null; total: number }>([
    {
      $match: {
        userId,
        category,
        transactionType: 'debit',
        transactionDate: { $gte: start, $lte: end },
      },
    },
    { $group: { _id: null, total: { $sum: '$amount' } } },
  ]);
  return rows[0]?.total ?? 0;
}
