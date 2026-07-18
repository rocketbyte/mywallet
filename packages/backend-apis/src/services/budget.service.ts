import { Budget, Transaction } from '../../../temporal-workflows/src/models';
import type { BudgetInterface } from '../../../temporal-workflows/src/models/budget.model';
import { resolveEffectiveBudget } from '../../../temporal-workflows/src/shared/budget-limit';
import { periodStart, periodEnd } from '../utils/date.utils';
import type { BudgetDTO, UpsertBudgetInput } from '../types/budget.types';

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Clamp a category limit into `[0, cap]` so it never exceeds the budget cap. */
function clampToCap(value: number, cap: number): number {
  return Math.max(0, Math.min(cap, value ?? 0));
}

interface CategorySpend {
  total: number;
  count: number;
}

/**
 * Per-category debit spending for a `(userId, year, month)`, keyed by category.
 * Used to backfill `spent`/`transactionCount` on read so the figures stay live
 * regardless of which month's row supplied the limits (carry-forward).
 */
async function getSpentByCategory(
  userId: string,
  year: number,
  month: number,
): Promise<Record<string, CategorySpend>> {
  const start = new Date(year, month - 1, 1);
  const end = new Date(year, month, 0, 23, 59, 59, 999);
  const rows = await Transaction.aggregate<{ _id: string; total: number; count: number }>([
    { $match: { userId, transactionType: 'debit', transactionDate: { $gte: start, $lte: end } } },
    { $group: { _id: '$category', total: { $sum: '$amount' }, count: { $sum: 1 } } },
  ]);
  return Object.fromEntries(rows.map((r) => [r._id, { total: r.total, count: r.count }]));
}

/** Result of resolving the effective budget for a target month. */
interface EffectiveBudget {
  doc: BudgetInterface;
  isCarriedForward: boolean;
  year: number;
  month: number;
}

export class BudgetService {
  /**
   * Resolves the effective budget for `(year, month)`:
   * 1. the exact row for that month, else
   * 2. the most recent row at or before that month (limits carried forward), else
   * 3. null (the user has never set any budget).
   */
  private async resolveEffective(
    userId: string,
    year: number,
    month: number,
  ): Promise<EffectiveBudget | null> {
    // Shared with the store-time alert evaluation so both sides resolve the
    // exact same effective budget (carry-forward rule lives in one place).
    const doc = await resolveEffectiveBudget(userId, year, month);
    if (!doc) return null;
    const isCarriedForward = !(doc.year === year && doc.month === month);
    return { doc, isCarriedForward, year, month };
  }

  /**
   * Builds the API DTO for a target month from a (possibly carried-forward)
   * source row. `spent`/`balance` are always computed for the target month.
   */
  private async buildDTO(effective: EffectiveBudget): Promise<BudgetDTO> {
    const { doc, isCarriedForward, year, month } = effective;
    const spentByCategory = await getSpentByCategory(doc.userId, year, month);

    const categories = (doc.categories ?? []).map((c) => {
      const spend = spentByCategory[c.category] ?? { total: 0, count: 0 };
      return {
        category: c.category,
        budget: c.budgetAmount ?? 0,
        spent: round2(spend.total),
        transactionCount: spend.count,
      };
    });

    const totalBudget = round2(
      doc.totalBudget ?? categories.reduce((sum, c) => sum + c.budget, 0),
    );
    // Comprehensive month spend (all debit categories), so "remaining money"
    // is correct even for categories the user did not explicitly budget.
    const totalSpent = round2(
      Object.values(spentByCategory).reduce((sum, s) => sum + s.total, 0),
    );

    return {
      id: doc._id.toString(),
      userId: doc.userId,
      year,
      month,
      periodStart: periodStart(month, year),
      periodEnd: periodEnd(month, year),
      isCarriedForward,
      totalBudget,
      totalSpent,
      balance: round2(totalBudget - totalSpent),
      limitAmount: totalBudget,
      locked: doc.locked ?? false,
      categories,
    };
  }

  /** Effective budget for the current calendar month (carry-forward aware). */
  async getCurrent(userId: string): Promise<BudgetDTO | null> {
    const now = new Date();
    const effective = await this.resolveEffective(userId, now.getFullYear(), now.getMonth() + 1);
    if (!effective) return null;
    return this.buildDTO(effective);
  }

  /** Creates or replaces the budget row for a month and returns its live DTO. */
  async upsert(userId: string, input: UpsertBudgetInput): Promise<BudgetDTO> {
    const { year, month } = this.resolveMonth(input);
    const rawCategories = (input.categories ?? []).map((c) => ({
      category: c.category,
      budgetAmount: c.budget,
      spentAmount: 0,
      transactionCount: 0,
    }));
    // The explicit cap is authoritative; otherwise fall back to the category sum.
    const totalBudget =
      input.limitAmount ?? rawCategories.reduce((sum, c) => sum + (c.budgetAmount ?? 0), 0);
    // No category limit may exceed the cap (it is the slider max client-side);
    // clamp to [0, totalBudget] so persisted data always honors the invariant.
    const categories = rawCategories.map((c) => ({
      ...c,
      budgetAmount: clampToCap(c.budgetAmount, totalBudget),
    }));

    const set: Record<string, unknown> = {
      userId,
      year,
      month,
      totalBudget,
      categories,
      lastCalculatedAt: new Date(),
    };
    if (input.locked !== undefined) set.locked = input.locked;

    const doc = await Budget.findOneAndUpdate(
      { userId, year, month },
      { $set: set },
      { upsert: true, new: true },
    ).lean<BudgetInterface>();

    return this.buildDTO({ doc, isCarriedForward: false, year, month });
  }

  /** Patches an existing budget row by id and returns its live DTO. */
  async update(
    userId: string,
    id: string,
    input: Partial<UpsertBudgetInput>,
  ): Promise<BudgetDTO | null> {
    const updates: Record<string, unknown> = { lastCalculatedAt: new Date() };
    if (input.limitAmount !== undefined) updates.totalBudget = input.limitAmount;
    if (input.locked !== undefined) updates.locked = input.locked;
    if (input.categories) {
      // When the cap is patched in the same call, clamp categories to it so a
      // category limit can never exceed the cap (the client-side slider max).
      const cap = input.limitAmount ?? Number.POSITIVE_INFINITY;
      updates.categories = input.categories.map((c) => ({
        category: c.category,
        budgetAmount: clampToCap(c.budget, cap),
        spentAmount: 0,
        transactionCount: 0,
      }));
    }
    const doc = await Budget.findOneAndUpdate(
      { _id: id, userId },
      { $set: updates },
      { new: true },
    ).lean<BudgetInterface>();
    if (!doc) return null;

    const year = doc.year ?? new Date().getFullYear();
    const month = doc.month ?? new Date().getMonth() + 1;
    return this.buildDTO({ doc, isCarriedForward: false, year, month });
  }

  /** Accepts explicit `year`/`month`, a `periodStart` date, or defaults to now. */
  private resolveMonth(input: UpsertBudgetInput): { year: number; month: number } {
    if (input.year && input.month) return { year: input.year, month: input.month };
    const date = input.periodStart ? new Date(input.periodStart) : new Date();
    return { year: date.getFullYear(), month: date.getMonth() + 1 };
  }
}
