export interface BudgetCategoryDTO {
  category: string;
  /** Null when budget values are hidden from the requesting member. */
  budget: number | null;
  spent: number;
  transactionCount: number;
  /** Spent ÷ budget (0–100); present only when the budget value is hidden. */
  progressPercent?: number;
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
  /** Null when budget values are hidden from the requesting member. */
  totalBudget: number | null;
  totalSpent: number;
  /**
   * Remaining plan = totalBudget − totalSpent. May be negative when overspent.
   * Null when budget values are hidden (it would reveal the budget).
   */
  balance: number | null;
  /** @deprecated Alias of totalBudget kept for back-compat. */
  limitAmount: number | null;
  /** When true, the cap and category limits are locked from edits in the UI. */
  locked: boolean;
  categories: BudgetCategoryDTO[];
  /** True when budget values were masked for a member of this wallet. */
  budgetHidden?: boolean;
  /** Spent ÷ budget (0–100); present only when the budget value is hidden. */
  progressPercent?: number;
}

export interface UpsertBudgetInput {
  /** Preferred: explicit month. `periodStart` accepted for back-compat. */
  year?: number;
  month?: number;
  periodStart?: string;
  /** Optional explicit total cap; defaults to the sum of category budgets. */
  limitAmount?: number;
  /** Lock state for the budget cap and category limits. */
  locked?: boolean;
  categories?: { category: string; budget: number }[];
}
