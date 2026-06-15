import type { BudgetDTO } from '../types/budget.types';

const pct = (spent: number, budget: number | null): number =>
  !budget || budget <= 0 ? 0 : Math.min(100, Math.round((spent / budget) * 100));

/**
 * Masks configured budget values in a BudgetDTO for read-only members of a
 * wallet with `showBudgetToMembers: false`. Nulls every budget-derived
 * number (`totalBudget`, `limitAmount`, `balance`, category budgets) and
 * adds server-computed `progressPercent` so clients can render progress
 * bars without learning the values. Spent amounts stay. Response-layer
 * only — stored data and analyses keep real numbers.
 */
export function maskBudgetForMember(budget: BudgetDTO): BudgetDTO {
  return {
    ...budget,
    totalBudget: null,
    limitAmount: null,
    balance: null,
    budgetHidden: true,
    progressPercent: pct(budget.totalSpent, budget.totalBudget),
    categories: budget.categories.map((c) => ({
      ...c,
      budget: null,
      progressPercent: pct(c.spent, c.budget),
    })),
  };
}
