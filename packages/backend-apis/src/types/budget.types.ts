export interface BudgetCategoryDTO {
  category: string;
  budget: number;
  spent: number;
  transactionCount: number;
}

export interface BudgetDTO {
  id: string;
  userId: string;
  /** Calendar month the effective budget applies to. */
  year: number;
  month: number;
  periodStart: string;
  periodEnd: string;
  /** True when the limits were carried forward from an earlier month. */
  isCarriedForward: boolean;
  totalBudget: number;
  totalSpent: number;
  /** Remaining plan = totalBudget − totalSpent. May be negative when overspent. */
  balance: number;
  /** @deprecated Alias of totalBudget kept for back-compat. */
  limitAmount: number;
  categories: BudgetCategoryDTO[];
}

export interface UpsertBudgetInput {
  /** Preferred: explicit month. `periodStart` accepted for back-compat. */
  year?: number;
  month?: number;
  periodStart?: string;
  /** Optional explicit total cap; defaults to the sum of category budgets. */
  limitAmount?: number;
  categories?: { category: string; budget: number }[];
}
